// 自定义报表：用户存定义、跑查询、导出。所有 SQL 通过白名单引擎构建，不接受裸 SQL。
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const { buildSql, getSourcesMeta, postProcessRows } = require('../lib/custom-report-engine');
const schemas = require('../schemas');

const router = express.Router();

// 元数据：所有可用的数据源 + 列。前端用它构建编辑器
router.get('/_meta', authMiddleware, (req, res) => {
  res.json({ sources: getSourcesMeta() });
});

// 列表：管理员看全部，其他只看自己的
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  let sql = `SELECT cr.*, u.username AS owner_name FROM custom_reports cr LEFT JOIN users u ON cr.owner_id = u.id WHERE 1=1`;
  const params = [];
  if (req.user.role !== 'admin') {
    sql += ` AND cr.owner_id = ?`;
    params.push(req.user.id);
  }
  sql += ` ORDER BY cr.created_at DESC`;
  res.json(rowsToObjects(db.exec(sql, params)));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const row = rowToObject(db.exec(`SELECT * FROM custom_reports WHERE id = ?`, [req.params.id]));
  if (!row) return res.status(404).json({ error: '报表不存在' });
  if (req.user.role !== 'admin' && row.owner_id !== req.user.id) {
    return res.status(403).json({ error: '无权访问' });
  }
  // definition_json 反序列化
  try { row.definition = JSON.parse(row.definition_json); } catch { row.definition = null; }
  delete row.definition_json;
  res.json(row);
});

router.post('/', authMiddleware, validateBody(schemas.customReport), (req, res) => {
  const { name, description, source, definition } = req.body;
  // 校验：源必须存在 + 跑一次 buildSql 验证定义合法
  try {
    buildSql({ ...definition, source });
  } catch (e) {
    return res.status(400).json({ error: `报表定义无效：${e.message}` });
  }
  const db = getDb();
  const id = uuidv4();
  db.run(
    `INSERT INTO custom_reports (id, name, description, source, definition_json, owner_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || '', source, JSON.stringify({ ...definition, source }), req.user.id, req.user.id]
  );
  audit(req, 'create', 'custom_reports', id, null, snapshot('custom_reports', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.customReport), (req, res) => {
  const { name, description, source, definition } = req.body;
  const db = getDb();
  const before = snapshot('custom_reports', req.params.id);
  if (!before) return res.status(404).json({ error: '报表不存在' });
  if (req.user.role !== 'admin' && before.owner_id !== req.user.id) {
    return res.status(403).json({ error: '无权修改' });
  }
  try {
    buildSql({ ...definition, source });
  } catch (e) {
    return res.status(400).json({ error: `报表定义无效：${e.message}` });
  }
  db.run(
    `UPDATE custom_reports SET name=?, description=?, source=?, definition_json=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, description || '', source, JSON.stringify({ ...definition, source }), req.params.id]
  );
  audit(req, 'update', 'custom_reports', req.params.id, before, snapshot('custom_reports', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('custom_reports', req.params.id);
  if (!before) return res.status(404).json({ error: '报表不存在' });
  if (req.user.role !== 'admin' && before.owner_id !== req.user.id) {
    return res.status(403).json({ error: '无权删除' });
  }
  db.run(`DELETE FROM custom_reports WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'custom_reports', req.params.id, before, null);
  res.json({ success: true });
});

// 跑一个保存了的报表
router.post('/:id/run', authMiddleware, (req, res) => {
  const db = getDb();
  const row = rowToObject(db.exec(`SELECT * FROM custom_reports WHERE id = ?`, [req.params.id]));
  if (!row) return res.status(404).json({ error: '报表不存在' });
  if (req.user.role !== 'admin' && row.owner_id !== req.user.id) {
    return res.status(403).json({ error: '无权运行' });
  }
  let definition;
  try { definition = JSON.parse(row.definition_json); } catch {
    return res.status(500).json({ error: '报表定义损坏' });
  }
  runDefinition(db, definition, res);
});

// 预览：直接传定义跑，不保存。便于编辑器实时预览
router.post('/_preview', authMiddleware, (req, res) => {
  const { definition } = req.body || {};
  if (!definition) return res.status(400).json({ error: 'definition 必填' });
  runDefinition(getDb(), definition, res);
});

function runDefinition(db, definition, res) {
  let plan;
  try { plan = buildSql(definition); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const result = db.exec(plan.sql, plan.params);
    const rows = rowsToObjects(result);
    res.json({
      columns: plan.columnsMeta,
      rows: postProcessRows(rows, plan.columnsMeta),
      total: rows.length,
    });
  } catch (e) {
    console.error('[custom-report run]', e, plan.sql);
    res.status(500).json({ error: '查询执行失败' });
  }
}

module.exports = router;
