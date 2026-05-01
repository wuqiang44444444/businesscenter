const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { rowsToObjects, moneyOut, toYuan } = require('../lib/helpers');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const customerCount = db.exec(`SELECT COUNT(*) FROM customers`);
  const projectCount = db.exec(`SELECT COUNT(*) FROM projects WHERE status = 'active'`);
  const contractCount = db.exec(`SELECT COUNT(*) FROM contracts WHERE status = 'active'`);
  const totalAmount = db.exec(`SELECT COALESCE(SUM(amount), 0) FROM contracts WHERE status = 'active'`);
  const recentContracts = db.exec(`SELECT ct.*, c.name as customer_name FROM contracts ct LEFT JOIN customers c ON ct.customer_id = c.id ORDER BY ct.created_at DESC LIMIT 5`);

  const supplierCount = db.exec(`SELECT COUNT(*) FROM suppliers WHERE status = 'active'`);
  const totalPayable = db.exec(`SELECT COALESCE(SUM(amount), 0) FROM accounts_payable WHERE status != 'paid'`);
  const totalPaid = db.exec(`SELECT COALESCE(SUM(paid_amount), 0) FROM accounts_payable`);

  const totalReceivable = db.exec(`
    SELECT COALESCE(SUM(amount), 0) FROM payment_plans
    WHERE status = 'pending' AND contract_id IN (SELECT id FROM contracts WHERE status = 'active')
  `);
  const receivedAmount = db.exec(`
    SELECT COALESCE(SUM(amount), 0) FROM payment_plans
    WHERE status = 'paid' AND contract_id IN (SELECT id FROM contracts WHERE status = 'active')
  `);
  const overdueReceivable = db.exec(`
    SELECT COALESCE(SUM(amount), 0) FROM payment_plans
    WHERE status = 'pending' AND due_date < date('now', 'localtime')
    AND contract_id IN (SELECT id FROM contracts WHERE status = 'active')
  `);

  // 所有 SUM 出来的都是"分"，对外统一转回"元"
  const cents = (r) => r[0]?.values[0][0] || 0;
  res.json({
    customerCount: customerCount[0]?.values[0][0] || 0,
    projectCount: projectCount[0]?.values[0][0] || 0,
    contractCount: contractCount[0]?.values[0][0] || 0,
    totalAmount: toYuan(cents(totalAmount)),
    totalReceivable: toYuan(cents(totalReceivable)),
    receivedAmount: toYuan(cents(receivedAmount)),
    overdueReceivable: toYuan(cents(overdueReceivable)),
    supplierCount: supplierCount[0]?.values[0][0] || 0,
    totalPayable: toYuan(cents(totalPayable)),
    totalPaid: toYuan(cents(totalPaid)),
    recentContracts: moneyOut('contracts', rowsToObjects(recentContracts)),
  });
});

module.exports = router;
