// 前后端共用的 zod schema 定义。
// 这个文件不直接 import zod —— 由两端各自传入 z 实例，
// 避免 CJS（server require）和 ESM（client Vite import）的兼容麻烦。
//
// 用法：
//   // server (CJS):
//   const { z } = require('zod');
//   const buildSchemas = require('../../shared/schemas');
//   const schemas = buildSchemas(z);
//
//   // client (ESM/TS):
//   import { z } from 'zod';
//   import buildSchemas from '../../../shared/schemas/index.js';
//   const schemas = buildSchemas(z);

function buildSchemas(z) {
  const id = z.string().min(1);
  const optionalText = z.string().optional().default('');
  const optionalDate = z.string().optional().nullable();
  const optionalAmount = z.number().nonnegative().optional().default(0);

  const customer = z.object({
    name: z.string().min(1).max(200),
    contact_person: optionalText,
    phone: optionalText,
    email: optionalText,
    address: optionalText,
    industry: optionalText,
    remark: optionalText,
  });

  const project = z.object({
    name: z.string().min(1).max(200),
    customer_id: id.optional().nullable(),
    status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional().default('active'),
    start_date: optionalDate,
    end_date: optionalDate,
    description: optionalText,
    manager: optionalText,
    budget: optionalAmount,
  });

  const paymentPlanItem = z.object({
    period: z.string().optional().default(''),
    amount: optionalAmount,
    due_date: optionalDate,
    remark: optionalText,
  });

  const contract = z.object({
    name: z.string().min(1).max(200),
    customer_id: id,
    project_id: id.optional().nullable(),
    contract_no: optionalText,
    amount: optionalAmount,
    payment_mode: z.enum(['monthly', 'quarterly', 'semiannual', 'annual', 'once', 'custom']).optional().default('monthly'),
    start_date: optionalDate,
    end_date: optionalDate,
    status: z.enum(['active', 'completed', 'cancelled']).optional().default('active'),
    description: optionalText,
    payment_plans: z.array(paymentPlanItem).optional(),
  });

  const supplier = z.object({
    name: z.string().min(1).max(200),
    contact_person: optionalText,
    phone: optionalText,
    email: optionalText,
    address: optionalText,
    category: optionalText,
    bank_name: optionalText,
    bank_account: optionalText,
    remark: optionalText,
    status: z.enum(['active', 'inactive']).optional().default('active'),
  });

  const accountsPayable = z.object({
    title: z.string().min(1).max(200),
    supplier_id: id,
    project_id: id.optional().nullable(),
    amount: optionalAmount,
    due_date: optionalDate,
    invoice_no: optionalText,
    description: optionalText,
    status: z.enum(['pending', 'partial', 'paid']).optional().default('pending'),
  });

  const payablePayment = z.object({
    payable_id: id,
    amount: optionalAmount,
    payment_date: optionalDate,
    payment_method: optionalText,
    remark: optionalText,
    bank_account_id: id.optional().nullable(),
  });

  // 创建发票：amount(不含税) 和 total_amount(含税) 二选一
  const invoiceCreate = z.object({
    contract_id: id,
    invoice_no: z.string().min(1).max(100),
    invoice_type: z.enum(['normal', 'special']).optional().default('normal'),
    amount: z.number().nonnegative().optional(),
    total_amount: z.number().nonnegative().optional(),
    tax_rate: z.number().min(0).max(1).optional().default(0.13),
    issue_date: optionalDate,
    due_date: optionalDate,
    remark: optionalText,
  }).refine((d) => {
    const hasA = d.amount !== undefined && d.amount > 0;
    const hasT = d.total_amount !== undefined && d.total_amount > 0;
    return hasA !== hasT; // 必须严格二选一（异或）
  }, { message: '请填写不含税金额(amount) 或 含税金额(total_amount) 其中之一' });

  const invoiceUpdate = z.object({
    status: z.enum(['pending', 'issued', 'paid', 'cancelled']).optional(),
    remark: optionalText.optional(),
    invoice_no: z.string().min(1).max(100).optional(),
  });

  const userCreate = z.object({
    username: z.string().min(2).max(50),
    password: z.string().min(6),
    real_name: optionalText,
    role: z.enum(['admin', 'user', 'finance']).optional().default('user'),
    permissions: z.array(z.string()).optional().default([]),
  });

  const userUpdate = z.object({
    real_name: optionalText.optional(),
    role: z.enum(['admin', 'user', 'finance']).optional(),
    permissions: z.array(z.string()).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    password: z.string().min(6).optional(),
    email: z.string().email().optional().or(z.literal('')),
  });

  const userCreateExt = z.object({
    username: z.string().min(2).max(50),
    password: z.string().min(6),
    real_name: optionalText,
    role: z.enum(['admin', 'user', 'finance']).optional().default('user'),
    permissions: z.array(z.string()).optional().default([]),
    email: z.string().email().optional().or(z.literal('')),
  });

  const login = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  const changePassword = z.object({
    old_password: z.string().min(1),
    new_password: z.string().min(8),
  });

  const paymentPlan = z.object({
    contract_id: id,
    period: optionalText,
    amount: optionalAmount,
    due_date: optionalDate,
    remark: optionalText,
  });

  const paymentPlanUpdate = z.object({
    amount: optionalAmount.optional(),
    due_date: optionalDate,
    actual_date: optionalDate,
    status: z.enum(['pending', 'paid', 'overdue']).optional(),
    remark: optionalText.optional(),
  });

  const receivableUpdate = z.object({
    status: z.enum(['pending', 'paid', 'overdue']).optional(),
    actual_date: optionalDate,
    remark: optionalText.optional(),
    bank_account_id: id.optional().nullable(),
  });

  const bankAccount = z.object({
    name: z.string().min(1).max(100),
    bank_name: optionalText,
    account_number: optionalText,
    currency: z.string().length(3).optional().default('CNY'),
    is_default: z.boolean().optional().default(false),
    status: z.enum(['active', 'inactive']).optional().default('active'),
    remark: optionalText,
  });

  return {
    customer, project, contract, supplier,
    accountsPayable, payablePayment,
    invoiceCreate, invoiceUpdate,
    userCreate: userCreateExt, userUpdate,
    login, changePassword,
    paymentPlan, paymentPlanUpdate,
    receivableUpdate,
    bankAccount,
  };
}

// ESM 导出。Vite 直接吃；Node CJS 用 dynamic import() 加载。
export default buildSchemas;
