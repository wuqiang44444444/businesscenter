// 打印模板：服务端返回打印优化的 HTML，前端新标签打开 → 自动 window.print()
// 用户在打印对话框可选「保存为 PDF」。
// 零新依赖，中文字体由浏览器原生处理（PingFang/微软雅黑兜底）。

const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { toYuan, audit } = require('../lib/helpers');

const router = express.Router();

const yuan = (cents) => `¥${((toYuan(cents) ?? 0)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 通用：HTML 头 + print CSS + 自动打印脚本
function htmlShell(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif;
      color: #1d1d1f;
      background: #f5f5f7;
      margin: 0;
      padding: 24px;
      font-size: 13px;
      line-height: 1.6;
    }
    .doc {
      background: white;
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 56px;
      box-shadow: 0 2px 24px rgba(0,0,0,0.08);
      border-radius: 4px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: 1px;
      text-align: center;
    }
    .subtitle {
      text-align: center;
      color: #86868b;
      font-size: 13px;
      margin-bottom: 32px;
      letter-spacing: 2px;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px 24px;
      padding: 16px 0;
      border-top: 2px solid #1d1d1f;
      border-bottom: 1px solid #e0e0e2;
      margin-bottom: 24px;
    }
    .meta-item { font-size: 13px; }
    .meta-item .label { color: #86868b; margin-right: 8px; }
    .meta-item .value { font-weight: 500; }
    h2 { font-size: 15px; font-weight: 600; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e0e0e2; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { padding: 10px 12px; text-align: left; font-size: 12.5px; border-bottom: 1px solid #f0f0f0; }
    th { background: #fafafb; font-weight: 600; color: #424245; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.overdue td { background: #fff5f5; color: #c92a2a; }
    .summary {
      margin-top: 24px;
      padding: 16px 20px;
      background: #f5f5f7;
      border-radius: 8px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .summary-item .label { color: #86868b; font-size: 12px; }
    .summary-item .value { font-size: 20px; font-weight: 600; margin-top: 4px; }
    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px dashed #d2d2d7;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #86868b;
    }
    .signature {
      margin-top: 56px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 64px;
    }
    .signature-block {
      border-top: 1px solid #1d1d1f;
      padding-top: 8px;
      font-size: 12px;
      color: #86868b;
    }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 11px; font-weight: 500;
    }
    .badge-overdue { background: #ffe3e3; color: #c92a2a; }
    .badge-paid { background: #d3f9d8; color: #2b8a3e; }
    .badge-pending { background: #fff4e6; color: #d9480f; }
    .print-bar {
      position: fixed; top: 16px; right: 16px;
      background: #007AFF; color: white;
      padding: 8px 16px; border-radius: 8px;
      cursor: pointer; font-size: 13px; user-select: none;
      box-shadow: 0 4px 12px rgba(0,122,255,0.3);
    }
    @media print {
      body { background: white; padding: 0; }
      .doc { box-shadow: none; max-width: 100%; padding: 0; }
      .print-bar { display: none; }
      @page { size: A4; margin: 18mm 16mm; }
    }
  </style>
</head>
<body>
  <div class="print-bar" onclick="window.print()">🖨 打印 / 另存为 PDF</div>
  <div class="doc">${body}</div>
  <script>
    // 自动触发打印对话框（用户也可以手动点右上角按钮）
    window.addEventListener('load', () => setTimeout(() => window.print(), 300));
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// ============ 1. 客户对账单 ============
router.get('/statement/:customer_id', authMiddleware, (req, res) => {
  const db = getDb();
  const customerId = req.params.customer_id;

  const custRow = db.exec(`SELECT * FROM customers WHERE id = ?`, [customerId]);
  if (!custRow[0] || custRow[0].values.length === 0) return res.status(404).send('客户不存在');
  const cust = {};
  custRow[0].columns.forEach((c, i) => cust[c] = custRow[0].values[0][i]);

  // 该客户所有付款计划（应收明细）
  const plansRow = db.exec(`
    SELECT pp.id, pp.period, pp.amount, pp.due_date, pp.actual_date, pp.status, pp.remark,
      ct.name AS contract_name, ct.contract_no
    FROM payment_plans pp
    INNER JOIN contracts ct ON pp.contract_id = ct.id
    WHERE ct.customer_id = ? AND ct.status = 'active'
    ORDER BY pp.due_date
  `, [customerId]);

  const plans = plansRow[0] ? plansRow[0].values.map(row => {
    const o = {}; plansRow[0].columns.forEach((c, i) => o[c] = row[i]); return o;
  }) : [];

  const today = new Date().toISOString().slice(0, 10);
  let totalCents = 0, paidCents = 0, overdueCents = 0;
  for (const p of plans) {
    totalCents += p.amount || 0;
    if (p.status === 'paid') paidCents += p.amount || 0;
    if (p.status === 'pending' && p.due_date && p.due_date < today) overdueCents += p.amount || 0;
  }
  const outstandingCents = totalCents - paidCents;

  const statusBadge = (p) => {
    if (p.status === 'paid') return '<span class="badge badge-paid">已收</span>';
    if (p.due_date && p.due_date < today) return '<span class="badge badge-overdue">逾期</span>';
    return '<span class="badge badge-pending">待收</span>';
  };

  const body = `
    <h1>客户对账单</h1>
    <div class="subtitle">CUSTOMER STATEMENT</div>

    <div class="meta">
      <div class="meta-item"><span class="label">客户：</span><span class="value">${escapeHtml(cust.name)}</span></div>
      <div class="meta-item"><span class="label">联系人：</span><span class="value">${escapeHtml(cust.contact_person || '-')}</span></div>
      <div class="meta-item"><span class="label">电话：</span><span class="value">${escapeHtml(cust.phone || '-')}</span></div>
      <div class="meta-item"><span class="label">出账日期：</span><span class="value">${today}</span></div>
    </div>

    <h2>应收明细（按到期日排序）</h2>
    <table>
      <thead>
        <tr>
          <th style="width:42px">序号</th>
          <th>合同 / 期次</th>
          <th>到期日</th>
          <th class="num">金额</th>
          <th>状态</th>
          <th>实收日期</th>
        </tr>
      </thead>
      <tbody>
        ${plans.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#86868b;padding:24px;">该客户暂无应收账款</td></tr>' :
          plans.map((p, i) => `
            <tr class="${p.status === 'pending' && p.due_date && p.due_date < today ? 'overdue' : ''}">
              <td>${i + 1}</td>
              <td>${escapeHtml(p.contract_name)}${p.period ? ' · ' + escapeHtml(p.period) : ''}</td>
              <td>${p.due_date || '-'}</td>
              <td class="num">${yuan(p.amount)}</td>
              <td>${statusBadge(p)}</td>
              <td>${p.actual_date || '-'}</td>
            </tr>
          `).join('')}
      </tbody>
    </table>

    <div class="summary">
      <div class="summary-item"><div class="label">应收合计</div><div class="value">${yuan(totalCents)}</div></div>
      <div class="summary-item"><div class="label" style="color:#2b8a3e">已收金额</div><div class="value" style="color:#2b8a3e">${yuan(paidCents)}</div></div>
      <div class="summary-item"><div class="label" style="color:#c92a2a">未收（含逾期 ${yuan(overdueCents)}）</div><div class="value" style="color:#c92a2a">${yuan(outstandingCents)}</div></div>
    </div>

    <div class="signature">
      <div class="signature-block">客户签字 / 盖章</div>
      <div class="signature-block">我方经手人 / 盖章</div>
    </div>

    <div class="footer">
      <span>本对账单由系统自动生成</span>
      <span>${new Date().toLocaleString('zh-CN')}</span>
    </div>
  `;

  audit(req, 'print', 'customers', customerId, null, { type: 'statement' });
  res.send(htmlShell(`对账单 - ${cust.name}`, body));
});

// ============ 2. 付款通知单 ============
router.get('/payment-notice/:payable_id', authMiddleware, (req, res) => {
  const db = getDb();
  const id = req.params.payable_id;

  const apRow = db.exec(`
    SELECT ap.*, s.name AS supplier_name, s.contact_person AS supplier_contact,
      s.phone AS supplier_phone, s.bank_name, s.bank_account
    FROM accounts_payable ap
    INNER JOIN suppliers s ON ap.supplier_id = s.id
    WHERE ap.id = ?
  `, [id]);
  if (!apRow[0] || apRow[0].values.length === 0) return res.status(404).send('应付账款不存在');
  const ap = {};
  apRow[0].columns.forEach((c, i) => ap[c] = apRow[0].values[0][i]);

  const paymentsRow = db.exec(`
    SELECT amount, payment_date, payment_method, remark
    FROM payable_payments WHERE payable_id = ? ORDER BY payment_date DESC
  `, [id]);
  const payments = paymentsRow[0] ? paymentsRow[0].values.map(row => {
    const o = {}; paymentsRow[0].columns.forEach((c, i) => o[c] = row[i]); return o;
  }) : [];

  const remainCents = (ap.amount || 0) - (ap.paid_amount || 0);

  const body = `
    <h1>付款通知单</h1>
    <div class="subtitle">PAYMENT NOTICE</div>

    <div class="meta">
      <div class="meta-item"><span class="label">单据号：</span><span class="value">${id.slice(0, 8).toUpperCase()}</span></div>
      <div class="meta-item"><span class="label">日期：</span><span class="value">${new Date().toISOString().slice(0, 10)}</span></div>
    </div>

    <h2>付款方信息</h2>
    <table>
      <tr><th style="width:120px">收款方</th><td>${escapeHtml(ap.supplier_name)}</td></tr>
      <tr><th>联系人</th><td>${escapeHtml(ap.supplier_contact || '-')} ${ap.supplier_phone ? '· ' + escapeHtml(ap.supplier_phone) : ''}</td></tr>
      <tr><th>开户行</th><td>${escapeHtml(ap.bank_name || '-')}</td></tr>
      <tr><th>银行账号</th><td>${escapeHtml(ap.bank_account || '-')}</td></tr>
    </table>

    <h2>付款明细</h2>
    <table>
      <tr><th style="width:120px">摘要</th><td>${escapeHtml(ap.title)}</td></tr>
      <tr><th>关联发票号</th><td>${escapeHtml(ap.invoice_no || '-')}</td></tr>
      <tr><th>应付总额</th><td><strong>${yuan(ap.amount)}</strong></td></tr>
      <tr><th>已付金额</th><td style="color:#2b8a3e">${yuan(ap.paid_amount)}</td></tr>
      <tr><th>待付金额</th><td style="color:#c92a2a;font-weight:600;font-size:16px">${yuan(remainCents)}</td></tr>
      <tr><th>到期日</th><td>${ap.due_date || '-'}</td></tr>
      <tr><th>备注</th><td>${escapeHtml(ap.description || '-')}</td></tr>
    </table>

    ${payments.length > 0 ? `
      <h2>历史付款记录</h2>
      <table>
        <thead><tr><th>付款日期</th><th class="num">金额</th><th>付款方式</th><th>备注</th></tr></thead>
        <tbody>
          ${payments.map(p => `
            <tr><td>${p.payment_date || '-'}</td><td class="num">${yuan(p.amount)}</td><td>${escapeHtml(p.payment_method || '-')}</td><td>${escapeHtml(p.remark || '-')}</td></tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}

    <div class="signature">
      <div class="signature-block">审批 / 财务签字</div>
      <div class="signature-block">单位盖章</div>
    </div>

    <div class="footer">
      <span>本通知单由系统自动生成</span>
      <span>${new Date().toLocaleString('zh-CN')}</span>
    </div>
  `;

  audit(req, 'print', 'accounts_payable', id, null, { type: 'payment-notice' });
  res.send(htmlShell(`付款通知单 - ${ap.supplier_name}`, body));
});

// ============ 3. 发票打印 ============
router.get('/invoice/:invoice_id', authMiddleware, (req, res) => {
  const db = getDb();
  const id = req.params.invoice_id;

  const invRow = db.exec(`
    SELECT inv.*, c.name AS contract_name, c.contract_no, cust.name AS customer_name
    FROM invoices inv
    INNER JOIN contracts c ON inv.contract_id = c.id
    INNER JOIN customers cust ON c.customer_id = cust.id
    WHERE inv.id = ?
  `, [id]);
  if (!invRow[0] || invRow[0].values.length === 0) return res.status(404).send('发票不存在');
  const inv = {};
  invRow[0].columns.forEach((c, i) => inv[c] = invRow[0].values[0][i]);

  const typeText = inv.invoice_type === 'special' ? '增值税专用发票' : '增值税普通发票';

  const body = `
    <h1>${typeText}</h1>
    <div class="subtitle">VAT INVOICE</div>

    <div class="meta">
      <div class="meta-item"><span class="label">发票号：</span><span class="value" style="font-size:15px;font-weight:600">${escapeHtml(inv.invoice_no)}</span></div>
      <div class="meta-item"><span class="label">开票日期：</span><span class="value">${inv.issue_date || '-'}</span></div>
      <div class="meta-item"><span class="label">付款截止：</span><span class="value">${inv.due_date || '-'}</span></div>
    </div>

    <h2>购方信息</h2>
    <table>
      <tr><th style="width:120px">名称</th><td>${escapeHtml(inv.customer_name)}</td></tr>
      <tr><th>关联合同</th><td>${escapeHtml(inv.contract_name)}${inv.contract_no ? ' · ' + escapeHtml(inv.contract_no) : ''}</td></tr>
    </table>

    <h2>金额明细</h2>
    <table>
      <thead>
        <tr><th>项目</th><th class="num">不含税金额</th><th class="num">税率</th><th class="num">税额</th><th class="num">价税合计</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(inv.contract_name)}</td>
          <td class="num">${yuan(inv.amount)}</td>
          <td class="num">${(Number(inv.tax_rate || 0) * 100).toFixed(0)}%</td>
          <td class="num">${yuan(inv.tax_amount)}</td>
          <td class="num"><strong>${yuan(inv.total_amount)}</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="summary" style="grid-template-columns: 1fr;">
      <div class="summary-item">
        <div class="label">价税合计（大写）</div>
        <div class="value" style="font-size: 22px;">${yuan(inv.total_amount)}</div>
      </div>
    </div>

    ${inv.remark ? `<h2>备注</h2><p style="padding:12px;background:#f5f5f7;border-radius:6px;">${escapeHtml(inv.remark)}</p>` : ''}

    <div class="signature">
      <div class="signature-block">收款人</div>
      <div class="signature-block">开票人</div>
    </div>

    <div class="footer">
      <span>本发票样式由系统生成，正式发票以税局电子发票为准</span>
      <span>${new Date().toLocaleString('zh-CN')}</span>
    </div>
  `;

  audit(req, 'print', 'invoices', id, null, { type: 'invoice' });
  res.send(htmlShell(`发票 ${inv.invoice_no}`, body));
});

module.exports = router;
