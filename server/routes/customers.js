const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, toCents, toYuan, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const { scopeWhere, canAccess } = require('../lib/scope');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  const level = req.query.level || '';
  const scope = scopeWhere(req.user, 'c');
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM contracts WHERE customer_id = c.id) as contract_count FROM customers c WHERE 1=1${scope.clause}`;
  const params = [...scope.params];
  if (keyword) {
    sql += ` AND (c.name LIKE ? OR c.contact_person LIKE ? OR c.phone LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (level) {
    sql += ` AND c.level = ?`;
    params.push(level);
  }
  sql += ` ORDER BY c.created_at DESC`;
  res.json(moneyOut('customers', rowsToObjects(db.exec(sql, params))));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(`SELECT * FROM customers WHERE id = ?`, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '客户不存在' });
  if (!canAccess(req.user, obj)) return res.status(403).json({ error: '无权访问' });
  res.json(moneyOut('customers', obj));
});

// 信用状态：已用额度（active 合同未收款部分）+ 是否超额 + 是否逾期
router.get('/:id/credit-status', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(`SELECT * FROM customers WHERE id = ?`, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '客户不存在' });
  if (!canAccess(req.user, obj)) return res.status(403).json({ error: '无权访问' });

  // 已用额度 = active 合同的未付款（pending）payment_plans 总和
  const usedRow = db.exec(`
    SELECT COALESCE(SUM(pp.amount), 0) AS used FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.customer_id = ? AND c.status = 'active' AND pp.status = 'pending'
  `, [req.params.id]);
  const usedCents = usedRow[0]?.values[0][0] || 0;

  // 逾期金额（已到期但未收）
  const overdueRow = db.exec(`
    SELECT COALESCE(SUM(pp.amount), 0) AS overdue FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.customer_id = ? AND c.status = 'active' AND pp.status = 'pending'
      AND pp.due_date < date('now', 'localtime')
  `, [req.params.id]);
  const overdueCents = overdueRow[0]?.values[0][0] || 0;

  // 历史回款（已 paid 的）+ 历史成交总额
  const histRow = db.exec(`
    SELECT
      COALESCE(SUM(CASE WHEN pp.status = 'paid' THEN pp.amount ELSE 0 END), 0) AS paid_total,
      COALESCE(SUM(pp.amount), 0) AS plan_total
    FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.customer_id = ?
  `, [req.params.id]);
  const paidTotalCents = histRow[0]?.values[0][0] || 0;
  const planTotalCents = histRow[0]?.values[0][1] || 0;

  const creditLimitCents = obj.credit_limit || 0;
  const available = Math.max(0, creditLimitCents - usedCents);
  const overLimit = creditLimitCents > 0 && usedCents > creditLimitCents;

  res.json({
    credit_limit: toYuan(creditLimitCents),
    used: toYuan(usedCents),
    available: toYuan(available),
    overdue: toYuan(overdueCents),
    paid_total: toYuan(paidTotalCents),
    plan_total: toYuan(planTotalCents),
    over_limit: overLimit,
    has_overdue: overdueCents > 0,
    usage_rate: creditLimitCents > 0
      ? Number((usedCents / creditLimitCents * 100).toFixed(1))
      : null,
    payment_terms_days: obj.payment_terms_days || 0,
    level: obj.level || 'normal',
  });
});

router.post('/', authMiddleware, validateBody(schemas.customer), (req, res) => {
  const { name, contact_person, phone, email, address, industry, remark, level, credit_limit, payment_terms_days } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.run(`INSERT INTO customers (id, name, contact_person, phone, email, address, industry, remark, level, credit_limit, payment_terms_days, created_by, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, contact_person || '', phone || '', email || '', address || '', industry || '', remark || '',
     level || 'normal', toCents(credit_limit) ?? 0, payment_terms_days ?? 0,
     req.user.id, req.user.id]);
  audit(req, 'create', 'customers', id, null, snapshot('customers', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.customer), (req, res) => {
  const { name, contact_person, phone, email, address, industry, remark, level, credit_limit, payment_terms_days } = req.body;
  const db = getDb();
  const before = snapshot('customers', req.params.id);
  if (!before) return res.status(404).json({ error: '客户不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权修改' });
  db.run(`UPDATE customers SET name=?, contact_person=?, phone=?, email=?, address=?, industry=?, remark=?, level=?, credit_limit=?, payment_terms_days=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, contact_person || '', phone || '', email || '', address || '', industry || '', remark || '',
     level || 'normal', toCents(credit_limit) ?? 0, payment_terms_days ?? 0,
     req.params.id]);
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
