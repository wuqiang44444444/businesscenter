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
  let sql = `SELECT s.*, (SELECT COALESCE(SUM(ap.amount), 0) FROM accounts_payable ap WHERE ap.supplier_id = s.id) as total_payable, (SELECT COALESCE(SUM(ap.paid_amount), 0) FROM accounts_payable ap WHERE ap.supplier_id = s.id) as total_paid FROM suppliers s`;
  const params = [];
  if (keyword) {
    sql += ` WHERE s.name LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ?`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += ` ORDER BY s.created_at DESC`;
  res.json(rowsToObjects(db.exec(sql, params)));
});

router.get('/:id', authMiddleware, (req, res) => {
  const obj = rowToObject(getDb().exec(`SELECT * FROM suppliers WHERE id = ?`, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '供应商不存在' });
  res.json(obj);
});

router.post('/', authMiddleware, validateBody(schemas.supplier), (req, res) => {
  const { name, contact_person, phone, email, address, category, bank_name, bank_account, remark } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.run(`INSERT INTO suppliers (id, name, contact_person, phone, email, address, category, bank_name, bank_account, remark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, contact_person || '', phone || '', email || '', address || '', category || '', bank_name || '', bank_account || '', remark || '', req.user.id]);
  audit(req, 'create', 'suppliers', id, null, snapshot('suppliers', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.supplier), (req, res) => {
  const { name, contact_person, phone, email, address, category, bank_name, bank_account, remark, status } = req.body;
  const db = getDb();
  const before = snapshot('suppliers', req.params.id);
  db.run(`UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, category=?, bank_name=?, bank_account=?, remark=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, contact_person || '', phone || '', email || '', address || '', category || '', bank_name || '', bank_account || '', remark || '', status || 'active', req.params.id]);
  audit(req, 'update', 'suppliers', req.params.id, before, snapshot('suppliers', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const ap = db.exec(`SELECT COUNT(*) FROM accounts_payable WHERE supplier_id = ?`, [req.params.id]);
  if (ap[0] && ap[0].values[0][0] > 0) return res.status(400).json({ error: '该供应商下还有应付账款，无法删除' });
  const before = snapshot('suppliers', req.params.id);
  db.run(`DELETE FROM suppliers WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'suppliers', req.params.id, before, null);
  res.json({ success: true });
});

module.exports = router;
