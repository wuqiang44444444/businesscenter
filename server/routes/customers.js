const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const { scopeWhere, canAccess } = require('../lib/scope');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  const scope = scopeWhere(req.user, 'c');
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM contracts WHERE customer_id = c.id) as contract_count FROM customers c WHERE 1=1${scope.clause}`;
  const params = [...scope.params];
  if (keyword) {
    sql += ` AND (c.name LIKE ? OR c.contact_person LIKE ? OR c.phone LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += ` ORDER BY c.created_at DESC`;
  res.json(rowsToObjects(db.exec(sql, params)));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(`SELECT * FROM customers WHERE id = ?`, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '客户不存在' });
  if (!canAccess(req.user, obj)) return res.status(403).json({ error: '无权访问' });
  res.json(obj);
});

router.post('/', authMiddleware, validateBody(schemas.customer), (req, res) => {
  const { name, contact_person, phone, email, address, industry, remark } = req.body;
  const db = getDb();
  const id = uuidv4();
  // owner_id 默认 = 创建人
  db.run(`INSERT INTO customers (id, name, contact_person, phone, email, address, industry, remark, created_by, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, contact_person || '', phone || '', email || '', address || '', industry || '', remark || '', req.user.id, req.user.id]);
  audit(req, 'create', 'customers', id, null, snapshot('customers', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.customer), (req, res) => {
  const { name, contact_person, phone, email, address, industry, remark } = req.body;
  const db = getDb();
  const before = snapshot('customers', req.params.id);
  if (!before) return res.status(404).json({ error: '客户不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权修改' });
  db.run(`UPDATE customers SET name=?, contact_person=?, phone=?, email=?, address=?, industry=?, remark=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, contact_person || '', phone || '', email || '', address || '', industry || '', remark || '', req.params.id]);
  audit(req, 'update', 'customers', req.params.id, before, snapshot('customers', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('customers', req.params.id);
  if (!before) return res.status(404).json({ error: '客户不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权删除' });
  const contracts = db.exec(`SELECT COUNT(*) FROM contracts WHERE customer_id = ?`, [req.params.id]);
  if (contracts[0] && contracts[0].values[0][0] > 0) return res.status(400).json({ error: '该客户下还有合同，无法删除' });
  db.run(`DELETE FROM customers WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'customers', req.params.id, before, null);
  res.json({ success: true });
});

// 转交：仅 admin 可把 owner_id 改给别人
router.post('/:id/transfer', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可转交' });
  const { new_owner_id } = req.body || {};
  if (!new_owner_id) return res.status(400).json({ error: '缺少 new_owner_id' });
  const db = getDb();
  const before = snapshot('customers', req.params.id);
  if (!before) return res.status(404).json({ error: '客户不存在' });
  const u = db.exec(`SELECT id FROM users WHERE id = ? AND status = 'active'`, [new_owner_id]);
  if (!u[0] || u[0].values.length === 0) return res.status(400).json({ error: '目标用户不存在或已禁用' });
  db.run(`UPDATE customers SET owner_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [new_owner_id, req.params.id]);
  audit(req, 'transfer', 'customers', req.params.id, before, snapshot('customers', req.params.id));
  res.json({ success: true });
});

module.exports = router;
