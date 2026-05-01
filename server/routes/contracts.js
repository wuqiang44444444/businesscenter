const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, generatePaymentPlans, toCents, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  const customer_id = req.query.customer_id || '';
  let sql = `SELECT ct.*, c.name as customer_name, p.name as project_name FROM contracts ct LEFT JOIN customers c ON ct.customer_id = c.id LEFT JOIN projects p ON ct.project_id = p.id WHERE 1=1`;
  const params = [];
  if (keyword) { sql += ` AND (ct.name LIKE ? OR ct.contract_no LIKE ?)`; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (customer_id) { sql += ` AND ct.customer_id = ?`; params.push(customer_id); }
  sql += ` ORDER BY ct.created_at DESC`;
  res.json(moneyOut('contracts', rowsToObjects(db.exec(sql, params))));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(
    `SELECT ct.*, c.name as customer_name, p.name as project_name FROM contracts ct LEFT JOIN customers c ON ct.customer_id = c.id LEFT JOIN projects p ON ct.project_id = p.id WHERE ct.id = ?`,
    [req.params.id]
  ));
  if (!obj) return res.status(404).json({ error: '合同不存在' });
  moneyOut('contracts', obj);
  obj.payment_plans = moneyOut('payment_plans', rowsToObjects(db.exec(`SELECT * FROM payment_plans WHERE contract_id = ? ORDER BY due_date`, [req.params.id])));
  res.json(obj);
});

router.post('/', authMiddleware, validateBody(schemas.contract), (req, res) => {
  const { name, customer_id, project_id, contract_no, amount, payment_mode, start_date, end_date, description, payment_plans } = req.body;
  const db = getDb();
  const id = uuidv4();
  const amountCents = toCents(amount) ?? 0;

  const tx = db.transaction(() => {
    db.run(`INSERT INTO contracts (id, name, customer_id, project_id, contract_no, amount, payment_mode, start_date, end_date, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, customer_id, project_id || null, contract_no || '', amountCents, payment_mode || 'monthly', start_date || null, end_date || null, description || '', req.user.id]);

    if (payment_plans && payment_plans.length > 0) {
      payment_plans.forEach(plan => {
        db.run(`INSERT INTO payment_plans (id, contract_id, period, amount, due_date, status, remark) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, plan.period || '', toCents(plan.amount) ?? 0, plan.due_date || null, 'pending', plan.remark || '']);
      });
    } else if (payment_mode && amount && start_date) {
      // generatePaymentPlans 入参出参都是元，分摊在内部用分，外面再转回分入库
      const plans = generatePaymentPlans(id, payment_mode, amount, start_date);
      plans.forEach(plan => {
        db.run(`INSERT INTO payment_plans (id, contract_id, period, amount, due_date, status, remark) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, plan.period, toCents(plan.amount) ?? 0, plan.due_date, 'pending', plan.remark || '']);
      });
    }
  });
  tx();

  audit(req, 'create', 'contracts', id, null, snapshot('contracts', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.contract), (req, res) => {
  const { name, customer_id, project_id, contract_no, amount, payment_mode, start_date, end_date, status, description } = req.body;
  const db = getDb();
  const before = snapshot('contracts', req.params.id);
  db.run(`UPDATE contracts SET name=?, customer_id=?, project_id=?, contract_no=?, amount=?, payment_mode=?, start_date=?, end_date=?, status=?, description=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, customer_id, project_id || null, contract_no || '', toCents(amount) ?? 0, payment_mode || 'monthly', start_date || null, end_date || null, status || 'active', description || '', req.params.id]);
  audit(req, 'update', 'contracts', req.params.id, before, snapshot('contracts', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('contracts', req.params.id);
  db.run(`DELETE FROM contracts WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'contracts', req.params.id, before, null);
  res.json({ success: true });
});

router.get('/:contractId/payment-plans', authMiddleware, (req, res) => {
  res.json(moneyOut('payment_plans', rowsToObjects(getDb().exec(`SELECT * FROM payment_plans WHERE contract_id = ? ORDER BY due_date`, [req.params.contractId]))));
});

router.get('/:contractId/invoices', authMiddleware, (req, res) => {
  res.json(moneyOut('invoices', rowsToObjects(getDb().exec(`SELECT * FROM invoices WHERE contract_id = ? ORDER BY created_at DESC`, [req.params.contractId]))));
});

module.exports = router;
