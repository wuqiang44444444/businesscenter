const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, generatePaymentPlans, toCents, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const { scopeWhere, canAccess } = require('../lib/scope');
const schemas = require('../schemas');

const router = express.Router();

// 待审批数（导航栏徽章用）。必须放在 /:id 之前，避免被通配匹配
router.get('/_pending_count', authMiddleware, (req, res) => {
  const r = getDb().exec(`SELECT COUNT(*) FROM contracts WHERE approval_status = 'submitted'`);
  res.json({ count: r[0]?.values[0][0] || 0 });
});

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  const customer_id = req.query.customer_id || '';
  const approval_status = req.query.approval_status || '';
  const scope = scopeWhere(req.user, 'ct');
  let sql = `SELECT ct.*, c.name as customer_name, p.name as project_name FROM contracts ct LEFT JOIN customers c ON ct.customer_id = c.id LEFT JOIN projects p ON ct.project_id = p.id WHERE 1=1${scope.clause}`;
  const params = [...scope.params];
  if (keyword) { sql += ` AND (ct.name LIKE ? OR ct.contract_no LIKE ?)`; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (customer_id) { sql += ` AND ct.customer_id = ?`; params.push(customer_id); }
  if (approval_status) { sql += ` AND ct.approval_status = ?`; params.push(approval_status); }
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
  if (!canAccess(req.user, obj)) return res.status(403).json({ error: '无权访问' });
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
    // 新合同默认 draft，需要走审批流。submitted_by 同时记下创建人方便审计
    db.run(`INSERT INTO contracts (id, name, customer_id, project_id, contract_no, amount, payment_mode, start_date, end_date, description, created_by, owner_id, approval_status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [id, name, customer_id, project_id || null, contract_no || '', amountCents, payment_mode || 'monthly', start_date || null, end_date || null, description || '', req.user.id, req.user.id, req.user.id]);

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
  if (!before) return res.status(404).json({ error: '合同不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权修改' });
  db.run(`UPDATE contracts SET name=?, customer_id=?, project_id=?, contract_no=?, amount=?, payment_mode=?, start_date=?, end_date=?, status=?, description=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [name, customer_id, project_id || null, contract_no || '', toCents(amount) ?? 0, payment_mode || 'monthly', start_date || null, end_date || null, status || 'active', description || '', req.params.id]);
  audit(req, 'update', 'contracts', req.params.id, before, snapshot('contracts', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('contracts', req.params.id);
  if (!before) return res.status(404).json({ error: '合同不存在' });
  if (!canAccess(req.user, before)) return res.status(403).json({ error: '无权删除' });
  db.run(`DELETE FROM contracts WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'contracts', req.params.id, before, null);
  res.json({ success: true });
});

// ============ 审批工作流 ============
// 创建人或 admin 提交审批：draft / rejected → submitted
router.post('/:id/submit', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('contracts', req.params.id);
  if (!before) return res.status(404).json({ error: '合同不存在' });
  if (!['draft', 'rejected'].includes(before.approval_status)) {
    return res.status(400).json({ error: `当前状态 ${before.approval_status} 不可提交` });
  }
  if (before.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只有创建人或管理员可以提交审批' });
  }
  db.run(
    `UPDATE contracts SET approval_status='submitted', submitted_at=strftime('%Y-%m-%d %H:%M:%f','now','localtime'),
       submitted_by=?, approval_remark=NULL, updated_at=datetime('now','localtime') WHERE id=?`,
    [req.user.id, req.params.id]
  );
  audit(req, 'submit', 'contracts', req.params.id, before, snapshot('contracts', req.params.id));
  res.json({ success: true });
});

// admin 审批通过：submitted → approved
router.post('/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('contracts', req.params.id);
  if (!before) return res.status(404).json({ error: '合同不存在' });
  if (before.approval_status !== 'submitted') {
    return res.status(400).json({ error: '只能审批已提交的合同' });
  }
  db.run(
    `UPDATE contracts SET approval_status='approved', approved_at=strftime('%Y-%m-%d %H:%M:%f','now','localtime'),
       approved_by=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [req.user.id, req.params.id]
  );
  audit(req, 'approve', 'contracts', req.params.id, before, snapshot('contracts', req.params.id));
  res.json({ success: true });
});

// admin 驳回：submitted → rejected（要写驳回理由）
router.post('/:id/reject', authMiddleware, adminMiddleware, (req, res) => {
  const { remark } = req.body || {};
  if (!remark || typeof remark !== 'string' || remark.trim().length === 0) {
    return res.status(400).json({ error: '驳回必须填写理由' });
  }
  const db = getDb();
  const before = snapshot('contracts', req.params.id);
  if (!before) return res.status(404).json({ error: '合同不存在' });
  if (before.approval_status !== 'submitted') {
    return res.status(400).json({ error: '只能驳回已提交的合同' });
  }
  db.run(
    `UPDATE contracts SET approval_status='rejected', approval_remark=?,
       approved_at=strftime('%Y-%m-%d %H:%M:%f','now','localtime'),
       approved_by=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [remark.trim(), req.user.id, req.params.id]
  );
  audit(req, 'reject', 'contracts', req.params.id, before, snapshot('contracts', req.params.id));
  res.json({ success: true });
});

router.get('/:contractId/payment-plans', authMiddleware, (req, res) => {
  res.json(moneyOut('payment_plans', rowsToObjects(getDb().exec(`SELECT * FROM payment_plans WHERE contract_id = ? ORDER BY due_date`, [req.params.contractId]))));
});

router.get('/:contractId/invoices', authMiddleware, (req, res) => {
  res.json(moneyOut('invoices', rowsToObjects(getDb().exec(`SELECT * FROM invoices WHERE contract_id = ? ORDER BY created_at DESC`, [req.params.contractId]))));
});

module.exports = router;
