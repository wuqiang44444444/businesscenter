const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, toCents, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const { scopeWhere, canAccess } = require('../lib/scope');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  const status = req.query.status || '';
  const scope = scopeWhere(req.user, 'p');
  let sql = `SELECT p.*, c.name as customer_name FROM projects p LEFT JOIN customers c ON p.customer_id = c.id WHERE 1=1${scope.clause}`;
  const params = [...scope.params];
  if (keyword) { sql += ` AND (p.name LIKE ? OR c.name LIKE ?)`; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (status) { sql += ` AND p.status = ?`; params.push(status); }
  sql += ` ORDER BY p.created_at DESC`;
  res.json(moneyOut('projects', rowsToObjects(db.exec(sql, params))));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(
    `SELECT p.*, c.name as customer_name FROM projects p LEFT JOIN customers c ON p.customer_id = c.id WHERE p.id = ?`,
    [req.params.id]
  ));
  if (!obj) return res.status(404).json({ error: '项目不存在' });
  if (!canAccess(req.user, obj)) return res.status(403).json({ error: '无权访问' });
  res.json(moneyOut('projects', obj));
});

router.post('/', authMiddleware, validateBody(schemas.project), (req, res) => {
  const { name, customer_id, status, start_date, end_date, description, manager, budget } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.run(`INSERT INTO projects (id, name, customer_id, status, start_date, end_date, description, manager, budget, created_by, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, customer_id || null, status || 'active', start_date || null, end_date || null, description || '', manager || '', toCents(budget) ?? 0, req.user.id, req.user.id]);
  audit(req, 'create', 'projects', id, null, snapshot('projects', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.project), (req, res) => {
  const { name, customer_id, status, start_date, end_date, description, manager, budget } = req.body;
  const db = getDb();
  const before = snapshot('projects', req.params.id);
  if (!before) return res.status(404).json({ error: '项目不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权修改' });
  db.run(`UPDATE projects SET name=?, customer_id=?, status=?, start_date=?, end_date=?, description=?, manager=?, budget=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, customer_id || null, status || 'active', start_date || null, end_date || null, description || '', manager || '', toCents(budget) ?? 0, req.params.id]);
  audit(req, 'update', 'projects', req.params.id, before, snapshot('projects', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('projects', req.params.id);
  if (!before) return res.status(404).json({ error: '项目不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权删除' });
  const contracts = db.exec(`SELECT COUNT(*) FROM contracts WHERE project_id = ?`, [req.params.id]);
  if (contracts[0] && contracts[0].values[0][0] > 0) return res.status(400).json({ error: '该项目下还有合同，无法删除' });
  const payables = db.exec(`SELECT COUNT(*) FROM accounts_payable WHERE project_id = ?`, [req.params.id]);
  if (payables[0] && payables[0].values[0][0] > 0) return res.status(400).json({ error: '该项目下还有应付账款，无法删除' });
  db.run(`DELETE FROM projects WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'projects', req.params.id, before, null);
  res.json({ success: true });
});

module.exports = router;
