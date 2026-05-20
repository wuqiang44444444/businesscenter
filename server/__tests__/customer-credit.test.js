const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-credit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-cred';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, userTok, custId, contractId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
  await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'cred-user', password: 'pass1234', role: 'user' });
  userTok = (await request(app).post('/api/login').send({ username: 'cred-user', password: 'pass1234' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('客户分级 / 信用额度', () => {
  test('创建带分级+额度+账期', async () => {
    const r = await request(app).post('/api/customers').set(A(adminTok))
      .send({
        name: '黄金客户A',
        level: 'gold',
        credit_limit: 100000,
        payment_terms_days: 30,
      });
    expect(r.status).toBe(200);
    custId = r.body.id;
  });

  test('读详情返回元转换', async () => {
    const r = await request(app).get(`/api/customers/${custId}`).set(A(adminTok));
    expect(r.body.level).toBe('gold');
    expect(r.body.credit_limit).toBe(100000);
    expect(r.body.payment_terms_days).toBe(30);
  });

  test('列表返回元转换 + 含字段', async () => {
    const r = await request(app).get('/api/customers').set(A(adminTok));
    const found = r.body.find(x => x.id === custId);
    expect(found.credit_limit).toBe(100000);
    expect(found.level).toBe('gold');
  });

  test('按 level 过滤', async () => {
    await request(app).post('/api/customers').set(A(adminTok)).send({ name: '受限B', level: 'restricted' });
    const r = await request(app).get('/api/customers?level=restricted').set(A(adminTok));
    expect(r.body.every(c => c.level === 'restricted')).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  test('schema：非法 level 拒绝', async () => {
    const r = await request(app).post('/api/customers').set(A(adminTok))
      .send({ name: 'bad', level: 'platinum' });
    expect(r.status).toBe(400);
  });

  test('schema：负数信用额度拒绝', async () => {
    const r = await request(app).post('/api/customers').set(A(adminTok))
      .send({ name: 'bad', credit_limit: -1 });
    expect(r.status).toBe(400);
  });

  test('编辑保留分级字段', async () => {
    await request(app).put(`/api/customers/${custId}`).set(A(adminTok))
      .send({ name: '黄金客户A-改', level: 'silver', credit_limit: 50000, payment_terms_days: 45 });
    const r = await request(app).get(`/api/customers/${custId}`).set(A(adminTok));
    expect(r.body.level).toBe('silver');
    expect(r.body.credit_limit).toBe(50000);
    expect(r.body.payment_terms_days).toBe(45);
  });

  test('credit-status：无合同 → 空使用', async () => {
    const r = await request(app).get(`/api/customers/${custId}/credit-status`).set(A(adminTok));
    expect(r.status).toBe(200);
    expect(r.body.used).toBe(0);
    expect(r.body.available).toBe(50000);
    expect(r.body.over_limit).toBe(false);
    expect(r.body.has_overdue).toBe(false);
    expect(r.body.usage_rate).toBe(0);
  });

  test('credit-status：建合同后已用额度 = 待付计划金额', async () => {
    const ct = await request(app).post('/api/contracts').set(A(adminTok))
      .send({ name: '合同1', customer_id: custId, amount: 30000, payment_mode: 'once', start_date: '2026-01-01' });
    contractId = ct.body.id;
    const r = await request(app).get(`/api/customers/${custId}/credit-status`).set(A(adminTok));
    expect(r.body.used).toBe(30000);
    expect(r.body.available).toBe(20000);
    expect(r.body.over_limit).toBe(false);
    expect(r.body.usage_rate).toBe(60);
  });

  test('credit-status：超额', async () => {
    await request(app).post('/api/contracts').set(A(adminTok))
      .send({ name: '合同2', customer_id: custId, amount: 50000, payment_mode: 'once', start_date: '2026-01-01' });
    const r = await request(app).get(`/api/customers/${custId}/credit-status`).set(A(adminTok));
    expect(r.body.used).toBe(80000);
    expect(r.body.over_limit).toBe(true);
    expect(r.body.available).toBe(0);
  });

  test('credit-status：信用额度=0 → over_limit 永远 false（不限额）', async () => {
    const c = await request(app).post('/api/customers').set(A(adminTok))
      .send({ name: '不限额客户', credit_limit: 0 });
    await request(app).post('/api/contracts').set(A(adminTok))
      .send({ name: '巨单', customer_id: c.body.id, amount: 999999, payment_mode: 'once', start_date: '2026-01-01' });
    const r = await request(app).get(`/api/customers/${c.body.id}/credit-status`).set(A(adminTok));
    expect(r.body.over_limit).toBe(false);
    expect(r.body.usage_rate).toBeNull();
  });

  test('其他用户不能查别人的 credit-status', async () => {
    const r = await request(app).get(`/api/customers/${custId}/credit-status`).set(A(userTok));
    expect(r.status).toBe(403);
  });

  test('credit-status：不存在的客户 → 404', async () => {
    const r = await request(app).get('/api/customers/not-exist-id/credit-status').set(A(adminTok));
    expect(r.status).toBe(404);
  });
});
