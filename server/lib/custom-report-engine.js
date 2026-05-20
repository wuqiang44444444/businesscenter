// 自定义报表引擎
// 核心安全约束：所有标识符（表/列/排序字段）必须来自下面的 SOURCES 白名单，
// 用户输入只能通过参数化（?）传入 WHERE 的 value，永远不拼到 SQL 字符串里。
//
// 不支持聚合（GROUP BY / SUM / COUNT 等）——MVP 只做行级筛选 + 排序。

const { toCents, toYuan } = require('./helpers');

// 数据源定义：base 是 FROM 之后的内容，columns 把对外暴露的字段名映射到真实 SQL 表达式
const SOURCES = {
  customers: {
    label: '客户',
    base: `FROM customers c`,
    columns: {
      name: { sql: 'c.name', label: '客户名称', type: 'string' },
      contact_person: { sql: 'c.contact_person', label: '联系人', type: 'string' },
      phone: { sql: 'c.phone', label: '电话', type: 'string' },
      email: { sql: 'c.email', label: '邮箱', type: 'string' },
      industry: { sql: 'c.industry', label: '行业', type: 'string' },
      level: { sql: 'c.level', label: '分级', type: 'enum',
        options: [
          { value: 'gold', label: '黄金客户' },
          { value: 'silver', label: '白银客户' },
          { value: 'normal', label: '普通' },
          { value: 'restricted', label: '受限' },
        ] },
      credit_limit: { sql: 'c.credit_limit', label: '信用额度', type: 'money' },
      payment_terms_days: { sql: 'c.payment_terms_days', label: '账期天数', type: 'number' },
      created_at: { sql: 'c.created_at', label: '创建时间', type: 'datetime' },
    },
  },
  contracts: {
    label: '合同',
    base: `FROM contracts ct LEFT JOIN customers c ON ct.customer_id = c.id LEFT JOIN projects p ON ct.project_id = p.id`,
    columns: {
      name: { sql: 'ct.name', label: '合同名', type: 'string' },
      contract_no: { sql: 'ct.contract_no', label: '合同号', type: 'string' },
      customer_name: { sql: 'c.name', label: '客户', type: 'string' },
      project_name: { sql: 'p.name', label: '项目', type: 'string' },
      amount: { sql: 'ct.amount', label: '合同金额', type: 'money' },
      status: { sql: 'ct.status', label: '状态', type: 'enum',
        options: [
          { value: 'active', label: '进行中' },
          { value: 'completed', label: '已完成' },
          { value: 'cancelled', label: '已取消' },
        ] },
      approval_status: { sql: 'ct.approval_status', label: '审批状态', type: 'enum',
        options: [
          { value: 'draft', label: '草稿' },
          { value: 'submitted', label: '待审批' },
          { value: 'approved', label: '已通过' },
          { value: 'rejected', label: '已驳回' },
        ] },
      payment_mode: { sql: 'ct.payment_mode', label: '付款方式', type: 'string' },
      start_date: { sql: 'ct.start_date', label: '开始日期', type: 'date' },
      end_date: { sql: 'ct.end_date', label: '结束日期', type: 'date' },
      created_at: { sql: 'ct.created_at', label: '创建时间', type: 'datetime' },
    },
  },
  invoices: {
    label: '发票',
    base: `FROM invoices inv INNER JOIN contracts c ON inv.contract_id = c.id INNER JOIN customers cust ON c.customer_id = cust.id`,
    columns: {
      invoice_no: { sql: 'inv.invoice_no', label: '发票号', type: 'string' },
      contract_name: { sql: 'c.name', label: '合同', type: 'string' },
      customer_name: { sql: 'cust.name', label: '客户', type: 'string' },
      invoice_type: { sql: 'inv.invoice_type', label: '发票类型', type: 'enum',
        options: [{ value: 'normal', label: '普票' }, { value: 'special', label: '专票' }] },
      amount: { sql: 'inv.amount', label: '不含税', type: 'money' },
      tax_amount: { sql: 'inv.tax_amount', label: '税额', type: 'money' },
      total_amount: { sql: 'inv.total_amount', label: '含税', type: 'money' },
      status: { sql: 'inv.status', label: '状态', type: 'enum',
        options: [
          { value: 'pending', label: '待开票' },
          { value: 'issued', label: '已开票' },
          { value: 'paid', label: '已付款' },
          { value: 'cancelled', label: '已作废' },
        ] },
      issue_date: { sql: 'inv.issue_date', label: '开票日', type: 'date' },
      due_date: { sql: 'inv.due_date', label: '到期日', type: 'date' },
      created_at: { sql: 'inv.created_at', label: '创建时间', type: 'datetime' },
    },
  },
  accounts_payable: {
    label: '应付账款',
    base: `FROM accounts_payable ap INNER JOIN suppliers s ON ap.supplier_id = s.id LEFT JOIN projects p ON ap.project_id = p.id`,
    columns: {
      title: { sql: 'ap.title', label: '项目', type: 'string' },
      supplier_name: { sql: 's.name', label: '供应商', type: 'string' },
      project_name: { sql: 'p.name', label: '关联项目', type: 'string' },
      amount: { sql: 'ap.amount', label: '应付（含税）', type: 'money' },
      paid_amount: { sql: 'ap.paid_amount', label: '已付', type: 'money' },
      tax_amount: { sql: 'ap.tax_amount', label: '进项税', type: 'money' },
      tax_rate: { sql: 'ap.tax_rate', label: '税率', type: 'number' },
      status: { sql: 'ap.status', label: '状态', type: 'enum',
        options: [
          { value: 'pending', label: '待付款' },
          { value: 'partial', label: '部分付款' },
          { value: 'paid', label: '已付清' },
        ] },
      invoice_no: { sql: 'ap.invoice_no', label: '发票号', type: 'string' },
      due_date: { sql: 'ap.due_date', label: '到期日', type: 'date' },
      created_at: { sql: 'ap.created_at', label: '创建时间', type: 'datetime' },
    },
  },
  payment_plans: {
    label: '收款计划',
    base: `FROM payment_plans pp INNER JOIN contracts ct ON pp.contract_id = ct.id INNER JOIN customers c ON ct.customer_id = c.id`,
    columns: {
      contract_name: { sql: 'ct.name', label: '合同', type: 'string' },
      customer_name: { sql: 'c.name', label: '客户', type: 'string' },
      period: { sql: 'pp.period', label: '期次', type: 'string' },
      amount: { sql: 'pp.amount', label: '金额', type: 'money' },
      status: { sql: 'pp.status', label: '状态', type: 'enum',
        options: [
          { value: 'pending', label: '待收' },
          { value: 'paid', label: '已收' },
          { value: 'overdue', label: '逾期' },
        ] },
      due_date: { sql: 'pp.due_date', label: '应收日', type: 'date' },
      actual_date: { sql: 'pp.actual_date', label: '实收日', type: 'date' },
    },
  },
  reimbursements: {
    label: '费用报销',
    base: `FROM reimbursements r LEFT JOIN users u ON r.applicant_id = u.id`,
    columns: {
      title: { sql: 'r.title', label: '事由', type: 'string' },
      applicant_name: { sql: `COALESCE(u.real_name, u.username)`, label: '申请人', type: 'string' },
      category: { sql: 'r.category', label: '类别', type: 'enum',
        options: [
          { value: 'travel', label: '差旅' },
          { value: 'meal', label: '餐饮' },
          { value: 'office', label: '办公' },
          { value: 'training', label: '培训' },
          { value: 'transportation', label: '交通' },
          { value: 'other', label: '其他' },
        ] },
      amount: { sql: 'r.amount', label: '金额', type: 'money' },
      status: { sql: 'r.status', label: '状态', type: 'enum',
        options: [
          { value: 'submitted', label: '已提交' },
          { value: 'approved', label: '已通过' },
          { value: 'paid', label: '已付款' },
          { value: 'rejected', label: '已驳回' },
        ] },
      occurred_date: { sql: 'r.occurred_date', label: '发生日', type: 'date' },
      created_at: { sql: 'r.created_at', label: '提交时间', type: 'datetime' },
    },
  },
};

// 支持的操作符 → 是否需要 value、value 是数组吗
const OPS = {
  '=':  { needValue: true,  isArray: false },
  '!=': { needValue: true,  isArray: false },
  '>':  { needValue: true,  isArray: false },
  '<':  { needValue: true,  isArray: false },
  '>=': { needValue: true,  isArray: false },
  '<=': { needValue: true,  isArray: false },
  'like':        { needValue: true,  isArray: false },
  'in':          { needValue: true,  isArray: true  },
  'between':     { needValue: true,  isArray: true,  arrayLen: 2 },
  'is_null':     { needValue: false, isArray: false },
  'is_not_null': { needValue: false, isArray: false },
};

// 数值规整：money 字段 value 元 → 分
function normalizeValue(col, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (col.type === 'money') return toCents(raw);
  if (col.type === 'number') return Number(raw);
  return raw;
}

// 给定定义对象，构出 { sql, params, columns }
// 不执行，调用方拿到 sql/params 自己跑 db.exec
function buildSql(definition) {
  if (!definition || typeof definition !== 'object') throw new Error('定义为空');
  const { source, columns, filters = [], sort, limit } = definition;
  const src = SOURCES[source];
  if (!src) throw new Error(`未知数据源: ${source}`);
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('至少选择一列');

  // SELECT
  const selectClauses = columns.map(c => {
    const col = src.columns[c];
    if (!col) throw new Error(`未知列: ${c}`);
    return `${col.sql} AS ${c}`;
  });

  // WHERE
  const whereParts = [];
  const params = [];
  for (const f of filters) {
    if (!f || !f.field || !f.op) throw new Error('过滤器缺少 field/op');
    const col = src.columns[f.field];
    if (!col) throw new Error(`未知过滤字段: ${f.field}`);
    const opSpec = OPS[f.op];
    if (!opSpec) throw new Error(`不支持的操作符: ${f.op}`);

    if (!opSpec.needValue) {
      whereParts.push(`${col.sql} IS ${f.op === 'is_null' ? 'NULL' : 'NOT NULL'}`);
      continue;
    }

    if (opSpec.isArray) {
      if (!Array.isArray(f.value) || f.value.length === 0) throw new Error(`${f.op} 需要非空数组`);
      if (opSpec.arrayLen && f.value.length !== opSpec.arrayLen) {
        throw new Error(`${f.op} 需要 ${opSpec.arrayLen} 个值`);
      }
      const normalized = f.value.map(v => normalizeValue(col, v));
      if (f.op === 'between') {
        whereParts.push(`${col.sql} BETWEEN ? AND ?`);
        params.push(normalized[0], normalized[1]);
      } else { // in
        whereParts.push(`${col.sql} IN (${normalized.map(() => '?').join(',')})`);
        params.push(...normalized);
      }
      continue;
    }

    // 标量操作符
    const v = normalizeValue(col, f.value);
    if (f.op === 'like') {
      whereParts.push(`${col.sql} LIKE ?`);
      params.push(`%${v}%`);
    } else {
      whereParts.push(`${col.sql} ${f.op} ?`);
      params.push(v);
    }
  }

  // ORDER BY
  let orderBy = '';
  if (sort && sort.field) {
    const col = src.columns[sort.field];
    if (!col) throw new Error(`未知排序字段: ${sort.field}`);
    const dir = (sort.direction || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    orderBy = ` ORDER BY ${col.sql} ${dir}`;
  }

  // LIMIT (硬上限 10000 防误操作扫全表)
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 10000);

  const sql = `SELECT ${selectClauses.join(', ')} ${src.base}${
    whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : ''
  }${orderBy} LIMIT ${safeLimit}`;

  return { sql, params, columnsMeta: columns.map(c => ({ key: c, ...src.columns[c] })) };
}

// 取所有数据源的元数据（前端构建编辑器用）
function getSourcesMeta() {
  return Object.entries(SOURCES).map(([key, src]) => ({
    key,
    label: src.label,
    columns: Object.entries(src.columns).map(([colKey, col]) => ({
      key: colKey,
      label: col.label,
      type: col.type,
      options: col.options,
    })),
  }));
}

// 把行里的 money 字段从分换算为元（用 columnsMeta 知道哪些是 money）
function postProcessRows(rows, columnsMeta) {
  const moneyCols = new Set(columnsMeta.filter(c => c.type === 'money').map(c => c.key));
  if (moneyCols.size === 0) return rows;
  return rows.map(r => {
    const out = { ...r };
    for (const k of moneyCols) {
      if (out[k] !== null && out[k] !== undefined) out[k] = toYuan(out[k]);
    }
    return out;
  });
}

module.exports = { buildSql, getSourcesMeta, postProcessRows, SOURCES };
