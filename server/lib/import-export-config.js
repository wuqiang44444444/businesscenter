// 每个模块定义可导入/导出的字段、表头中文、必填、类型，以及 FK 通过名称解析的逻辑。
// resolver 接收 (db, value) 返回真实 ID 或 null（解析失败）。
// transformer 接收 (value) 把 Excel 值规整成 DB 期望的类型（如日期转字符串）。

const dayjs = require('dayjs');

function dateStr(v) {
  if (v == null || v === '') return null;
  // xlsx 解析后日期是 JS Date 对象；也可能是字符串
  if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD');
  const d = dayjs(String(v));
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v);
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_MAP_PROJECTS = { '进行中': 'active', '暂停': 'paused', '已完成': 'completed', '已取消': 'cancelled' };
const STATUS_MAP_CONTRACTS = { '进行中': 'active', '已完成': 'completed', '已取消': 'cancelled' };
const STATUS_MAP_INVOICES = { '待审核': 'pending', '已审核': 'approved', '已开具': 'issued', '已驳回': 'rejected' };
const STATUS_MAP_PAYABLE = { '待付款': 'pending', '部分付款': 'partial', '已付款': 'paid' };
const PAYMENT_MODE_MAP = { '按月': 'monthly', '按季': 'quarterly', '半年': 'semiannual', '按年': 'annual', '一次性': 'once', '自定义': 'custom' };
function rev(m) { return Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])); }

// 配置：每个模块定义字段顺序
const modules = {
  customers: {
    table: 'customers',
    label: '客户',
    fields: [
      { header: '客户名称', field: 'name', required: true },
      { header: '联系人', field: 'contact_person' },
      { header: '电话', field: 'phone' },
      { header: '邮箱', field: 'email' },
      { header: '地址', field: 'address' },
      { header: '行业', field: 'industry' },
      { header: '备注', field: 'remark' },
    ],
  },
  suppliers: {
    table: 'suppliers',
    label: '供应商',
    fields: [
      { header: '供应商名称', field: 'name', required: true },
      { header: '联系人', field: 'contact_person' },
      { header: '电话', field: 'phone' },
      { header: '邮箱', field: 'email' },
      { header: '地址', field: 'address' },
      { header: '类别', field: 'category' },
      { header: '开户行', field: 'bank_name' },
      { header: '银行账号', field: 'bank_account' },
      { header: '备注', field: 'remark' },
    ],
  },
  projects: {
    table: 'projects',
    label: '项目',
    fields: [
      { header: '项目名称', field: 'name', required: true },
      { header: '客户名称', field: 'customer_name', export: true,
        // 导出时连表查 customer.name；导入时按名字解析 customer_id
        resolveOnImport: { toField: 'customer_id', lookup: (db, name) => {
          if (!name) return null;
          const r = db.exec(`SELECT id FROM customers WHERE name = ?`, [name]);
          return r[0]?.values[0]?.[0] ?? null;
        }},
      },
      { header: '状态', field: 'status', enum: STATUS_MAP_PROJECTS, reverseEnum: rev(STATUS_MAP_PROJECTS) },
      { header: '开始日期', field: 'start_date', transform: dateStr },
      { header: '结束日期', field: 'end_date', transform: dateStr },
      { header: '负责人', field: 'manager' },
      { header: '预算（元）', field: 'budget', transform: num, isMoney: true },
      { header: '描述', field: 'description' },
    ],
  },
  contracts: {
    table: 'contracts',
    label: '合同',
    fields: [
      { header: '合同名称', field: 'name', required: true },
      { header: '客户名称', field: 'customer_name', requiredOnImport: true, export: true,
        resolveOnImport: { toField: 'customer_id', lookup: (db, name) => {
          if (!name) return null;
          const r = db.exec(`SELECT id FROM customers WHERE name = ?`, [name]);
          return r[0]?.values[0]?.[0] ?? null;
        }},
      },
      { header: '项目名称', field: 'project_name', export: true,
        resolveOnImport: { toField: 'project_id', lookup: (db, name) => {
          if (!name) return null;
          const r = db.exec(`SELECT id FROM projects WHERE name = ?`, [name]);
          return r[0]?.values[0]?.[0] ?? null;
        }},
      },
      { header: '合同编号', field: 'contract_no' },
      { header: '金额（元）', field: 'amount', transform: num, isMoney: true },
      { header: '付款方式', field: 'payment_mode', enum: PAYMENT_MODE_MAP, reverseEnum: rev(PAYMENT_MODE_MAP) },
      { header: '开始日期', field: 'start_date', transform: dateStr },
      { header: '结束日期', field: 'end_date', transform: dateStr },
      { header: '状态', field: 'status', enum: STATUS_MAP_CONTRACTS, reverseEnum: rev(STATUS_MAP_CONTRACTS) },
      { header: '描述', field: 'description' },
    ],
  },
  invoices: {
    table: 'invoices',
    label: '发票',
    fields: [
      { header: '合同名称', field: 'contract_name', requiredOnImport: true, export: true,
        resolveOnImport: { toField: 'contract_id', lookup: (db, name) => {
          if (!name) return null;
          const r = db.exec(`SELECT id FROM contracts WHERE name = ?`, [name]);
          return r[0]?.values[0]?.[0] ?? null;
        }},
      },
      { header: '发票号', field: 'invoice_no', required: true, unique: true },
      { header: '发票类型', field: 'invoice_type', enum: { '普票': 'normal', '专票': 'special' }, reverseEnum: rev({ '普票': 'normal', '专票': 'special' }) },
      { header: '不含税金额（元）', field: 'amount', transform: num, isMoney: true },
      { header: '税率', field: 'tax_rate', transform: num },
      { header: '税额（元）', field: 'tax_amount', transform: num, isMoney: true, exportOnly: true },
      { header: '价税合计（元）', field: 'total_amount', transform: num, isMoney: true, exportOnly: true },
      { header: '开票日期', field: 'issue_date', transform: dateStr },
      { header: '付款截止日期', field: 'due_date', transform: dateStr },
      { header: '状态', field: 'status', enum: STATUS_MAP_INVOICES, reverseEnum: rev(STATUS_MAP_INVOICES) },
      { header: '备注', field: 'remark' },
    ],
  },
  'accounts-payable': {
    table: 'accounts_payable',
    label: '应付账款',
    fields: [
      { header: '摘要', field: 'title', required: true },
      { header: '供应商名称', field: 'supplier_name', requiredOnImport: true, export: true,
        resolveOnImport: { toField: 'supplier_id', lookup: (db, name) => {
          if (!name) return null;
          const r = db.exec(`SELECT id FROM suppliers WHERE name = ?`, [name]);
          return r[0]?.values[0]?.[0] ?? null;
        }},
      },
      { header: '项目名称', field: 'project_name', export: true,
        resolveOnImport: { toField: 'project_id', lookup: (db, name) => {
          if (!name) return null;
          const r = db.exec(`SELECT id FROM projects WHERE name = ?`, [name]);
          return r[0]?.values[0]?.[0] ?? null;
        }},
      },
      { header: '金额（元）', field: 'amount', transform: num, isMoney: true },
      { header: '已付金额（元）', field: 'paid_amount', transform: num, isMoney: true, exportOnly: true },
      { header: '到期日', field: 'due_date', transform: dateStr },
      { header: '发票号', field: 'invoice_no' },
      { header: '状态', field: 'status', enum: STATUS_MAP_PAYABLE, reverseEnum: rev(STATUS_MAP_PAYABLE), exportOnly: true },
      { header: '描述', field: 'description' },
    ],
  },
};

function get(moduleName) {
  return modules[moduleName] || null;
}

function listExportFields(moduleName) {
  const m = get(moduleName);
  if (!m) return [];
  return m.fields;
}

function listImportFields(moduleName) {
  const m = get(moduleName);
  if (!m) return [];
  return m.fields.filter(f => !f.exportOnly);
}

module.exports = { get, listExportFields, listImportFields };
