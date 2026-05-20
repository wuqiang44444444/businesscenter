// 费用报销单
// 状态机：submitted → approved → paid | rejected
// - 员工：创建、编辑（仅 submitted）、查看自己的、删除（submitted）
// - admin/finance：看全部 + 审批（approve/reject）+ 标记已付（mark-paid）

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, toCents, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

function isFinance(user) {
  return user?.role === 'admin' || user?.role === 'finance';
}

// 金额转换：单 reimbursement 表的 amount 字段（这里没用 moneyOut 因为表名不在白名单）
function reimToYuan(row) {
  if (!row) return row;
  if (row.amount != null) row.amount = (Number(row.amount) || 0) / 100;
  return row;
}

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const status = req.query.status || '';
  const mine = req.query.mine === 'true';

  let sql = `
    SELECT r.*, u.username AS applicant_name, u.real_name AS applicant_real_name,
      au.username AS approved_by_name, pu.username AS paid_by_name,
      ba.name AS bank_account_name
    FROM reimbursements r
    LEFT JOIN users u ON r.applicant_id = u.id
    LEFT JOIN users au ON r.approved_by = au.id
    LEFT JOIN users pu ON r.paid_by = pu.id
    LEFT JOIN bank_accounts ba ON r.bank_account_id = ba.id
    WHERE 1=1
  `;
  const params = [];

  if (!isFinance(req.user) || mine) {
    sql += ` AND r.applicant_id = ?`;
    params.push(req.user.id);
  }
  if (status) {
    sql += ` AND r.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY r.created_at DESC`;

  const rows = rowsToObjects(db.exec(sql, params)).map(reimToYuan);
  res.json(rows);
});

router.get('/_pending_count', authMiddleware, (req, res) => {
  if (!isFinance(req.user)) return res.json({ count: 0 });
  const r = getDb().exec(`SELECT COUNT(*) FROM reimbursements WHERE status = 'submitted'`);
  res.json({ count: r[0]?.values[0][0] || 0 });
});

router.get('/:id', authMiddleware, (req, res) => {
  const r = getDb().exec(`
    SELECT r.*, u.username AS applicant_name, u.real_name AS applicant_real_name,
      au.username AS approved_by_name, pu.username AS paid_by_name,
      ba.name AS bank_account_name
    FROM reimbursements r
    LEFT JOIN users u ON r.applicant_id = u.id
    LEFT JOIN users au ON r.approved_by = au.id
    LEFT JOIN users pu ON r.paid_by = pu.id
    LEFT JOIN bank_accounts ba ON r.bank_account_id = ba.id
    WHERE r.id = ?
  `, [req.params.id]);
  const row = rowToObject(r);
  if (!row) return res.status(404).json({ error: '报销单不存在' });
  if (!isFinance(req.user) && row.applicant_id !== req.user.id) {
    return res.status(403).json({ error: '无权访问' });
  }
  res.json(reimToYuan(row));
});

router.post('/', authMiddleware, validateBody(schemas.reimbursement), (req, res) => {
  const { title, category, amount, occurred_date, description } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.run(
    `INSERT INTO reimbursements (id, applicant_id, title, category, amount, occurred_date, description) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.id, title, category || 'other', toCents(amount) ?? 0, occurred_date || null, description || '']
  );
  audit(req, 'create', 'reimbursements', id, null, snapshot('reimbursements', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.reimbursement), (req, res) => {
  const { title, category, amount, occurred_date, description } = req.body;
  const db = getDb();
  const before = snapshot('reimbursements', req.params.id);
  if (!before) return res.status(404).json({ error: '报销单不存在' });
  if (before.applicant_id !== req.user.id && !isFinance(req.user)) {
    return res.status(403).json({ error: '无权修改' });
  }
  if (before.status !== 'submitted') {
    return res.status(400).json({ error: `状态 ${before.status} 不可编辑（仅 submitted 可改）` });
  }
  db.run(
    `UPDATE reimbursements SET title=?, category=?, amount=?, occurred_date=?, description=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [title, category || 'other', toCents(amount) ?? 0, occurred_date || null, description || '', req.params.id]
  );
  audit(req, 'update', 'reimbursements', req.params.id, before, snapshot('reimbursements', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('reimbursements', req.params.id);
  if (!before) return res.status(404).json({ error: '报销单不存在' });
  // 只有申请人本人或 admin 可删，且只能在 submitted/rejected 状态删
  const allowed = (before.applicant_id === req.user.id || req.user.role === 'admin')
    && ['submitted', 'rejected'].includes(before.status);
  if (!allowed) return res.status(400).json({ error: '该状态不可删除' });
  db.run(`DELETE FROM reimbursements WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'reimbursements', req.params.id, before, null);
  res.json({ success: true });
});

// ============ 审批 ============
router.post('/:id/approve', authMiddleware, (req, res) => {
  if (!isFinance(req.user)) return res.status(403).json({ error: '仅财务/管理员可审批' });
  const db = getDb();
  const before = snapshot('reimbursements', req.params.id);
  if (!before) return res.status(404).json({ error: '报销单不存在' });
  if (before.status !== 'submitted') return res.status(400).json({ error: '只能审批提交状态的报销单' });
  db.run(
    `UPDATE reimbursements SET status='approved', approved_by=?, approved_at=strftime('%Y-%m-%d %H:%M:%f','now','localtime'),
       approval_remark=NULL, updated_at=datetime('now','localtime') WHERE id=?`,
    [req.user.id, req.params.id]
  );
  audit(req, 'approve', 'reimbursements', req.params.id, before, snapshot('reimbursements', req.params.id));
  res.json({ success: true });
});

router.post('/:id/reject', authMiddleware, (req, res) => {
  if (!isFinance(req.user)) return res.status(403).json({ error: '仅财务/管理员可驳回' });
  const { remark } = req.body || {};
  if (!remark || typeof remark !== 'string' || remark.trim().length === 0) {
    return res.status(400).json({ error: '驳回必须填写理由' });
  }
  const db = getDb();
  const before = snapshot('reimbursements', req.params.id);
  if (!before) return res.status(404).json({ error: '报销单不存在' });
  if (before.status !== 'submitted') return res.status(400).json({ error: '只能驳回提交状态的报销单' });
  db.run(
    `UPDATE reimbursements SET status='rejected', approval_remark=?, approved_by=?,
       approved_at=strftime('%Y-%m-%d %H:%M:%f','now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
    [remark.trim(), req.user.id, req.params.id]
  );
  audit(req, 'reject', 'reimbursements', req.params.id, before, snapshot('reimbursements', req.params.id));
  res.json({ success: true });
});

// 标记已付款
router.post('/:id/mark-paid', authMiddleware, validateBody(schemas.reimbursementAction), (req, res) => {
  if (!isFinance(req.user)) return res.status(403).json({ error: '仅财务/管理员可标记付款' });
  const { bank_account_id } = req.body || {};
  const db = getDb();
  const before = snapshot('reimbursements', req.params.id);
  if (!before) return res.status(404).json({ error: '报销单不存在' });
  if (before.status !== 'approved') return res.status(400).json({ error: '只能标记已审批通过的报销单' });
  db.run(
    `UPDATE reimbursements SET status='paid', paid_by=?,
       paid_at=strftime('%Y-%m-%d %H:%M:%f','now','localtime'),
       bank_account_id=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [req.user.id, bank_account_id || null, req.params.id]
  );
  audit(req, 'mark-paid', 'reimbursements', req.params.id, before, snapshot('reimbursements', req.params.id));
  res.json({ success: true });
});

module.exports = router;
