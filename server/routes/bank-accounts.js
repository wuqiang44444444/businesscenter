const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

// 谁能改：admin / finance 可创建/编辑/删除；其它人只能看
function canManage(user) {
  return user?.role === 'admin' || user?.role === 'finance';
}

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  let sql = `SELECT * FROM bank_accounts WHERE 1=1`;
  const params = [];
  if (keyword) {
    sql += ` AND (name LIKE ? OR bank_name LIKE ? OR account_number LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += ` ORDER BY is_default DESC, created_at DESC`;
  res.json(rowsToObjects(db.exec(sql, params)));
});

router.get('/:id', authMiddleware, (req, res) => {
  const obj = rowToObject(getDb().exec(`SELECT * FROM bank_accounts WHERE id = ?`, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '账户不存在' });
  res.json(obj);
});

router.post('/', authMiddleware, validateBody(schemas.bankAccount), (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '仅财务/管理员可创建银行账户' });
  const { name, bank_name, account_number, currency, is_default, remark } = req.body;
  const db = getDb();
  const id = uuidv4();

  const tx = db.transaction(() => {
    // 设为 default 时，先把其它账户的 default 标志清掉（同币种内唯一）
    if (is_default) {
      db.run(`UPDATE bank_accounts SET is_default = 0 WHERE currency = ?`, [currency || 'CNY']);
    }
    db.run(
      `INSERT INTO bank_accounts (id, name, bank_name, account_number, currency, is_default, remark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, bank_name || '', account_number || '', currency || 'CNY', is_default ? 1 : 0, remark || '', req.user.id]
    );
  });
  tx();

  audit(req, 'create', 'bank_accounts', id, null, snapshot('bank_accounts', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.bankAccount), (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '仅财务/管理员可修改' });
  const { name, bank_name, account_number, currency, is_default, status, remark } = req.body;
  const db = getDb();
  const before = snapshot('bank_accounts', req.params.id);
  if (!before) return res.status(404).json({ error: '账户不存在' });

  const tx = db.transaction(() => {
    if (is_default) {
      db.run(`UPDATE bank_accounts SET is_default = 0 WHERE currency = ? AND id != ?`,
        [currency || 'CNY', req.params.id]);
    }
    db.run(
      `UPDATE bank_accounts SET name=?, bank_name=?, account_number=?, currency=?, is_default=?, status=?, remark=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [name, bank_name || '', account_number || '', currency || 'CNY', is_default ? 1 : 0, status || 'active', remark || '', req.params.id]
    );
  });
  tx();
  audit(req, 'update', 'bank_accounts', req.params.id, before, snapshot('bank_accounts', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '仅财务/管理员可删除' });
  const db = getDb();
  const before = snapshot('bank_accounts', req.params.id);
  if (!before) return res.status(404).json({ error: '账户不存在' });

  // 校验：有付款记录关联的账户不能删（防止数据失联）
  const usedPay = db.exec(`SELECT COUNT(*) FROM payable_payments WHERE bank_account_id = ?`, [req.params.id]);
  const usedRecv = db.exec(`SELECT COUNT(*) FROM payment_plans WHERE bank_account_id = ?`, [req.params.id]);
  const usedCount = (usedPay[0]?.values[0][0] || 0) + (usedRecv[0]?.values[0][0] || 0);
  if (usedCount > 0) {
    return res.status(400).json({ error: `该账户已有 ${usedCount} 条收付款记录关联，无法删除。可改状态为「停用」` });
  }

  db.run(`DELETE FROM bank_accounts WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'bank_accounts', req.params.id, before, null);
  res.json({ success: true });
});

// 账户余额统计：列出所有账户 + 实际收/付总额（仅基于关联了 bank_account_id 的记录）
router.get('/_/balance', authMiddleware, (req, res) => {
  const db = getDb();
  const rows = rowsToObjects(db.exec(`
    SELECT ba.id, ba.name, ba.bank_name, ba.account_number, ba.currency, ba.is_default, ba.status,
      COALESCE((SELECT SUM(pp.amount) FROM payment_plans pp WHERE pp.bank_account_id = ba.id AND pp.status = 'paid'), 0) AS received,
      COALESCE((SELECT SUM(amount) FROM payable_payments WHERE bank_account_id = ba.id), 0) AS paid
    FROM bank_accounts ba
    WHERE ba.status = 'active'
    ORDER BY ba.is_default DESC, ba.created_at
  `));
  // 金额转回元
  const { toYuan } = require('../lib/helpers');
  res.json(rows.map(r => ({
    ...r,
    received: toYuan(r.received) || 0,
    paid: toYuan(r.paid) || 0,
    balance: (toYuan(r.received) || 0) - (toYuan(r.paid) || 0),
  })));
});

module.exports = router;
