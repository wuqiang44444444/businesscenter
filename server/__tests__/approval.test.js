const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-app-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-eeee';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminToken, userToken, userId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminToken = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
  const u = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminToken}` })
    .send({ username: 'normaluser', password: 'pass1234', role: 'user' });
  userId = u.body.id;
  userToken = (await request(app).post('/api/login').send({ username: 'normaluser', password: 'pass1234' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
const userAuth = () => ({ Authorization: `Bearer ${userToken}` });

describe('合同审批工作流', () => {
  let custId, contractId;

  beforeAll(async () => {
    const c = await request(app).post('/api/customers').set(adminAuth()).send({ name: '审批客户' });
    custId = c.body.id;
    const ct = await request(app).post('/api/contracts').set(userAuth())
      .send({ name: '审批合同', customer_id: custId, amount: 1000 });
    contractId = ct.body.id;
  });

  test('新建合同默认 draft', async () => {
    const r = await request(app).get(`/api/contracts/${contractId}`).set(adminAuth());
    expect(r.body.approval_status).toBe('draft');
  });

  test('创建人 submit → submitted', async () => {
    const r = await request(app).post(`/api/contracts/${contractId}/submit`).set(userAuth());
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/contracts/${contractId}`).set(adminAuth());
    expect(d.body.approval_status).toBe('submitted');
    expect(d.body.submitted_at).toBeTruthy();
  });

  test('非创建人/非 admin 不能 submit', async () => {
    // 已经 submitted 不可再 submit，先 reject 让它回到 rejected
    await request(app).post(`/api/contracts/${contractId}/reject`).set(adminAuth()).send({ remark: '测试驳回' });
    // 用 admin 自己再创建一个 contract 由 admin 拥有
    const c2 = await request(app).post('/api/contracts').set(adminAuth())
      .send({ name: '别人的合同', customer_id: custId, amount: 100 });
    // user 不是创建人，submit 应被拒绝
    const r = await request(app).post(`/api/contracts/${c2.body.id}/submit`).set(userAuth());
    expect(r.status).toBe(403);
  });

  test('rejected 后可以重新 submit', async () => {
    // contract 现在是 rejected
    let d = await request(app).get(`/api/contracts/${contractId}`).set(adminAuth());
    expect(d.body.approval_status).toBe('rejected');
    expect(d.body.approval_remark).toBe('测试驳回');

    // 重新提交
    await request(app).post(`/api/contracts/${contractId}/submit`).set(userAuth());
    d = await request(app).get(`/api/contracts/${contractId}`).set(adminAuth());
    expect(d.body.approval_status).toBe('submitted');
    expect(d.body.approval_remark).toBeNull(); // 重提交清空驳回理由
  });

  test('普通用户不能 approve', async () => {
    const r = await request(app).post(`/api/contracts/${contractId}/approve`).set(userAuth());
    expect(r.status).toBe(403);
  });

  test('admin approve → approved', async () => {
    const r = await request(app).post(`/api/contracts/${contractId}/approve`).set(adminAuth());
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/contracts/${contractId}`).set(adminAuth());
    expect(d.body.approval_status).toBe('approved');
    expect(d.body.approved_at).toBeTruthy();
  });

  test('approved 后不能再 submit/approve/reject', async () => {
    const s = await request(app).post(`/api/contracts/${contractId}/submit`).set(userAuth());
    expect(s.status).toBe(400);
    const a = await request(app).post(`/api/contracts/${contractId}/approve`).set(adminAuth());
    expect(a.status).toBe(400);
    const j = await request(app).post(`/api/contracts/${contractId}/reject`).set(adminAuth()).send({ remark: 'x' });
    expect(j.status).toBe(400);
  });

  test('驳回必须填理由', async () => {
    const c3 = await request(app).post('/api/contracts').set(userAuth())
      .send({ name: 'no-remark', customer_id: custId, amount: 1 });
    await request(app).post(`/api/contracts/${c3.body.id}/submit`).set(userAuth());
    const r1 = await request(app).post(`/api/contracts/${c3.body.id}/reject`).set(adminAuth()).send({});
    expect(r1.status).toBe(400);
    const r2 = await request(app).post(`/api/contracts/${c3.body.id}/reject`).set(adminAuth()).send({ remark: '   ' });
    expect(r2.status).toBe(400);
  });

  test('待审批数 endpoint', async () => {
    const r = await request(app).get('/api/contracts/_pending_count').set(adminAuth());
    expect(r.status).toBe(200);
    expect(typeof r.body.count).toBe('number');
  });

  test('按 approval_status 过滤列表', async () => {
    const r = await request(app).get('/api/contracts?approval_status=approved').set(adminAuth());
    expect(r.status).toBe(200);
    expect(r.body.every(c => c.approval_status === 'approved')).toBe(true);
  });

  test('审计日志含 submit / approve / reject 三种 action', async () => {
    const r = await request(app).get('/api/audit-log?table_name=contracts&limit=200').set(adminAuth());
    const actions = new Set(r.body.map(x => x.action));
    expect(actions.has('submit')).toBe(true);
    expect(actions.has('approve')).toBe(true);
    expect(actions.has('reject')).toBe(true);
  });
});
