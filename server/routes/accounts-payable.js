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
  const supplier_id = req.query.supplier_id || '';
  const status = req.query.status || '';
  const scope = scopeWhere(req.user, 'ap');
  let sql = `SELECT ap.*, s.name as supplier_name, p.name as project_name FROM accounts_payable ap LEFT JOIN suppliers s ON ap.supplier_id = s.id LEFT JOIN projects p ON ap.project_id = p.id WHERE 1=1${scope.clause}`;
  const params = [...scope.params];
  if (keyword) { sql += ` AND (ap.title LIKE ? OR ap.invoice_no LIKE ?)`; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (supplier_id) { sql += ` AND ap.supplier_id = ?`; params.push(supplier_id); }
  if (status) { sql += ` AND ap.status = ?`; params.push(status); }
  sql += ` ORDER BY ap.due_date ASC, ap.created_at DESC`;
  res.json(moneyOut('accounts_payable', rowsToObjects(db.exec(sql, params))));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(
    `SELECT ap.*, s.name as supplier_name, p.name as project_name FROM accounts_payable ap LEFT JOIN suppliers s ON ap.supplier_id = s.id LEFT JOIN projects p ON ap.project_id = p.id WHERE ap.id = ?`,
    [req.params.id]
  ));
  if (!obj) return res.status(404).json({ error: '应付账款不存在' });
  moneyOut('accounts_payable', obj);
  obj.payments = moneyOut('payable_payments', rowsToObjects(db.exec(`SELECT * FROM payable_payments WHERE payable_id = ? ORDER BY payment_date DESC`, [req.params.id])));
  res.json(obj);
});

router.post('/', authMiddleware, validateBody(schemas.accountsPayable), (req, res) => {
  const { supplier_id, project_id, title, amount, due_date, invoice_no, description } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.run(`INSERT INTO accounts_payable (id, supplier_id, project_id, title, amount, due_date, invoice_no, description, created_by, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, supplier_id, project_id || null, title, toCents(amount) ?? 0, due_date || null, invoice_no || '', description || '', req.user.id, req.user.id]);
  audit(req, 'create', 'accounts_payable', id, null, snapshot('accounts_payable', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.accountsPayable), (req, res) => {
  const { supplier_id, project_id, title, amount, due_date, invoice_no, description, status } = req.body;
  const db = getDb();
  const before = snapshot('accounts_payable', req.params.id);
  if (!before) return res.status(404).json({ error: '应付账款不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权修改' });
  db.run(`UPDATE accounts_payable SET supplier_id=?, project_id=?, title=?, amount=?, due_date=?, invoice_no=?, description=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [supplier_id, project_id || null, title, toCents(amount) ?? 0, due_date || null, invoice_no || '', description || '', status || 'pending', req.params.id]);
  audit(req, 'update', 'accounts_payable', req.params.id, before, snapshot('accounts_payable', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('accounts_payable', req.params.id);
  if (!before) return res.status(404).json({ error: '应付账款不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权删除' });
  db.run(`DELETE FROM accounts_payable WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'accounts_payable', req.params.id, before, null);
  res.json({ success: true });
});

router.get('/:payableId/payments', authMiddleware, (req, res) => {
  res.json(moneyOut('payable_payments', rowsToObjects(getDb().exec(`SELECT * FROM payable_payments WHERE payable_id = ? ORDER BY payment_date DESC`, [req.params.payableId]))));
});

module.exports = router;
