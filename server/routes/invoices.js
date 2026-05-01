const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects, rowToObject, toCents, toYuan, moneyOut } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword || '';
  const status = req.query.status || '';

  let sql = `
    SELECT inv.*, c.name as contract_name, cust.name as customer_name
    FROM invoices inv
    INNER JOIN contracts c ON inv.contract_id = c.id
    INNER JOIN customers cust ON c.customer_id = cust.id
    WHERE 1=1
  `;
  const params = [];
  if (keyword) { sql += ` AND (inv.invoice_no LIKE ? OR c.name LIKE ?)`; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (status) { sql += ` AND inv.status = ?`; params.push(status); }
  sql += ` ORDER BY inv.created_at DESC`;
  res.json(moneyOut('invoices', rowsToObjects(db.exec(sql, params))));
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const obj = rowToObject(db.exec(`
    SELECT inv.*, c.name as contract_name, c.contract_no, cust.name as customer_name
    FROM invoices inv
    INNER JOIN contracts c ON inv.contract_id = c.id
    INNER JOIN customers cust ON c.customer_id = cust.id
    WHERE inv.id = ?
  `, [req.params.id]));
  if (!obj) return res.status(404).json({ error: '发票不存在' });
  res.json(moneyOut('invoices', obj));
});

router.post('/', authMiddleware, validateBody(schemas.invoiceCreate), (req, res) => {
  const { contract_id, invoice_no, invoice_type, amount, total_amount, tax_rate, issue_date, due_date, remark } = req.body;
  const db = getDb();

  const existing = db.exec(`SELECT id FROM invoices WHERE invoice_no = ?`, [invoice_no]);
  if (existing[0] && existing[0].values.length > 0) {
    return res.status(400).json({ error: '发票号已存在' });
  }

  // 金额全程"分"计算。两种入参：
  //   不含税(amount)：amountCents → taxCents = round(amountCents * rate); totalCents = amountCents + taxCents
  //   含税(total_amount)：totalCents → taxCents = round(totalCents * rate / (1+rate)); amountCents = totalCents - taxCents
  const rate = tax_rate ?? 0.13;
  let amountCents, taxAmountCents, totalAmountCents;
  if (total_amount !== undefined && total_amount > 0) {
    totalAmountCents = toCents(total_amount);
    taxAmountCents = Math.round(totalAmountCents * rate / (1 + rate));
    amountCents = totalAmountCents - taxAmountCents;
  } else {
    amountCents = toCents(amount) ?? 0;
    taxAmountCents = Math.round(amountCents * rate);
    totalAmountCents = amountCents + taxAmountCents;
  }
  const id = uuidv4();

  const tx = db.transaction(() => {
    db.run(`
      INSERT INTO invoices (id, contract_id, invoice_no, invoice_type, amount, tax_rate, tax_amount, total_amount, issue_date, due_date, remark, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, contract_id, invoice_no, invoice_type || 'normal', amountCents, rate, taxAmountCents, totalAmountCents, issue_date || null, due_date || null, remark || '', req.user.id]);

    const financeUsers = db.exec(`SELECT id FROM users WHERE role = 'finance' OR permissions LIKE '%finance%'`);
    if (financeUsers[0]) {
      const totalYuan = toYuan(totalAmountCents);
      financeUsers[0].values.forEach((row) => {
        db.run(`
          INSERT INTO notifications (id, user_id, type, title, content, related_id, related_type)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [uuidv4(), row[0], 'invoice', '新开票申请', `发票号: ${invoice_no}，金额: ¥${totalYuan.toLocaleString()}`, id, 'invoice']);
      });
    }
  });
  tx();

  audit(req, 'create', 'invoices', id, null, snapshot('invoices', id));
  res.json({ id });
});

router.put('/:id', authMiddleware, validateBody(schemas.invoiceUpdate), (req, res) => {
  const { status, remark, invoice_no } = req.body;
  const db = getDb();

  if (invoice_no) {
    const existing = db.exec(`SELECT id FROM invoices WHERE invoice_no = ? AND id != ?`, [invoice_no, req.params.id]);
    if (existing[0] && existing[0].values.length > 0) {
      return res.status(400).json({ error: '发票号已存在' });
    }
  }

  const updates = [];
  const values = [];
  if (status !== undefined) { updates.push('status=?'); values.push(status); }
  if (remark !== undefined) { updates.push('remark=?'); values.push(remark); }
  if (invoice_no !== undefined) { updates.push('invoice_no=?'); values.push(invoice_no); }
  updates.push(`updated_at=datetime('now','localtime')`);
  values.push(req.params.id);

  const before = snapshot('invoices', req.params.id);
  db.run(`UPDATE invoices SET ${updates.join(', ')} WHERE id=?`, values);
  audit(req, 'update', 'invoices', req.params.id, before, snapshot('invoices', req.params.id));
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const before = snapshot('invoices', req.params.id);
  db.run(`DELETE FROM invoices WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'invoices', req.params.id, before, null);
  res.json({ success: true });
});

module.exports = router;
