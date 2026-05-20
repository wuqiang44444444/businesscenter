const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-print-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-pppp';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, token;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  token = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('打印模板', () => {
  let custId, contractId, planId, invId, supId, payId;

  beforeAll(async () => {
    const c = await request(app).post('/api/customers').set(auth()).send({ name: '打印测试客户', contact_person: '张三', phone: '13800000099' });
    custId = c.body.id;
    const ct = await request(app).post('/api/contracts').set(auth()).send({
      name: '打印测试合同', customer_id: custId, amount: 12000,
      payment_mode: 'monthly', start_date: '2026-01-01',
    });
    contractId = ct.body.id;
    const plans = await request(app).get(`/api/contracts/${contractId}/payment-plans`).set(auth());
    planId = plans.body[0]?.id;
    // 把第一期标为已收
    if (planId) {
      await request(app).put(`/api/receivables/${planId}`).set(auth()).send({ status: 'paid', actual_date: '2026-02-01' });
    }
    const inv = await request(app).post('/api/invoices').set(auth()).send({
      contract_id: contractId, invoice_no: `PRINT-${Date.now()}`, amount: 1000, tax_rate: 0.13,
    });
    invId = inv.body.id;
    const s = await request(app).post('/api/suppliers').set(auth()).send({
      name: '打印测试供应商', bank_name: '工商银行', bank_account: '6222000000000000',
    });
    supId = s.body.id;
    const ap = await request(app).post('/api/accounts-payable').set(auth()).send({
      title: '打印应付', supplier_id: supId, amount: 5000, due_date: '2026-06-01',
    });
    payId = ap.body.id;
  });

  test('客户对账单：返回 HTML 含核心字段', async () => {
    const r = await request(app).get(`/api/print/statement/${custId}`).set(auth());
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
    expect(r.text).toContain('客户对账单');
    expect(r.text).toContain('打印测试客户');
    expect(r.text).toContain('张三');
    expect(r.text).toContain('window.print()');
    // 应该包含合同名（来自 payment_plans JOIN）
    expect(r.text).toContain('打印测试合同');
  });

  test('客户对账单：合计正确', async () => {
    const r = await request(app).get(`/api/print/statement/${custId}`).set(auth());
    // 12000 元合同 12 期，每期 1000 元；第 1 期已收 → 已收 1000，未收 11000
    expect(r.text).toMatch(/应收合计.*¥12,000\.00/s);
    expect(r.text).toMatch(/已收金额.*¥1,000\.00/s);
  });

  test('客户对账单：客户不存在 → 404', async () => {
    const r = await request(app).get('/api/print/statement/not-exist').set(auth());
    expect(r.status).toBe(404);
  });

  test('付款通知单：返回 HTML 含银行账号', async () => {
    const r = await request(app).get(`/api/print/payment-notice/${payId}`).set(auth());
    expect(r.status).toBe(200);
    expect(r.text).toContain('付款通知单');
    expect(r.text).toContain('打印测试供应商');
    expect(r.text).toContain('工商银行');
    expect(r.text).toContain('6222000000000000');
    expect(r.text).toMatch(/应付总额.*¥5,000\.00/s);
  });

  test('发票打印：返回 HTML 含税额', async () => {
    const r = await request(app).get(`/api/print/invoice/${invId}`).set(auth());
    expect(r.status).toBe(200);
    expect(r.text).toContain('增值税');
    expect(r.text).toMatch(/¥1,000\.00/);  // 不含税
    expect(r.text).toMatch(/¥130\.00/);    // 税额
    expect(r.text).toMatch(/¥1,130\.00/);  // 价税合计
  });

  test('未授权访问 → 401', async () => {
    const r = await request(app).get(`/api/print/statement/${custId}`);
    expect(r.status).toBe(401);
  });

  test('打印行为写入 audit_log', async () => {
    await request(app).get(`/api/print/statement/${custId}`).set(auth());
    const r = await request(app).get('/api/audit-log?table_name=customers&limit=10').set(auth());
    const printRow = r.body.find(x => x.action === 'print' && x.record_id === custId);
    expect(printRow).toBeTruthy();
  });
});
