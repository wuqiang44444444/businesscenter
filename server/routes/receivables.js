// 应收账款：本质是 active 合同的 payment_plans 视图
// 权限继承自合同：非 admin/finance 只能看到/改自己 owner 的合同的收款计划
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const { canSeeAll } = require('../lib/scope');
const schemas = require('../schemas');

const router = express.Router();

// 列表：?status=overdue|pending|paid，?customer_id=...，?keyword=...
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const { status = '', customer_id = '', keyword = '' } = req.query;

  let sql = `
    SELECT pp.*,
           c.name AS contract_name,
           c.contract_no,
           cust.id AS customer_id,
           cust.name AS customer_name,
           cust.contact_person,
           cust.phone,
           ba.name AS bank_account_name
    FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    INNER JOIN customers cust ON c.customer_id = cust.id
    LEFT JOIN bank_accounts ba ON pp.bank_account_id = ba.id
    WHERE c.status = 'active'
  `;
  const params = [];

  // 数据权限：非 admin/finance 只看自己 owner 的合同
  if (!canSeeAll(req.user)) {
    sql += ` AND c.owner_id = ?`;
    params.push(req.user.id);
  }
  if (status === 'overdue') sql += ` AND pp.status = 'pending' AND pp.due_date < date('now', 'localtime')`;
  else if (status === 'pending') sql += ` AND pp.status = 'pending'`;
  else if (status === 'paid') sql += ` AND pp.status = 'paid'`;
  if (customer_id) { sql += ` AND cust.id = ?`; params.push(customer_id); }
  if (keyword) {
    sql += ` AND (c.name LIKE ? OR cust.name LIKE ? OR pp.period LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += ` ORDER BY pp.due_date ASC`;

  res.json(moneyOut('payment_plans', rowsToObjects(db.exec(sql, params))));
});

// 标记某笔收款计划的状态（标记已收 / 改备注 / 关联银行账户）
router.put('/:id', authMiddleware, validateBody(schemas.receivableUpdate), (req, res) => {
  const { status, actual_date, remark, bank_account_id } = req.body;
  const db = getDb();

  // 查 pp + 它所属合同的 owner_id 做权限判断
  const r = db.exec(`
    SELECT pp.*, c.owner_id AS contract_owner_id
    FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE pp.id = ?
  `, [req.params.id]);
  const before = rowToObject(r);
  if (!before) return res.status(404).json({ error: '收款计划不存在' });

  if (!canSeeAll(req.user) && before.contract_owner_id !== req.user.id) {
    return res.status(403).json({ error: '无权修改' });
  }

  // 只更新传进来的字段，未传的保持原值
  const newStatus = status !== undefined ? status : before.status;
  const newActualDate = actual_date !== undefined ? actual_date : before.actual_date;
  const newRemark = remark !== undefined ? remark : (before.remark || '');
  const newBankAccountId = bank_account_id !== undefined ? bank_account_id : before.bank_account_id;

  db.run(
    `UPDATE payment_plans SET status=?, actual_date=?, remark=?, bank_account_id=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [newStatus, newActualDate || null, newRemark || '', newBankAccountId || null, req.params.id]
  );
  audit(req, 'update', 'payment_plans', req.params.id, before, snapshot('payment_plans', req.params.id));
  res.json({ success: true });
});

module.exports = router;
