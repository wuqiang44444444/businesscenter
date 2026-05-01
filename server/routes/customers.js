const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM contracts WHERE customer_id = c.id) as contract_count FROM customers c`;
  const params = [];
  if (keyword) {
    sql += ` WHERE c.name LIKE ? OR c.contact_person LIKE ? OR c.phone LIKE ?`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += ` ORDER BY c.created_at DESC`;
  res.json(rowsToObjects(db.exec(sql, params)));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(`SELECT * FROM customers WHERE id = ?`, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '客户不存在' });
  res.json(obj);
});

router.post('/', authMiddleware, validateBody(schemas.customer), (req, res) => {
  const { name, contact_person, phone, email, address, industry, remark } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.run(`INSERT INTO customers (id, name, contact_person, phone, email, address, industry, remark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, contact_person || '', phone || '', email || '', address || '', industry || '', remark || '', req.user.id]);
  audit(req, 'create', 'customers', id, null, snapshot('customers', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.customer), (req, res) => {
  const { name, contact_person, phone, email, address, industry, remark } = req.body;
  const db = getDb();
  const before = snapshot('customers', req.params.id);
  db.run(`UPDATE customers SET name=?, contact_person=?, phone=?, email=?, address=?, industry=?, remark=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, contact_person || '', phone || '', email || '', address || '', industry || '', remark || '', req.params.id]);
  audit(req, 'update', 'customers', req.params.id, before, snapshot('customers', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const contracts = db.exec(`SELECT COUNT(*) FROM contracts WHERE customer_id = ?`, [req.params.id]);
  if (contracts[0] && contracts[0].values[0][0] > 0) return res.status(400).json({ error: '该客户下还有合同，无法删除' });
  const before = snapshot('customers', req.params.id);
  db.run(`DELETE FROM customers WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'customers', req.params.id, before, null);
  res.json({ success: true });
});

module.exports = router;
