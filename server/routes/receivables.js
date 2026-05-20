const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { rowsToObjects, moneyOut } = require('../lib/helpers');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const status = req.query.status || '';

  let sql = `
    SELECT pp.*,
           c.name as contract_name,
           cust.name as customer_name,
           cust.contact_person,
           cust.phone
    FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    INNER JOIN customers cust ON c.customer_id = cust.id
    WHERE c.status = 'active'
  `;
  if (status === 'overdue') sql += ` AND pp.status = 'pending' AND pp.due_date < date('now', 'localtime')`;
  else if (status === 'pending') sql += ` AND pp.status = 'pending'`;
  else if (status === 'paid') sql += ` AND pp.status = 'paid'`;
  sql += ` ORDER BY pp.due_date ASC`;

  // 应收账款本质就是 payment_plans，所以用同一张表的金额字段定义
  res.json(moneyOut('payment_plans', rowsToObjects(db.exec(sql, []))));
});

router.put('/:id', authMiddleware, (req, res) => {
  const { status, actual_date, remark, bank_account_id } = req.body;
  getDb().run(`UPDATE payment_plans SET status=?, actual_date=?, remark=?, bank_account_id=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [status || 'paid', actual_date || null, remark || '', bank_account_id || null, req.params.id]);
  res.json({ success: true });
});

module.exports = router;
