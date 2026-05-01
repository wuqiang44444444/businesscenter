const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');
const { toCents } = require('../lib/helpers');

const router = express.Router();

router.put('/:id', authMiddleware, validateBody(schemas.paymentPlanUpdate), (req, res) => {
  const { amount, due_date, actual_date, status, remark } = req.body;
  getDb().run(`UPDATE payment_plans SET amount=?, due_date=?, actual_date=?, status=?, remark=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [toCents(amount) ?? 0, due_date || null, actual_date || null, status || 'pending', remark || '', req.params.id]);
  res.json({ success: true });
});

router.post('/', authMiddleware, validateBody(schemas.paymentPlan), (req, res) => {
  const { contract_id, period, amount, due_date, remark } = req.body;
  const id = uuidv4();
  getDb().run(`INSERT INTO payment_plans (id, contract_id, period, amount, due_date, status, remark) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, contract_id, period || '', toCents(amount) ?? 0, due_date || null, 'pending', remark || '']);
  res.json({ id });
});

router.delete('/:id', authMiddleware, (req, res) => {
  getDb().run(`DELETE FROM payment_plans WHERE id = ?`, [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
