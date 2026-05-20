const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-tax-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-taxx';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, custId, supId, contractId;
const YEAR = new Date().getFullYear();

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('税务汇总', () => {
  test('准备：客户/供应商/合同', async () => {
    const c = await request(app).post('/api/customers').set(A(adminTok)).send({ name: '税务客户' });
    custId = c.body.id;
    const s = await request(app).post('/api/suppliers').set(A(adminTok)).send({ name: '税务供应商' });
    supId = s.body.id;
    const ct = await request(app).post('/api/contracts').set(A(adminTok))
      .send({ name: '税务合同', customer_id: custId, amount: 100000 });
    contractId = ct.body.id;
  });

  test('销项：开发票（不含税 1000，税率 13% → 税额 130）', async () => {
    const r = await request(app).post('/api/invoices').set(A(adminTok))
      .send({
        contract_id: contractId,
        invoice_no: `TAX-${Date.now()}-1`,
        amount: 1000,
        tax_rate: 0.13,
        issue_date: `${YEAR}-05-15`,
        invoice_type: 'special',
      });
    expect(r.status).toBe(200);
  });

  test('销项：含税总额开票（total 1130, 13% → 不含税 1000, 税 130）', async () => {
    const r = await request(app).post('/api/invoices').set(A(adminTok))
      .send({
        contract_id: contractId,
        invoice_no: `TAX-${Date.now()}-2`,
        total_amount: 1130,
        tax_rate: 0.13,
        issue_date: `${YEAR}-05-20`,
      });
    expect(r.status).toBe(200);
  });

  test('进项：应付 1130 含税 13% → 反算税额 130，不含税 1000', async () => {
    const r = await request(app).post('/api/accounts-payable').set(A(adminTok))
      .send({
        supplier_id: supId,
        title: '进项-办公用品',
        amount: 1130,
        tax_rate: 0.13,
      });
    expect(r.status).toBe(200);
    const detail = await request(app).get(`/api/accounts-payable/${r.body.id}`).set(A(adminTok));
    expect(detail.body.amount).toBe(1130);
    expect(detail.body.tax_amount).toBe(130);
    expect(detail.body.tax_rate).toBe(0.13);
  });

  test('进项：tax_rate=0 → tax_amount 应为 0', async () => {
    const r = await request(app).post('/api/accounts-payable').set(A(adminTok))
      .send({
        supplier_id: supId,
        title: '进项-无票支出',
        amount: 500,
        tax_rate: 0,
      });
    expect(r.status).toBe(200);
    const detail = await request(app).get(`/api/accounts-payable/${r.body.id}`).set(A(adminTok));
    expect(detail.body.amount).toBe(500);
    expect(detail.body.tax_amount).toBe(0);
  });

  test('进项：默认 tax_rate 0.13', async () => {
    const r = await request(app).post('/api/accounts-payable').set(A(adminTok))
      .send({
        supplier_id: supId,
        title: '进项-默认税率',
        amount: 226,
      });
    expect(r.status).toBe(200);
    const detail = await request(app).get(`/api/accounts-payable/${r.body.id}`).set(A(adminTok));
    expect(detail.body.tax_rate).toBe(0.13);
    expect(detail.body.tax_amount).toBe(26); // round(226 * 0.13 / 1.13) = 26
  });

  test('GET /reports/tax-summary?year=XXXX', async () => {
    const r = await request(app).get(`/api/reports/tax-summary?year=${YEAR}`).set(A(adminTok));
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(YEAR);
    expect(r.body.sales.monthly.length).toBe(12);
    expect(r.body.purchases.monthly.length).toBe(12);
    expect(r.body.monthly_net.length).toBe(12);
    // 两张发票（5 月）销项税合计 = 130 + 130 = 260
    expect(r.body.sales.total_tax).toBe(260);
    expect(r.body.sales.invoice_count).toBe(2);
    // 三笔进项总税额 = 130 + 0 + 26 = 156
    expect(r.body.purchases.total_tax).toBe(156);
    // 应纳税 = 260 - 156 = 104
    expect(r.body.net_payable).toBe(104);
  });

  test('5 月月份单元应有销项数据', async () => {
    const r = await request(app).get(`/api/reports/tax-summary?year=${YEAR}`).set(A(adminTok));
    const may = r.body.sales.monthly.find(m => m.month === `${YEAR}-05`);
    expect(may).toBeTruthy();
    expect(may.tax_amount).toBe(260);
    expect(may.invoice_count).toBe(2);
  });

  test('year 缺失 → 400', async () => {
    const r = await request(app).get('/api/reports/tax-summary').set(A(adminTok));
    expect(r.status).toBe(400);
  });

  test('year 非法 → 400', async () => {
    const r = await request(app).get('/api/reports/tax-summary?year=abc').set(A(adminTok));
    expect(r.status).toBe(400);
  });

  test('cancelled 发票不计入销项', async () => {
    // 用一张新的合同发票，cancel 掉，确保不计税
    const inv = await request(app).post('/api/invoices').set(A(adminTok))
      .send({
        contract_id: contractId,
        invoice_no: `TAX-CANCEL-${Date.now()}`,
        amount: 5000,
        tax_rate: 0.13,
        issue_date: `${YEAR}-06-10`,
      });
    expect(inv.status).toBe(200);
    await request(app).put(`/api/invoices/${inv.body.id}`).set(A(adminTok)).send({ status: 'cancelled' });

    const r = await request(app).get(`/api/reports/tax-summary?year=${YEAR}`).set(A(adminTok));
    const june = r.body.sales.monthly.find(m => m.month === `${YEAR}-06`);
    expect(june.invoice_count).toBe(0);
    expect(june.tax_amount).toBe(0);
  });

  test('未登录访问 tax-summary → 401', async () => {
    const r = await request(app).get(`/api/reports/tax-summary?year=${YEAR}`);
    expect(r.status).toBe(401);
  });
});
