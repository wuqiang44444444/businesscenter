const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-ssss';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, aliceTok, bobTok, financeTok, aliceId, bobId, financeId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();

  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
  const a = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'alice', password: 'pass1234', role: 'user' });
  aliceId = a.body.id;
  const b = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'bob', password: 'pass1234', role: 'user' });
  bobId = b.body.id;
  const fn = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'finance1', password: 'pass1234', role: 'finance' });
  financeId = fn.body.id;
  aliceTok = (await request(app).post('/api/login').send({ username: 'alice', password: 'pass1234' })).body.token;
  bobTok = (await request(app).post('/api/login').send({ username: 'bob', password: 'pass1234' })).body.token;
  financeTok = (await request(app).post('/api/login').send({ username: 'finance1', password: 'pass1234' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('数据权限隔离', () => {
  let aliceCustId, bobCustId;

  beforeAll(async () => {
    const c1 = await request(app).post('/api/customers').set(A(aliceTok)).send({ name: 'Alice 客户' });
    aliceCustId = c1.body.id;
    const c2 = await request(app).post('/api/customers').set(A(bobTok)).send({ name: 'Bob 客户' });
    bobCustId = c2.body.id;
  });

  test('alice 列表只看到自己创建的客户', async () => {
    const r = await request(app).get('/api/customers').set(A(aliceTok));
    expect(r.status).toBe(200);
    const names = r.body.map(c => c.name);
    expect(names).toContain('Alice 客户');
    expect(names).not.toContain('Bob 客户');
  });

  test('bob 列表只看到自己的客户', async () => {
    const r = await request(app).get('/api/customers').set(A(bobTok));
    const names = r.body.map(c => c.name);
    expect(names).not.toContain('Alice 客户');
    expect(names).toContain('Bob 客户');
  });

  test('admin 看全部', async () => {
    const r = await request(app).get('/api/customers').set(A(adminTok));
    const names = r.body.map(c => c.name);
    expect(names).toContain('Alice 客户');
    expect(names).toContain('Bob 客户');
  });

  test('finance 角色也看全部', async () => {
    const r = await request(app).get('/api/customers').set(A(financeTok));
    const names = r.body.map(c => c.name);
    expect(names).toContain('Alice 客户');
    expect(names).toContain('Bob 客户');
  });

  test('alice 直接 GET bob 的客户 → 403', async () => {
    const r = await request(app).get(`/api/customers/${bobCustId}`).set(A(aliceTok));
    expect(r.status).toBe(403);
  });

  test('alice 不能修改 bob 的客户', async () => {
    const r = await request(app).put(`/api/customers/${bobCustId}`).set(A(aliceTok)).send({ name: 'hacked' });
    expect(r.status).toBe(403);
  });

  test('alice 不能删除 bob 的客户', async () => {
    const r = await request(app).delete(`/api/customers/${bobCustId}`).set(A(aliceTok));
    expect(r.status).toBe(403);
  });

  test('admin 转交客户给 bob → bob 能看到', async () => {
    const r = await request(app).post(`/api/customers/${aliceCustId}/transfer`).set(A(adminTok))
      .send({ new_owner_id: bobId });
    expect(r.status).toBe(200);

    // alice 看不到了
    const alist = await request(app).get('/api/customers').set(A(aliceTok));
    expect(alist.body.map(c => c.name)).not.toContain('Alice 客户');

    // bob 看得到
    const blist = await request(app).get('/api/customers').set(A(bobTok));
    expect(blist.body.map(c => c.name)).toContain('Alice 客户');
  });

  test('普通用户不能转交', async () => {
    const r = await request(app).post(`/api/customers/${bobCustId}/transfer`).set(A(bobTok))
      .send({ new_owner_id: aliceId });
    expect(r.status).toBe(403);
  });

  test('合同也按 owner_id 隔离', async () => {
    const c = await request(app).post('/api/customers').set(A(aliceTok)).send({ name: 'Alice 合同客户' });
    const ct = await request(app).post('/api/contracts').set(A(aliceTok))
      .send({ name: 'Alice 合同', customer_id: c.body.id, amount: 1000 });
    expect(ct.status).toBe(200);
    const aList = await request(app).get('/api/contracts').set(A(aliceTok));
    const bList = await request(app).get('/api/contracts').set(A(bobTok));
    expect(aList.body.find(x => x.name === 'Alice 合同')).toBeTruthy();
    expect(bList.body.find(x => x.name === 'Alice 合同')).toBeFalsy();
  });
});
