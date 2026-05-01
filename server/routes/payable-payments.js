const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');
const { toCents } = require('../lib/helpers');

const router = express.Router();

// payable_payments 内部全程以"分"运算，paid_amount 也存"分"。
// 入参 amount 是元 → toCents() → 入库；SUM 出来的是分整数，直接比较。
function recomputePaidStatus(db, payable_id) {
  const totalPaid = db.exec(`SELECT COALESCE(SUM(amount), 0) FROM payable_payments WHERE payable_id = ?`, [payable_id]);
  const paidCents = totalPaid[0]?.values[0][0] || 0;
  const ap = db.exec(`SELECT amount FROM accounts_payable WHERE id = ?`, [payable_id]);
  const totalCents = ap[0]?.values[0][0] || 0;
  const newStatus = paidCents >= totalCents ? 'paid' : (paidCents > 0 ? 'partial' : 'pending');
  db.run(`UPDATE accounts_payable SET paid_amount=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [paidCents, newStatus, payable_id]);
}

router.post('/', authMiddleware, validateBody(schemas.payablePayment), (req, res) => {
  const { payable_id, amount, payment_date, payment_method, remark } = req.body;
  const db = getDb();
  const id = uuidv4();

  const tx = db.transaction(() => {
    db.run(`INSERT INTO payable_payments (id, payable_id, amount, payment_date, payment_method, remark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, payable_id, toCents(amount) ?? 0, payment_date || null, payment_method || '', remark || '', req.user.id]);
    recomputePaidStatus(db, payable_id);
  });
  tx();

  res.json({ id });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const record = db.exec(`SELECT payable_id FROM payable_payments WHERE id = ?`, [req.params.id]);
  if (!record[0]) return res.status(404).json({ error: '记录不存在' });
  const payable_id = record[0].values[0][0];

  const tx = db.transaction(() => {
    db.run(`DELETE FROM payable_payments WHERE id = ?`, [req.params.id]);
    recomputePaidStatus(db, payable_id);
  });
  tx();

  res.json({ success: true });
});

module.exports = router;
