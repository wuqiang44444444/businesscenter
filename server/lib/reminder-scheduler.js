// 提醒调度器：定时扫描应收逾期 + 合同到期 + 应付即将到期，发邮件。
// 用最朴素的 setInterval，避免引入 cron 依赖。
// 防重发：在 audit_log 用 action='remind_sent' 记录，next run 跳过已发的。

const { getDb } = require('../database');
const { toYuan } = require('./helpers');
const mailer = require('./mailer');

const ONE_HOUR = 60 * 60 * 1000;
const REMINDER_KEY_DUE_SOON = (entity, id) => `${entity}:${id}:due_soon`;
const REMINDER_KEY_OVERDUE = (entity, id) => `${entity}:${id}:overdue`;
const REMINDER_KEY_CONTRACT_EXPIRING = (id) => `contract:${id}:expiring`;

const yuan = (cents) => `¥${((toYuan(cents) ?? 0)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function rowsToObjects(result) {
  if (!result[0]) return [];
  return result[0].values.map(row => {
    const obj = {};
    result[0].columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

// 检查这条提醒今天是否已发过
function alreadySent(reminderKey) {
  const today = new Date().toISOString().slice(0, 10);
  const r = getDb().exec(
    `SELECT 1 FROM audit_log WHERE action='remind_sent' AND record_id=? AND created_at >= ? LIMIT 1`,
    [reminderKey, today]
  );
  return r[0] && r[0].values.length > 0;
}

function markSent(reminderKey, payload) {
  const { v4: uuidv4 } = require('uuid');
  getDb().run(
    `INSERT INTO audit_log (id, user_id, username, action, table_name, record_id, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), 'system', 'system', 'remind_sent', 'reminders', reminderKey, JSON.stringify(payload)]
  );
}

// 应收逾期：所有 pending 且过期的 payment_plan
async function checkReceivableOverdue() {
  const db = getDb();
  const rows = rowsToObjects(db.exec(`
    SELECT pp.id, pp.amount, pp.due_date, pp.period,
      ct.name AS contract_name, ct.created_by,
      cust.name AS customer_name, cust.contact_person, cust.phone,
      u.email AS owner_email, u.real_name AS owner_name
    FROM payment_plans pp
    INNER JOIN contracts ct ON pp.contract_id = ct.id
    INNER JOIN customers cust ON ct.customer_id = cust.id
    LEFT JOIN users u ON ct.created_by = u.id
    WHERE ct.status = 'active' AND pp.status = 'pending'
      AND pp.due_date < date('now', 'localtime')
  `));

  for (const r of rows) {
    const key = REMINDER_KEY_OVERDUE('payment_plan', r.id);
    if (alreadySent(key)) continue;

    const to = r.owner_email || process.env.ADMIN_EMAIL;
    if (!to) continue;

    const subject = `[逾期提醒] ${r.customer_name} - ${yuan(r.amount)} 已逾期`;
    const html = `
      <p>${r.owner_name || ''} 您好：</p>
      <p>客户 <strong>${r.customer_name}</strong> 的应收账款已 <strong style="color:#c92a2a">逾期</strong>：</p>
      <ul>
        <li>合同：${r.contract_name}</li>
        <li>期次：${r.period || '-'}</li>
        <li>金额：<strong>${yuan(r.amount)}</strong></li>
        <li>原到期日：${r.due_date}</li>
        <li>客户联系人：${r.contact_person || '-'}（${r.phone || '-'}）</li>
      </ul>
      <p>请及时跟进催收。</p>
      <hr><p style="color:#86868b;font-size:12px">Business · 应收提醒（每日扫描）</p>
    `;
    try {
      await mailer.send({ to, subject, html });
      markSent(key, { to, type: 'receivable_overdue', payment_plan_id: r.id });
    } catch (e) {
      console.error('[reminder] 应收逾期邮件失败:', e.message);
    }
  }
  return rows.length;
}

// 应收即将到期：7 天内
async function checkReceivableDueSoon() {
  const db = getDb();
  const rows = rowsToObjects(db.exec(`
    SELECT pp.id, pp.amount, pp.due_date, pp.period,
      ct.name AS contract_name,
      cust.name AS customer_name,
      u.email AS owner_email, u.real_name AS owner_name
    FROM payment_plans pp
    INNER JOIN contracts ct ON pp.contract_id = ct.id
    INNER JOIN customers cust ON ct.customer_id = cust.id
    LEFT JOIN users u ON ct.created_by = u.id
    WHERE ct.status = 'active' AND pp.status = 'pending'
      AND pp.due_date >= date('now', 'localtime')
      AND pp.due_date <= date('now', '+7 days', 'localtime')
  `));

  for (const r of rows) {
    const key = REMINDER_KEY_DUE_SOON('payment_plan', r.id);
    if (alreadySent(key)) continue;
    const to = r.owner_email || process.env.ADMIN_EMAIL;
    if (!to) continue;

    const subject = `[到期提醒] ${r.customer_name} - ${yuan(r.amount)} 即将到期`;
    const html = `
      <p>${r.owner_name || ''} 您好：</p>
      <p>客户 <strong>${r.customer_name}</strong> 的应收账款将在 <strong>${r.due_date}</strong> 到期：</p>
      <ul>
        <li>合同：${r.contract_name}</li>
        <li>金额：<strong>${yuan(r.amount)}</strong></li>
      </ul>
      <p>建议提前联系客户安排回款。</p>
      <hr><p style="color:#86868b;font-size:12px">Business · 应收提醒</p>
    `;
    try {
      await mailer.send({ to, subject, html });
      markSent(key, { to, type: 'receivable_due_soon', payment_plan_id: r.id });
    } catch (e) {
      console.error('[reminder] 应收到期邮件失败:', e.message);
    }
  }
  return rows.length;
}

// 合同 30 天内到期
async function checkContractExpiring() {
  const db = getDb();
  const rows = rowsToObjects(db.exec(`
    SELECT ct.id, ct.name, ct.amount, ct.end_date,
      cust.name AS customer_name,
      u.email AS owner_email, u.real_name AS owner_name
    FROM contracts ct
    INNER JOIN customers cust ON ct.customer_id = cust.id
    LEFT JOIN users u ON ct.created_by = u.id
    WHERE ct.status = 'active'
      AND ct.end_date IS NOT NULL
      AND date(ct.end_date) BETWEEN date('now', 'localtime') AND date('now', '+30 days', 'localtime')
  `));

  for (const r of rows) {
    const key = REMINDER_KEY_CONTRACT_EXPIRING(r.id);
    if (alreadySent(key)) continue;
    const to = r.owner_email || process.env.ADMIN_EMAIL;
    if (!to) continue;

    const subject = `[续签提醒] 合同《${r.name}》将于 ${r.end_date} 到期`;
    const html = `
      <p>${r.owner_name || ''} 您好：</p>
      <p>合同 <strong>${r.name}</strong>（客户 ${r.customer_name}）将于 <strong>${r.end_date}</strong> 到期。</p>
      <p>金额：${yuan(r.amount)}</p>
      <p>请评估是否需要续签。</p>
      <hr><p style="color:#86868b;font-size:12px">Business · 合同到期提醒</p>
    `;
    try {
      await mailer.send({ to, subject, html });
      markSent(key, { to, type: 'contract_expiring', contract_id: r.id });
    } catch (e) {
      console.error('[reminder] 合同到期邮件失败:', e.message);
    }
  }
  return rows.length;
}

async function runAll() {
  if (!mailer.isReady()) return { skipped: true };
  const ovd = await checkReceivableOverdue();
  const due = await checkReceivableDueSoon();
  const exp = await checkContractExpiring();
  return { scanned: { receivable_overdue: ovd, receivable_due_soon: due, contract_expiring: exp } };
}

function start() {
  if (!mailer.isReady()) {
    console.log('[reminder] SMTP 未配置，定时提醒不启动');
    return;
  }
  // 启动 10s 后跑一次 + 之后每小时
  setTimeout(() => runAll().catch(e => console.error('[reminder] 失败:', e)), 10 * 1000);
  setInterval(() => runAll().catch(e => console.error('[reminder] 失败:', e)), ONE_HOUR);
  console.log('[reminder] 调度器已启动（每小时扫描一次）');
}

module.exports = { start, runAll };
