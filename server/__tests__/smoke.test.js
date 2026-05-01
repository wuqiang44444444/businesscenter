const fs = require('fs');
const path = require('path');
const os = require('os');

// 在 require app 之前设置 env
const TEST_DB = path.join(os.tmpdir(), `finance-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-aaaaaa';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  // app 必须在 schemas 就绪后再 require，路由用 schemas.X 时才有值
  const { createApp } = require('../app');
  app = createApp();
});

afterAll(() => {
  // 清理测试 DB 文件
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

describe('Smoke: 全模块端到端', () => {
  let token;
  let custId, projId, contractId, supId, payId, invId;

  test('登录拿 token', async () => {
    const r = await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(r.body.user.must_change_password).toBe(true);
    token = r.body.token;
  });

  test('错误密码 400', async () => {
    const r = await request(app).post('/api/login').send({ username: 'admin', password: 'wrong' });
    expect(r.status).toBe(400);
  });

  test('未登录访问 /api/me 返回 401', async () => {
    const r = await request(app).get('/api/me');
    expect(r.status).toBe(401);
  });

  test('Dashboard 返回完整字段', async () => {
    const r = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    for (const k of ['customerCount', 'projectCount', 'contractCount', 'totalAmount', 'totalReceivable', 'supplierCount', 'totalPayable']) {
      expect(r.body).toHaveProperty(k);
    }
  });

  test('客户 CRUD', async () => {
    const c = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: '测试客户' });
    expect(c.status).toBe(200);
    custId = c.body.id;

    const list = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);

    const get = await request(app).get(`/api/customers/${custId}`).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.name).toBe('测试客户');

    const upd = await request(app).put(`/api/customers/${custId}`).set('Authorization', `Bearer ${token}`).send({ name: '测试客户改' });
    expect(upd.status).toBe(200);
  });

  test('项目 CRUD', async () => {
    const r = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ name: '测试项目', customer_id: custId });
    expect(r.status).toBe(200);
    projId = r.body.id;
  });

  test('合同 + 付款计划事务', async () => {
    const r = await request(app).post('/api/contracts').set('Authorization', `Bearer ${token}`).send({
      name: '测试合同',
      customer_id: custId,
      project_id: projId,
      amount: 100000,
      payment_plans: [
        { period: '首期', amount: 50000, due_date: '2026-06-01' },
        { period: '尾款', amount: 50000, due_date: '2026-09-01' },
      ],
    });
    expect(r.status).toBe(200);
    contractId = r.body.id;

    const detail = await request(app).get(`/api/contracts/${contractId}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.payment_plans.length).toBe(2);
  });

  test('发票 CRUD - 不含税金额入参', async () => {
    const r = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({
      contract_id: contractId,
      invoice_no: `T-EXCL-${Date.now()}`,
      amount: 50000,
      tax_rate: 0.13,
    });
    expect(r.status).toBe(200);
    invId = r.body.id;
    const detail = await request(app).get(`/api/invoices/${invId}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.amount).toBe(50000);
    expect(detail.body.tax_amount).toBe(6500);
    expect(detail.body.total_amount).toBe(56500);
  });

  test('发票 - 含税金额入参反推', async () => {
    const r = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({
      contract_id: contractId,
      invoice_no: `T-INCL-${Date.now()}`,
      total_amount: 56500,
      tax_rate: 0.13,
    });
    expect(r.status).toBe(200);
    const detail = await request(app).get(`/api/invoices/${r.body.id}`).set('Authorization', `Bearer ${token}`);
    // 含税 56500 反推：tax = round(56500*100*0.13/1.13) cents → 50000 yuan amount
    expect(detail.body.amount).toBe(50000);
    expect(detail.body.tax_amount).toBe(6500);
    expect(detail.body.total_amount).toBe(56500);
    await request(app).delete(`/api/invoices/${r.body.id}`).set('Authorization', `Bearer ${token}`);
  });

  test('发票 - amount 和 total_amount 二选一校验', async () => {
    // 都不传
    const r1 = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({
      contract_id: contractId,
      invoice_no: `T-ERR-${Date.now()}-1`,
      tax_rate: 0.13,
    });
    expect(r1.status).toBe(400);
    // 都传
    const r2 = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({
      contract_id: contractId,
      invoice_no: `T-ERR-${Date.now()}-2`,
      amount: 100,
      total_amount: 113,
      tax_rate: 0.13,
    });
    expect(r2.status).toBe(400);
  });

  test('供应商 + 应付账款 + 付款记录', async () => {
    const s = await request(app).post('/api/suppliers').set('Authorization', `Bearer ${token}`).send({ name: '测试供应商' });
    expect(s.status).toBe(200);
    supId = s.body.id;

    const ap = await request(app).post('/api/accounts-payable').set('Authorization', `Bearer ${token}`).send({
      title: '测试应付', supplier_id: supId, amount: 20000,
    });
    expect(ap.status).toBe(200);
    payId = ap.body.id;

    const pp = await request(app).post('/api/payable-payments').set('Authorization', `Bearer ${token}`).send({
      payable_id: payId, amount: 10000, payment_date: '2026-07-01',
    });
    expect(pp.status).toBe(200);

    // 付款后 paid_amount 应该等于 10000
    const apDetail = await request(app).get(`/api/accounts-payable/${payId}`).set('Authorization', `Bearer ${token}`);
    expect(apDetail.body.paid_amount).toBe(10000);
    expect(apDetail.body.status).toBe('partial');
  });

  test('删合同后发票自动级联消失', async () => {
    const c = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: '级联测试' });
    const ct = await request(app).post('/api/contracts').set('Authorization', `Bearer ${token}`).send({ name: '级联合同', customer_id: c.body.id, amount: 10000 });
    const inv = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({ contract_id: ct.body.id, invoice_no: `CASC-${Date.now()}`, amount: 10000 });

    await request(app).delete(`/api/contracts/${ct.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    const orphan = await request(app).get(`/api/invoices/${inv.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(orphan.status).toBe(404);
  });

  test('缺字段返回 400 而不是 500', async () => {
    const r1 = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ phone: '123' });
    expect(r1.status).toBe(400);

    const r2 = await request(app).post('/api/accounts-payable').set('Authorization', `Bearer ${token}`).send({ supplier_id: 'x', amount: 1 });
    expect(r2.status).toBe(400);
  });

  test('错误响应不泄露文件路径', async () => {
    const r = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: { weird: 'object' } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/[A-Z]:\\/);
    expect(JSON.stringify(r.body)).not.toMatch(/at .* \(/);
  });

  test('改密 → 默认密码被禁 + 长度校验', async () => {
    const r1 = await request(app).post('/api/change-password').set('Authorization', `Bearer ${token}`).send({ old_password: 'admin123', new_password: 'short' });
    expect(r1.status).toBe(400);

    const r2 = await request(app).post('/api/change-password').set('Authorization', `Bearer ${token}`).send({ old_password: 'admin123', new_password: 'admin123' });
    expect(r2.status).toBe(400);

    const r3 = await request(app).post('/api/change-password').set('Authorization', `Bearer ${token}`).send({ old_password: 'admin123', new_password: 'NewStrong#2026' });
    expect(r3.status).toBe(200);
  });

  test('审计日志可查（admin）', async () => {
    const r = await request(app).get('/api/audit-log?limit=50').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    const actions = new Set(r.body.map(x => x.action));
    expect(actions.size).toBeGreaterThan(1);
  });

  test('清理', async () => {
    if (payId) await request(app).delete(`/api/accounts-payable/${payId}`).set('Authorization', `Bearer ${token}`);
    if (supId) await request(app).delete(`/api/suppliers/${supId}`).set('Authorization', `Bearer ${token}`);
    if (invId) await request(app).delete(`/api/invoices/${invId}`).set('Authorization', `Bearer ${token}`);
    if (contractId) await request(app).delete(`/api/contracts/${contractId}`).set('Authorization', `Bearer ${token}`);
    if (projId) await request(app).delete(`/api/projects/${projId}`).set('Authorization', `Bearer ${token}`);
    if (custId) await request(app).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${token}`);
  });
});
