const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-bank-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-bnknk';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, userTok, userId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
  const u = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'bnk-user', password: 'pass1234', role: 'user' });
  userId = u.body.id;
  userTok = (await request(app).post('/api/login').send({ username: 'bnk-user', password: 'pass1234' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('银行账户', () => {
  let acc1, acc2;

  test('admin 创建账户', async () => {
    const r = await request(app).post('/api/bank-accounts').set(A(adminTok))
      .send({ name: '主账户', bank_name: '工商银行', account_number: '6222 0000 0000 0001', is_default: true });
    expect(r.status).toBe(200);
    acc1 = r.body.id;
  });

  test('普通用户不能创建账户', async () => {
    const r = await request(app).post('/api/bank-accounts').set(A(userTok))
      .send({ name: 'evil' });
    expect(r.status).toBe(403);
  });

  test('普通用户可以读账户列表', async () => {
    const r = await request(app).get('/api/bank-accounts').set(A(userTok));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
  });

  test('设第二个 default → 第一个被自动取消', async () => {
    const r = await request(app).post('/api/bank-accounts').set(A(adminTok))
      .send({ name: '备用金', is_default: true });
    expect(r.status).toBe(200);
    acc2 = r.body.id;
    const list = await request(app).get('/api/bank-accounts').set(A(adminTok));
    const defaults = list.body.filter(x => x.is_default);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(acc2);
  });

  // 测试间共享的应付账款 id（不在中间被删，方便下面"已有付款的账户不能删"那条用）
  let sharedApId, sharedCustId, sharedSupId;

  test('付款指定 bank_account_id → 账户余额体现', async () => {
    const c = await request(app).post('/api/customers').set(A(adminTok)).send({ name: 'bnk-cust' });
    sharedCustId = c.body.id;
    const s = await request(app).post('/api/suppliers').set(A(adminTok)).send({ name: 'bnk-supp' });
    sharedSupId = s.body.id;
    const ap = await request(app).post('/api/accounts-payable').set(A(adminTok))
      .send({ title: '付款给 X', supplier_id: s.body.id, amount: 5000 });
    sharedApId = ap.body.id;
    await request(app).post('/api/payable-payments').set(A(adminTok))
      .send({ payable_id: ap.body.id, amount: 1000, bank_account_id: acc1 });
    await request(app).post('/api/payable-payments').set(A(adminTok))
      .send({ payable_id: ap.body.id, amount: 500, bank_account_id: acc2 });
    await request(app).post('/api/payable-payments').set(A(adminTok))
      .send({ payable_id: ap.body.id, amount: 200 });

    const bal = await request(app).get('/api/bank-accounts/_/balance').set(A(adminTok));
    expect(bal.status).toBe(200);
    const a1 = bal.body.find(x => x.id === acc1);
    const a2 = bal.body.find(x => x.id === acc2);
    expect(a1.paid).toBe(1000);
    expect(a1.balance).toBe(-1000);
    expect(a2.paid).toBe(500);
    expect(a2.balance).toBe(-500);
  });

  test('已有付款关联的账户不能删', async () => {
    const r = await request(app).delete(`/api/bank-accounts/${acc1}`).set(A(adminTok));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/无法删除/);
  });

  test('改 status=inactive 可以代替删除', async () => {
    const r = await request(app).put(`/api/bank-accounts/${acc1}`).set(A(adminTok))
      .send({ name: '主账户', currency: 'CNY', status: 'inactive' });
    expect(r.status).toBe(200);
  });

  test('清理 + 验证：删完应付后，acc1 可以删了', async () => {
    if (sharedApId) await request(app).delete(`/api/accounts-payable/${sharedApId}`).set(A(adminTok));
    if (sharedSupId) await request(app).delete(`/api/suppliers/${sharedSupId}`).set(A(adminTok));
    if (sharedCustId) await request(app).delete(`/api/customers/${sharedCustId}`).set(A(adminTok));
    const r1 = await request(app).delete(`/api/bank-accounts/${acc1}`).set(A(adminTok));
    expect(r1.status).toBe(200);
    const r2 = await request(app).delete(`/api/bank-accounts/${acc2}`).set(A(adminTok));
    expect(r2.status).toBe(200);
  });

  test('schema：name 缺失 → 400', async () => {
    const r = await request(app).post('/api/bank-accounts').set(A(adminTok))
      .send({ bank_name: 'x' });
    expect(r.status).toBe(400);
  });
});
