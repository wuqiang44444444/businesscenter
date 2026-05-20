const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

// 取整行（用于 audit 的 before/after 快照）
function snapshot(table, id) {
  const r = getDb().exec(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!r[0] || r[0].values.length === 0) return null;
  const obj = {};
  r[0].columns.forEach((col, i) => obj[col] = r[0].values[0][i]);
  return obj;
}

// 写一条审计记录。失败时不影响主流程
function audit(req, action, table, recordId, before, after) {
  try {
    getDb().run(
      `INSERT INTO audit_log (id, user_id, username, action, table_name, record_id, before_json, after_json, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        req.user?.id || null,
        req.user?.username || null,
        action,
        table,
        recordId || null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        req.ip || null,
      ]
    );
  } catch (err) {
    console.error('[audit failed]', err.message);
  }
}

// 把一个 sql.js 风格结果集（[{columns, values}]）转成对象数组
function rowsToObjects(result) {
  if (!result[0]) return [];
  return result[0].values.map(row => {
    const obj = {};
    result[0].columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function rowToObject(result) {
  if (!result[0] || result[0].values.length === 0) return null;
  const obj = {};
  result[0].columns.forEach((col, i) => obj[col] = result[0].values[0][i]);
  return obj;
}

// 按 mode 生成付款计划（合同创建时使用）
// 入参 amount 是元（小数），返回 plan.amount 也是元，但内部以分精确分摊：
// 最后一期吃掉除不尽的余数，确保 sum(plans) === amount。
function generatePaymentPlans(contractId, mode, amount, startDate) {
  const start = new Date(startDate);
  let count = 0;
  let periodLabel = '';
  let monthStep = 1;
  let singleLabel = null;

  switch (mode) {
    case 'monthly':    count = 12; periodLabel = '月';   monthStep = 1; break;
    case 'quarterly':  count = 4;  periodLabel = '季度'; monthStep = 3; break;
    case 'semiannual': count = 2;  periodLabel = '半年'; monthStep = 6; break;
    case 'annual':     singleLabel = '年度'; break;
    case 'once':       singleLabel = '一次性'; break;
    default:           singleLabel = '自定义';
  }

  if (singleLabel) {
    return [{ period: singleLabel, amount, due_date: start.toISOString().slice(0, 10) }];
  }

  // 精确分摊：分为单位
  const totalCents = Math.round(amount * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;

  const plans = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i * monthStep);
    const cents = i === count - 1 ? baseCents + remainder : baseCents;
    plans.push({
      period: `第${i + 1}${periodLabel}`,
      amount: cents / 100,
      due_date: d.toISOString().slice(0, 10),
    });
  }
  return plans;
}

// ===== 金额单位转换：DB 存"分"（整数），API 用"元"（小数） =====
// 在写入 DB 前用 toCents()，从 DB 读出后用 toYuan()。
const MONEY_FIELDS_BY_TABLE = {
  contracts: ['amount'],
  payment_plans: ['amount'],
  accounts_payable: ['amount', 'paid_amount', 'tax_amount'],
  payable_payments: ['amount'],
  invoices: ['amount', 'tax_amount', 'total_amount'],
  projects: ['budget'],
};

function toCents(yuan) {
  if (yuan === null || yuan === undefined || yuan === '') return null;
  return Math.round(Number(yuan) * 100);
}

function toYuan(cents) {
  if (cents === null || cents === undefined) return null;
  return Number(cents) / 100;
}

// 把 DB 行（cents）转成 API 输出（yuan）
function moneyOut(table, rowOrRows) {
  const fields = MONEY_FIELDS_BY_TABLE[table];
  if (!fields) return rowOrRows;
  const apply = (r) => {
    if (!r || typeof r !== 'object') return r;
    for (const f of fields) {
      if (f in r && r[f] !== null && r[f] !== undefined) r[f] = toYuan(r[f]);
    }
    return r;
  };
  return Array.isArray(rowOrRows) ? rowOrRows.map(apply) : apply(rowOrRows);
}

module.exports = { snapshot, audit, rowsToObjects, rowToObject, generatePaymentPlans, toCents, toYuan, moneyOut };
