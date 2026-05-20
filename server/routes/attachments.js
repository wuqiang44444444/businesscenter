// 通用附件上传：可挂到任意实体（合同/发票/付款记录/客户...）
// 文件落盘到 server/uploads/<entity>/<entity_id>/<uuid>__<original>，元数据进 attachments 表
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { audit } = require('../lib/helpers');

const router = express.Router();

// 受信任的 entity 白名单，防注入路径
const ALLOWED_ENTITIES = new Set([
  'customers', 'projects', 'contracts', 'invoices',
  'suppliers', 'accounts_payable', 'payable_payments',
]);

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 文件限制：每个 ≤ 20 MB，常见办公文档类型
const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/|application\/pdf|application\/vnd\.openxmlformats|application\/vnd\.ms-|application\/zip|text\/|application\/msword)/;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { entity, id } = req.params;
    if (!ALLOWED_ENTITIES.has(entity)) return cb(new Error('未授权的实体类型'));
    const dir = path.join(UPLOAD_DIR, entity, id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // 修复 multer 默认 latin1 解析 → 让 file.originalname 拿到真正的 UTF-8 字符串
    // 这只用于存 DB（显示用），磁盘文件名独立用 UUID，避免编码问题
    try {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {}
    // 磁盘上只用 UUID + 安全扩展名（去除路径分隔符），跨平台 / 跨编码绝对安全
    const ext = path.extname(file.originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.test(file.mimetype)) {
      return cb(new Error(`不支持的文件类型：${file.mimetype}`));
    }
    cb(null, true);
  },
});

// entity 类型校验中间件，必须在 multer 之前跑
function checkEntity(req, res, next) {
  if (!ALLOWED_ENTITIES.has(req.params.entity)) {
    return res.status(400).json({ error: '未授权的实体类型' });
  }
  next();
}

// ============ 下载附件（必须放在 /:entity/:id 之前，否则会被通配匹配走）============
router.get('/file/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const r = db.exec(
    `SELECT original_name, stored_path, mime_type FROM attachments WHERE id = ?`,
    [req.params.id]
  );
  if (!r[0] || r[0].values.length === 0) return res.status(404).json({ error: '附件不存在' });

  const [original_name, stored_path, mime_type] = r[0].values[0];
  const abs = path.join(UPLOAD_DIR, stored_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '文件已丢失' });

  res.setHeader('Content-Type', mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `attachment; filename="${encodeURIComponent(original_name).replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(original_name)}`
  );
  fs.createReadStream(abs).pipe(res);
});

// ============ 列出某实体的全部附件 ============
router.get('/:entity/:id', authMiddleware, checkEntity, (req, res) => {
  const { entity, id } = req.params;
  const db = getDb();
  // 显式 a.created_at，避免与 users.created_at 列名冲突
  const r = db.exec(
    `SELECT a.id, a.original_name, a.mime_type, a.size, a.created_at, u.username AS uploaded_by_name
     FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id
     WHERE a.entity_table = ? AND a.entity_id = ?
     ORDER BY a.created_at DESC`,
    [entity, id]
  );
  if (!r[0]) return res.json([]);
  const rows = r[0].values.map(row => {
    const o = {}; r[0].columns.forEach((c, i) => o[c] = row[i]); return o;
  });
  res.json(rows);
});

// ============ 上传附件（支持多文件）============
router.post('/:entity/:id', authMiddleware, checkEntity, upload.array('files', 5), (req, res) => {
  const { entity, id } = req.params;
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '未上传文件' });

  const db = getDb();
  const inserted = [];
  const tx = db.transaction(() => {
    for (const f of req.files) {
      const attId = uuidv4();
      // 存相对路径，便于迁移时跨机器使用
      const relPath = path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/');
      db.run(
        `INSERT INTO attachments (id, entity_table, entity_id, original_name, stored_path, mime_type, size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [attId, entity, id, f.originalname, relPath, f.mimetype, f.size, req.user.id]
      );
      inserted.push({ id: attId, original_name: f.originalname, size: f.size });
      audit(req, 'create', 'attachments', attId, null, { entity_table: entity, entity_id: id, original_name: f.originalname });
    }
  });
  tx();

  res.json({ inserted });
});

// ============ 删除附件 ============
router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const r = db.exec(
    `SELECT entity_table, entity_id, original_name, stored_path FROM attachments WHERE id = ?`,
    [req.params.id]
  );
  if (!r[0] || r[0].values.length === 0) return res.status(404).json({ error: '附件不存在' });

  const [entity_table, entity_id, original_name, stored_path] = r[0].values[0];
  const abs = path.join(UPLOAD_DIR, stored_path);

  db.run(`DELETE FROM attachments WHERE id = ?`, [req.params.id]);
  // 删文件失败不阻塞 DB 操作（孤儿文件可由后台清理任务清）
  try { fs.unlinkSync(abs); } catch {}

  audit(req, 'delete', 'attachments', req.params.id,
    { entity_table, entity_id, original_name }, null);
  res.json({ success: true });
});

module.exports = router;
