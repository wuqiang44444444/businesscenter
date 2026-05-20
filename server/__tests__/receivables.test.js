const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-recv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-recv';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, userTok, otherTok;
let custId, contractId, planId, bankId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;

  await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'recv-user', password: 'pass1234', role: 'user' });
  userTok = (await request(app).post('/api/login').send({ username: 'recv-user', password: 'pass1234' })).body.token;

  await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'recv-other', password: 'pass1234', role: 'user' });
  otherTok = (await request(app).post('/api/login').send({ username: 'recv-other', password: 'pass1234' })).body.token;

  // user 自己建客户 + 合同
  const cust = await request(app).post('/api/customers').set({ Authorization: `Bearer ${userTok}` })
    .send({ name: '收款客户A' });
  custId = cust.body.id;
  const ct = await request(app).post('/api/contracts').set({ Authorization: `Bearer ${userTok}` })
    .send({ name: '收款合同A', customer_id: custId, amount: 12000, payment_mode: 'monthly', start_date: '2026-01-01' });
  contractId = ct.body.id;

  // 抓一条 payment_plan
  const detail = await request(app).get(`/api/contracts/${contractId}`).set({ Authorization: `Bearer ${userTok}` });
  planId = detail.body.payment_plans[0].id;

  // 默认银行账户
  const bk = await request(app).post('/api/bank-accounts').set({ Authorization: `Bearer ${adminTok}` })
    .send({ name: '主账户', bank_name: '招商银行', is_default: true });
  bankId = bk.body.id;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('应收账款', () => {
  test('GET /receivables：列表带客户+合同+银行账户名', async () => {
    const r = await request(app).get('/api/receivables').set(A(adminTok));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(12);
    const row = r.body[0];
    expect(row.customer_name).toBeTruthy();
    expect(row.contract_name).toBeTruthy();
    expect(typeof row.amount).toBe('number');
  });

  test('?status=pending 过滤', async () => {
    const r = await request(app).get('/api/receivables?status=pending').set(A(adminTok));
    expect(r.body.every(p => p.status === 'pending')).toBe(true);
  });

  test('?customer_id 过滤', async () => {
    const r = await request(app).get(`/api/receivables?customer_id=${custId}`).set(A(adminTok));
    expect(r.body.every(p => p.customer_id === custId)).toBe(true);
  });

  test('?keyword 模糊搜索', async () => {
    const r = await request(app).get('/api/receivables?keyword=收款合同A').set(A(adminTok));
    expect(r.body.length).toBeGreaterThan(0);
  });

  test('PUT 标记已收 + 银行账户', async () => {
    const r = await request(app).put(`/api/receivables/${planId}`).set(A(userTok))
      .send({ status: 'paid', actual_date: '2026-02-01', bank_account_id: bankId, remark: '转账' });
    expect(r.status).toBe(200);

    const list = await request(app).get('/api/receivables?status=paid').set(A(userTok));
    const found = list.body.find(p => p.id === planId);
    expect(found).toBeTruthy();
    expect(found.status).toBe('paid');
    expect(found.actual_date).toBe('2026-02-01');
    expect(found.bank_account_id).toBe(bankId);
    expect(found.bank_account_name).toBe('主账户');
    expect(found.remark).toBe('转账');
  });

  test('PUT 撤销已收（status=pending）', async () => {
    const r = await request(app).put(`/api/receivables/${planId}`).set(A(userTok))
      .send({ status: 'pending', actual_date: null });
    expect(r.status).toBe(200);
    const list = await request(app).get('/api/receivables?status=pending').set(A(userTok));
    expect(list.body.find(p => p.id === planId)).toBeTruthy();
  });

  test('PUT 只改备注，其他字段保留', async () => {
    // 先标记已收
    await request(app).put(`/api/receivables/${planId}`).set(A(userTok))
      .send({ status: 'paid', actual_date: '2026-02-01', bank_account_id: bankId });
    // 只传 remark
    await request(app).put(`/api/receivables/${planId}`).set(A(userTok))
      .send({ remark: '改了备注' });
    const list = await request(app).get('/api/receivables').set(A(userTok));
    const found = list.body.find(p => p.id === planId);
    expect(found.status).toBe('paid');
    expect(found.actual_date).toBe('2026-02-01');
    expect(found.bank_account_id).toBe(bankId);
    expect(found.remark).toBe('改了备注');
  });

  test('PUT 不存在 → 404', async () => {
    const r = await request(app).put('/api/receivables/not-exist').set(A(adminTok)).send({ status: 'paid' });
    expect(r.status).toBe(404);
  });

  test('非 owner 也非 admin/finance 不能改', async () => {
    const r = await request(app).put(`/api/receivables/${planId}`).set(A(otherTok))
      .send({ status: 'paid' });
    expect(r.status).toBe(403);
  });

  test('普通用户列表只看自己 owner 的合同的应收', async () => {
    // admin 另外建一份合同，应该不出现在 user 列表里
    const c2 = await request(app).post('/api/customers').set(A(adminTok)).send({ name: 'admin 客户' });
    await request(app).post('/api/contracts').set(A(adminTok))
      .send({ name: 'admin 合同', customer_id: c2.body.id, amount: 5000, payment_mode: 'once', start_date: '2026-01-01' });

    const userList = await request(app).get('/api/receivables').set(A(userTok));
    expect(userList.body.every(p => p.contract_name === '收款合同A')).toBe(true);

    const adminList = await request(app).get('/api/receivables').set(A(adminTok));
    expect(adminList.body.some(p => p.contract_name === 'admin 合同')).toBe(true);
  });

  test('PUT schema 校验：非法 status', async () => {
    const r = await request(app).put(`/api/receivables/${planId}`).set(A(userTok))
      .send({ status: 'unknown' });
    expect(r.status).toBe(400);
  });

  test('审计日志记录 update', async () => {
    await request(app).put(`/api/receivables/${planId}`).set(A(userTok))
      .send({ remark: '审计测试' });
    const r = await request(app).get('/api/audit-log?table_name=payment_plans&limit=20').set(A(adminTok));
    const found = r.body.find(x => x.record_id === planId && x.action === 'update');
    expect(found).toBeTruthy();
  });

  test('未登录 → 401', async () => {
    const r = await request(app).get('/api/receivables');
    expect(r.status).toBe(401);
  });
});
