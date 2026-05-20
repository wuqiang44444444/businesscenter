// 报表统计接口，金额全部在 API 边界从分转回元
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { toYuan, rowsToObjects } = require('../lib/helpers');

const router = express.Router();
const yuan = (cents) => toYuan(cents) ?? 0;

// ============ 1. 应收应付总览 + 净现金流 ============
router.get('/summary', authMiddleware, (req, res) => {
  const db = getDb();
  const q = (sql, p = []) => db.exec(sql, p)[0]?.values?.[0]?.[0] || 0;

  // 应收：基于 active 合同的 payment_plans（金额单位：分）
  // 注意：pp 和 c 都有 amount 列，必须显式限定 pp.amount
  const recvTotal = q(`
    SELECT COALESCE(SUM(pp.amount), 0) FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.status = 'active'
  `);
  const recvPaid = q(`
    SELECT COALESCE(SUM(pp.amount), 0) FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.status = 'active' AND pp.status = 'paid'
  `);
  const recvOverdue = q(`
    SELECT COALESCE(SUM(pp.amount), 0) FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.status = 'active' AND pp.status = 'pending' AND pp.due_date < date('now', 'localtime')
  `);

  // 应付：accounts_payable
  const payTotal = q(`SELECT COALESCE(SUM(amount), 0) FROM accounts_payable`);
  const payPaid = q(`SELECT COALESCE(SUM(paid_amount), 0) FROM accounts_payable`);
  const payOverdue = q(`
    SELECT COALESCE(SUM(amount - paid_amount), 0) FROM accounts_payable
    WHERE status != 'paid' AND due_date IS NOT NULL AND due_date < date('now', 'localtime')
  `);

  res.json({
    receivable: {
      total: yuan(recvTotal),
      received: yuan(recvPaid),
      outstanding: yuan(recvTotal - recvPaid),
      overdue: yuan(recvOverdue),
      collection_rate: recvTotal > 0 ? Number((recvPaid / recvTotal * 100).toFixed(1)) : 0,
    },
    payable: {
      total: yuan(payTotal),
      paid: yuan(payPaid),
      outstanding: yuan(payTotal - payPaid),
      overdue: yuan(payOverdue),
      payment_rate: payTotal > 0 ? Number((payPaid / payTotal * 100).toFixed(1)) : 0,
    },
    net_cashflow: yuan(recvPaid - payPaid),       // 已实际收 - 已实际付
    net_expected: yuan((recvTotal - recvPaid) - (payTotal - payPaid)), // 待收 - 待付
  });
});

// ============ 2. 客户应收 TOP N ============
router.get('/top-customers', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const db = getDb();
  const result = db.exec(`
    SELECT c.id, c.name,
      COALESCE(SUM(ct.amount), 0) AS total_contract,
      (SELECT COALESCE(SUM(pp.amount), 0) FROM payment_plans pp
        INNER JOIN contracts ct2 ON pp.contract_id = ct2.id
        WHERE ct2.customer_id = c.id AND ct2.status = 'active' AND pp.status = 'paid') AS received,
      (SELECT COALESCE(SUM(pp.amount), 0) FROM payment_plans pp
        INNER JOIN contracts ct2 ON pp.contract_id = ct2.id
        WHERE ct2.customer_id = c.id AND ct2.status = 'active' AND pp.status = 'pending') AS outstanding
    FROM customers c
    LEFT JOIN contracts ct ON ct.customer_id = c.id AND ct.status = 'active'
    GROUP BY c.id
    HAVING total_contract > 0
    ORDER BY total_contract DESC
    LIMIT ?
  `, [limit]);

  const rows = rowsToObjects(result).map(r => ({
    id: r.id,
    name: r.name,
    total_contract: yuan(r.total_contract),
    received: yuan(r.received),
    outstanding: yuan(r.outstanding),
    collection_rate: r.received + r.outstanding > 0
      ? Number((r.received / (r.received + r.outstanding) * 100).toFixed(1))
      : 0,
  }));
  res.json(rows);
});

// ============ 3. 供应商应付 TOP N ============
router.get('/top-suppliers', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const db = getDb();
  const result = db.exec(`
    SELECT s.id, s.name,
      COALESCE(SUM(ap.amount), 0) AS total_payable,
      COALESCE(SUM(ap.paid_amount), 0) AS paid
    FROM suppliers s
    LEFT JOIN accounts_payable ap ON ap.supplier_id = s.id
    GROUP BY s.id
    HAVING total_payable > 0
    ORDER BY total_payable DESC
    LIMIT ?
  `, [limit]);

  const rows = rowsToObjects(result).map(r => ({
    id: r.id,
    name: r.name,
    total_payable: yuan(r.total_payable),
    paid: yuan(r.paid),
    outstanding: yuan(r.total_payable - r.paid),
    payment_rate: r.total_payable > 0
      ? Number((r.paid / r.total_payable * 100).toFixed(1))
      : 0,
  }));
  res.json(rows);
});

// ============ 4. 月度收支趋势（最近 N 个月） ============
router.get('/monthly-trend', authMiddleware, (req, res) => {
  const months = Math.min(parseInt(req.query.months, 10) || 12, 24);
  const db = getDb();

  // 应收按 due_date 月份聚合（要的是已 paid 的实际收款）
  const recv = db.exec(`
    SELECT strftime('%Y-%m', COALESCE(actual_date, due_date)) AS month,
      COALESCE(SUM(CASE WHEN pp.status = 'paid' THEN pp.amount ELSE 0 END), 0) AS received,
      COALESCE(SUM(CASE WHEN pp.status = 'pending' THEN pp.amount ELSE 0 END), 0) AS expected
    FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    WHERE c.status = 'active'
      AND COALESCE(actual_date, due_date) >= date('now', '-' || ? || ' months', 'localtime')
    GROUP BY month
    ORDER BY month
  `, [months]);

  // 应付：按 due_date 月份聚合（基于 payable_payments 实际付款 + accounts_payable 应付）
  const pay = db.exec(`
    SELECT strftime('%Y-%m', payment_date) AS month,
      COALESCE(SUM(amount), 0) AS paid
    FROM payable_payments
    WHERE payment_date >= date('now', '-' || ? || ' months', 'localtime')
    GROUP BY month
    ORDER BY month
  `, [months]);

  // 合并成 [{month, received, expected, paid}]
  const map = new Map();
  for (const r of rowsToObjects(recv)) {
    if (!r.month) continue;
    map.set(r.month, { month: r.month, received: yuan(r.received), expected: yuan(r.expected), paid: 0 });
  }
  for (const r of rowsToObjects(pay)) {
    if (!r.month) continue;
    if (!map.has(r.month)) map.set(r.month, { month: r.month, received: 0, expected: 0, paid: 0 });
    map.get(r.month).paid = yuan(r.paid);
  }
  // 把过去 N 个月填齐（即使没数据）
  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push(map.get(key) || { month: key, received: 0, expected: 0, paid: 0 });
  }
  res.json(result);
});

// ============ 5. 逾期账款分桶 ============
router.get('/overdue', authMiddleware, (req, res) => {
  const db = getDb();
  const dayBuckets = ['0-30', '31-60', '60+'];

  // 应收逾期：以 today - due_date 分桶
  const recvOverdueRows = db.exec(`
    SELECT pp.id, pp.amount, pp.due_date, pp.period,
      c.name AS contract_name, cust.name AS customer_name,
      CAST(julianday('now', 'localtime') - julianday(pp.due_date) AS INTEGER) AS days_overdue
    FROM payment_plans pp
    INNER JOIN contracts c ON pp.contract_id = c.id
    INNER JOIN customers cust ON c.customer_id = cust.id
    WHERE c.status = 'active' AND pp.status = 'pending'
      AND pp.due_date < date('now', 'localtime')
    ORDER BY days_overdue DESC
  `);

  const payOverdueRows = db.exec(`
    SELECT ap.id, ap.amount - ap.paid_amount AS amount, ap.due_date, ap.title,
      s.name AS supplier_name,
      CAST(julianday('now', 'localtime') - julianday(ap.due_date) AS INTEGER) AS days_overdue
    FROM accounts_payable ap
    INNER JOIN suppliers s ON ap.supplier_id = s.id
    WHERE ap.status != 'paid' AND ap.due_date IS NOT NULL
      AND ap.due_date < date('now', 'localtime')
    ORDER BY days_overdue DESC
  `);

  const bucketize = (rows) => {
    const result = { '0-30': { count: 0, amount: 0, items: [] },
                     '31-60': { count: 0, amount: 0, items: [] },
                     '60+': { count: 0, amount: 0, items: [] } };
    for (const r of rows) {
      const bucket = r.days_overdue <= 30 ? '0-30' : r.days_overdue <= 60 ? '31-60' : '60+';
      result[bucket].count += 1;
      result[bucket].amount += yuan(r.amount);
      result[bucket].items.push({ ...r, amount: yuan(r.amount) });
    }
    return result;
  };

  res.json({
    receivable: bucketize(rowsToObjects(recvOverdueRows)),
    payable: bucketize(rowsToObjects(payOverdueRows)),
  });
});

// ============ 6. 合同执行状态 + 即将到期 ============
router.get('/contract-status', authMiddleware, (req, res) => {
  const db = getDb();
  const byStatus = db.exec(`
    SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
    FROM contracts GROUP BY status
  `);
  const expiring = db.exec(`
    SELECT ct.id, ct.name, ct.amount, ct.end_date, c.name AS customer_name,
      CAST(julianday(ct.end_date) - julianday('now', 'localtime') AS INTEGER) AS days_left
    FROM contracts ct
    INNER JOIN customers c ON ct.customer_id = c.id
    WHERE ct.status = 'active'
      AND ct.end_date IS NOT NULL
      AND date(ct.end_date) BETWEEN date('now', 'localtime') AND date('now', '+30 days', 'localtime')
    ORDER BY ct.end_date
  `);

  res.json({
    by_status: rowsToObjects(byStatus).map(r => ({
      status: r.status, count: r.count, amount: yuan(r.amount),
    })),
    expiring_soon: rowsToObjects(expiring).map(r => ({
      ...r, amount: yuan(r.amount),
    })),
  });
});

// ============ 7. 增值税进项 / 销项 月报 ============
// 销项：以发票 issue_date 落在指定年份，按月聚合 invoices.tax_amount / amount / total_amount
// 进项：以应付账款 created_at 落在指定年份，按月聚合 accounts_payable.tax_amount 反算的进项税
// 应纳税额 = 销项税额 - 进项税额（仅供参考，不替代会计准则）
router.get('/tax-summary', authMiddleware, (req, res) => {
  const year = parseInt(req.query.year, 10);
  if (!year || year < 2000 || year > 2100) {
    return res.status(400).json({ error: 'year 必填，格式 YYYY' });
  }
  const db = getDb();
  const yearStr = String(year);

  // 销项：仅取已开票 / 已收款的发票（不含 cancelled）
  const salesRows = db.exec(`
    SELECT strftime('%Y-%m', issue_date) AS month,
      COALESCE(SUM(amount), 0) AS amount,
      COALESCE(SUM(tax_amount), 0) AS tax_amount,
      COALESCE(SUM(total_amount), 0) AS total_amount,
      COUNT(*) AS invoice_count,
      SUM(CASE WHEN invoice_type = 'special' THEN 1 ELSE 0 END) AS special_count
    FROM invoices
    WHERE issue_date IS NOT NULL
      AND strftime('%Y', issue_date) = ?
      AND status != 'cancelled'
    GROUP BY month
    ORDER BY month
  `, [yearStr]);

  // 进项：以 accounts_payable 落库日期（created_at）的月份归集
  // amount 是含税总额，tax_amount 是反算的进项税；不含税 = amount - tax_amount
  const purchasesRows = db.exec(`
    SELECT strftime('%Y-%m', created_at) AS month,
      COALESCE(SUM(amount - tax_amount), 0) AS amount,
      COALESCE(SUM(tax_amount), 0) AS tax_amount,
      COALESCE(SUM(amount), 0) AS total_amount,
      COUNT(*) AS bill_count
    FROM accounts_payable
    WHERE created_at IS NOT NULL
      AND strftime('%Y', created_at) = ?
    GROUP BY month
    ORDER BY month
  `, [yearStr]);

  const fillMonths = (rows, extra = {}) => {
    const map = new Map();
    for (const r of rowsToObjects(rows)) {
      if (!r.month) continue;
      map.set(r.month, r);
    }
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${yearStr}-${String(m).padStart(2, '0')}`;
      const r = map.get(key);
      out.push({
        month: key,
        amount: yuan(r?.amount || 0),
        tax_amount: yuan(r?.tax_amount || 0),
        total_amount: yuan(r?.total_amount || 0),
        ...Object.fromEntries(Object.keys(extra).map(k => [k, r?.[k] || 0])),
      });
    }
    return out;
  };

  const sales = fillMonths(salesRows, { invoice_count: 0, special_count: 0 });
  const purchases = fillMonths(purchasesRows, { bill_count: 0 });

  // 年度合计 + 应纳税估算（每月 销项税 - 进项税，负数表示留抵）
  const sum = (arr, key) => arr.reduce((s, x) => s + (x[key] || 0), 0);
  const salesTaxTotal = sum(sales, 'tax_amount');
  const purchasesTaxTotal = sum(purchases, 'tax_amount');

  const monthly_net = [];
  for (let i = 0; i < 12; i++) {
    monthly_net.push({
      month: sales[i].month,
      sales_tax: sales[i].tax_amount,
      purchases_tax: purchases[i].tax_amount,
      net_payable: Number((sales[i].tax_amount - purchases[i].tax_amount).toFixed(2)),
    });
  }

  res.json({
    year,
    sales: {
      monthly: sales,
      total_amount: Number(sum(sales, 'amount').toFixed(2)),
      total_tax: Number(salesTaxTotal.toFixed(2)),
      total_with_tax: Number(sum(sales, 'total_amount').toFixed(2)),
      invoice_count: sales.reduce((s, x) => s + (x.invoice_count || 0), 0),
    },
    purchases: {
      monthly: purchases,
      total_amount: Number(sum(purchases, 'amount').toFixed(2)),
      total_tax: Number(purchasesTaxTotal.toFixed(2)),
      total_with_tax: Number(sum(purchases, 'total_amount').toFixed(2)),
      bill_count: purchases.reduce((s, x) => s + (x.bill_count || 0), 0),
    },
    monthly_net,
    net_payable: Number((salesTaxTotal - purchasesTaxTotal).toFixed(2)),
  });
});

module.exports = router;
