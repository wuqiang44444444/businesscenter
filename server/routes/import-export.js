const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { audit, snapshot, toCents, toYuan } = require('../lib/helpers');
const cfg = require('../lib/import-export-config');

const router = express.Router();

// 文件上传：内存存储 + 大小限制 10 MB + 只接受 xlsx/xls
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) return cb(null, true);
    cb(new Error('只支持 xlsx / xls 文件'));
  },
});

// 临时缓存预览结果，等待 confirm 时使用。key = 上传者 + 模块 + 一个随机 id
const previewCache = new Map();
const PREVIEW_TTL = 10 * 60 * 1000; // 10 分钟
function cachePreview(userId, moduleName, data) {
  const id = uuidv4();
  const key = `${userId}:${moduleName}:${id}`;
  previewCache.set(key, { data, ts: Date.now() });
  // 清过期
  for (const [k, v] of previewCache) {
    if (Date.now() - v.ts > PREVIEW_TTL) previewCache.delete(k);
  }
  return id;
}
function getPreview(userId, moduleName, id) {
  const key = `${userId}:${moduleName}:${id}`;
  return previewCache.get(key)?.data;
}
function dropPreview(userId, moduleName, id) {
  previewCache.delete(`${userId}:${moduleName}:${id}`);
}

// 把 db 行（DB 字段，金额是分）转成 Excel 用户字段（金额是元，enum 反向中文）
function rowToExcel(moduleCfg, dbRow) {
  const out = {};
  for (const f of moduleCfg.fields) {
    let v;
    if (f.field === 'customer_name' || f.field === 'project_name' || f.field === 'contract_name' || f.field === 'supplier_name') {
      v = dbRow[f.field] ?? '';
    } else {
      v = dbRow[f.field];
    }
    if (v == null) v = '';
    if (f.isMoney && typeof v === 'number') v = v / 100; // cents → yuan
    if (f.reverseEnum && f.reverseEnum[v]) v = f.reverseEnum[v];
    out[f.header] = v;
  }
  return out;
}

// 把 Excel 一行（中文表头）转成 DB 字段对象 + 收集 issues
function parseExcelRow(moduleCfg, excelRow, rowIndex, db) {
  const issues = [];
  const dbRow = {};
  for (const f of moduleCfg.fields) {
    if (f.exportOnly) continue;
    const raw = excelRow[f.header];
    if ((raw == null || raw === '') && (f.required || f.requiredOnImport)) {
      issues.push(`【${f.header}】必填`);
      continue;
    }
    let v = raw;
    if (f.transform) v = f.transform(v);
    if (f.enum && v != null && v !== '') {
      // 用户填中文 → 映射成内部值；如果已经是内部值也接受
      if (f.enum[v]) v = f.enum[v];
      else if (!Object.values(f.enum).includes(v)) {
        issues.push(`【${f.header}】不识别的值「${v}」`);
        continue;
      }
    }
    if (f.resolveOnImport) {
      const id = f.resolveOnImport.lookup(db, v);
      if (v && !id) {
        issues.push(`【${f.header}】找不到「${v}」对应的记录`);
      }
      dbRow[f.resolveOnImport.toField] = id;
    } else {
      dbRow[f.field] = v;
    }
  }
  return { dbRow, issues, rowIndex };
}

// ============ 模板下载 ============
router.get('/template/:module', authMiddleware, (req, res) => {
  const m = cfg.get(req.params.module);
  if (!m) return res.status(404).json({ error: '未知模块' });

  const headers = m.fields.filter(f => !f.exportOnly).map(f => f.header);
  const ws = xlsx.utils.aoa_to_sheet([headers]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, m.label);
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // Content-Disposition 非 ASCII 文件名按 RFC 5987 编码（filename* + filename 双备份）
  res.setHeader('Content-Disposition', buildContentDisposition(`${m.label}_模板.xlsx`));
  res.send(buf);
});

function buildContentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// ============ 数据导出 ============
router.get('/export/:module', authMiddleware, (req, res) => {
  const m = cfg.get(req.params.module);
  if (!m) return res.status(404).json({ error: '未知模块' });
  const db = getDb();

  // 为关联字段构造 JOIN
  let sql;
  if (m.table === 'projects') {
    sql = `SELECT p.*, c.name AS customer_name FROM projects p LEFT JOIN customers c ON p.customer_id = c.id`;
  } else if (m.table === 'contracts') {
    sql = `SELECT ct.*, c.name AS customer_name, p.name AS project_name FROM contracts ct
           LEFT JOIN customers c ON ct.customer_id = c.id
           LEFT JOIN projects p ON ct.project_id = p.id`;
  } else if (m.table === 'invoices') {
    sql = `SELECT inv.*, c.name AS contract_name FROM invoices inv
           LEFT JOIN contracts c ON inv.contract_id = c.id`;
  } else if (m.table === 'accounts_payable') {
    sql = `SELECT ap.*, s.name AS supplier_name, p.name AS project_name FROM accounts_payable ap
           LEFT JOIN suppliers s ON ap.supplier_id = s.id
           LEFT JOIN projects p ON ap.project_id = p.id`;
  } else {
    sql = `SELECT * FROM ${m.table}`;
  }

  const result = db.exec(sql);
  const rows = [];
  if (result[0]) {
    for (const row of result[0].values) {
      const obj = {};
      result[0].columns.forEach((c, i) => obj[c] = row[i]);
      rows.push(rowToExcel(m, obj));
    }
  }

  const headers = m.fields.map(f => f.header);
  const ws = xlsx.utils.json_to_sheet(rows, { header: headers });
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, m.label);
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', buildContentDisposition(`${m.label}_导出.xlsx`));
  res.send(buf);
});

// ============ 导入：预览 ============
router.post('/import/:module/preview', authMiddleware, upload.single('file'), async (req, res) => {
  const m = cfg.get(req.params.module);
  if (!m) return res.status(404).json({ error: '未知模块' });
  if (!req.file) return res.status(400).json({ error: '未上传文件' });

  let wb;
  try {
    wb = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (e) {
    return res.status(400).json({ error: '解析失败：' + e.message });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return res.status(400).json({ error: '工作簿没有数据表' });
  const raw = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });

  const db = getDb();
  const success = [];
  const errors = [];
  // 提前查发票号 / username 等唯一性表
  const uniqueChecks = {};
  for (const f of m.fields) {
    if (f.unique) {
      const r = db.exec(`SELECT ${f.field} FROM ${m.table}`);
      uniqueChecks[f.field] = new Set(r[0] ? r[0].values.map(v => v[0]) : []);
    }
  }

  for (let i = 0; i < raw.length; i++) {
    const parsed = parseExcelRow(m, raw[i], i + 2, db); // +2 因为有表头行 + 0 索引
    // 唯一性检查
    for (const f of m.fields) {
      if (f.unique && parsed.dbRow[f.field] && uniqueChecks[f.field].has(parsed.dbRow[f.field])) {
        parsed.issues.push(`【${f.header}】「${parsed.dbRow[f.field]}」已存在`);
      }
    }
    if (parsed.issues.length) {
      errors.push({ row: parsed.rowIndex, errors: parsed.issues, raw: raw[i] });
    } else {
      success.push({ row: parsed.rowIndex, ...parsed.dbRow });
      if (m.fields.some(f => f.unique)) {
        for (const f of m.fields) {
          if (f.unique && parsed.dbRow[f.field]) uniqueChecks[f.field].add(parsed.dbRow[f.field]);
        }
      }
    }
  }

  const previewId = cachePreview(req.user.id, req.params.module, success);
  res.json({ previewId, success, errors, total: raw.length });
});

// ============ 导入：确认插入 ============
router.post('/import/:module/confirm', authMiddleware, express.json(), (req, res) => {
  const m = cfg.get(req.params.module);
  if (!m) return res.status(404).json({ error: '未知模块' });
  const { previewId } = req.body || {};
  if (!previewId) return res.status(400).json({ error: '缺少 previewId' });

  const rows = getPreview(req.user.id, req.params.module, previewId);
  if (!rows) return res.status(400).json({ error: '预览数据已过期，请重新上传' });

  const db = getDb();
  const insertedIds = [];

  const tx = db.transaction(() => {
    for (const row of rows) {
      const id = uuidv4();
      const dbRow = { ...row, id, created_by: req.user.id };
      delete dbRow.row;

      // 处理金额：用户填的是元 → 入库分
      for (const f of m.fields) {
        if (f.isMoney && !f.exportOnly && dbRow[f.field] != null) {
          dbRow[f.field] = toCents(dbRow[f.field]) ?? 0;
        }
      }

      // 发票需要服务端算 tax_amount / total_amount
      if (m.table === 'invoices') {
        const amt = dbRow.amount ?? 0;
        const rate = dbRow.tax_rate ?? 0.13;
        dbRow.tax_amount = Math.round(amt * rate);
        dbRow.total_amount = amt + dbRow.tax_amount;
      }

      // 拼 INSERT
      const cols = Object.keys(dbRow);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map(k => dbRow[k]);
      db.run(`INSERT INTO ${m.table} (${cols.join(', ')}) VALUES (${placeholders})`, values);
      insertedIds.push(id);
      audit(req, 'create', m.table, id, null, snapshot(m.table, id));
    }
  });
  tx();

  dropPreview(req.user.id, req.params.module, previewId);
  res.json({ inserted: insertedIds.length, ids: insertedIds });
});

module.exports = router;
