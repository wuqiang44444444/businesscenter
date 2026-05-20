const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-reim-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-reim';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, financeTok, userTok, otherUserTok, userId, otherUserId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;

  const fin = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'reim-fin', password: 'pass1234', role: 'finance' });
  financeTok = (await request(app).post('/api/login').send({ username: 'reim-fin', password: 'pass1234' })).body.token;

  const u = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'reim-user', password: 'pass1234', role: 'user' });
  userId = u.body.id;
  userTok = (await request(app).post('/api/login').send({ username: 'reim-user', password: 'pass1234' })).body.token;

  const o = await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'reim-other', password: 'pass1234', role: 'user' });
  otherUserId = o.body.id;
  otherUserTok = (await request(app).post('/api/login').send({ username: 'reim-other', password: 'pass1234' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('费用报销', () => {
  let reimId;

  test('用户创建报销单', async () => {
    const r = await request(app).post('/api/reimbursements').set(A(userTok))
      .send({ title: '出差打车', category: 'travel', amount: 256.5, occurred_date: '2026-05-01', description: '客户拜访' });
    expect(r.status).toBe(200);
    reimId = r.body.id;
  });

  test('详情返回元转换 + 默认 submitted', async () => {
    const r = await request(app).get(`/api/reimbursements/${reimId}`).set(A(userTok));
    expect(r.status).toBe(200);
    expect(r.body.amount).toBe(256.5);
    expect(r.body.status).toBe('submitted');
  });

  test('schema：金额负数 → 400', async () => {
    const r = await request(app).post('/api/reimbursements').set(A(userTok))
      .send({ title: '错误', amount: -10 });
    expect(r.status).toBe(400);
  });

  test('schema：title 缺失 → 400', async () => {
    const r = await request(app).post('/api/reimbursements').set(A(userTok))
      .send({ amount: 100 });
    expect(r.status).toBe(400);
  });

  test('普通用户列表只能看到自己的', async () => {
    // other user 创建一单
    await request(app).post('/api/reimbursements').set(A(otherUserTok))
      .send({ title: '别人的', category: 'meal', amount: 50 });
    const mine = await request(app).get('/api/reimbursements').set(A(userTok));
    expect(mine.status).toBe(200);
    expect(mine.body.every(x => x.applicant_id === userId)).toBe(true);
  });

  test('财务可以看到全部', async () => {
    const all = await request(app).get('/api/reimbursements').set(A(financeTok));
    expect(all.body.length).toBeGreaterThanOrEqual(2);
  });

  test('财务 ?mine=true 只看自己（无）', async () => {
    const r = await request(app).get('/api/reimbursements?mine=true').set(A(financeTok));
    expect(r.body.every(x => x.applicant_id !== userId)).toBe(true);
  });

  test('别人不能查别人的详情', async () => {
    const r = await request(app).get(`/api/reimbursements/${reimId}`).set(A(otherUserTok));
    expect(r.status).toBe(403);
  });

  test('submitted 状态可以编辑', async () => {
    const r = await request(app).put(`/api/reimbursements/${reimId}`).set(A(userTok))
      .send({ title: '出差打车-改', amount: 300 });
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/reimbursements/${reimId}`).set(A(userTok));
    expect(d.body.amount).toBe(300);
    expect(d.body.title).toBe('出差打车-改');
  });

  test('普通用户不能 approve', async () => {
    const r = await request(app).post(`/api/reimbursements/${reimId}/approve`).set(A(userTok));
    expect(r.status).toBe(403);
  });

  test('财务 approve → approved', async () => {
    const r = await request(app).post(`/api/reimbursements/${reimId}/approve`).set(A(financeTok));
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/reimbursements/${reimId}`).set(A(financeTok));
    expect(d.body.status).toBe('approved');
    expect(d.body.approved_at).toBeTruthy();
  });

  test('approved 状态不可再编辑', async () => {
    const r = await request(app).put(`/api/reimbursements/${reimId}`).set(A(userTok))
      .send({ title: '试图改', amount: 1 });
    expect(r.status).toBe(400);
  });

  test('approved 状态不能再 approve', async () => {
    const r = await request(app).post(`/api/reimbursements/${reimId}/approve`).set(A(financeTok));
    expect(r.status).toBe(400);
  });

  test('mark-paid 需要 approved 状态', async () => {
    // 建一个新的 submitted 的 → mark-paid 应失败
    const c = await request(app).post('/api/reimbursements').set(A(userTok))
      .send({ title: '未审批', amount: 100 });
    const r = await request(app).post(`/api/reimbursements/${c.body.id}/mark-paid`).set(A(financeTok))
      .send({});
    expect(r.status).toBe(400);
  });

  test('mark-paid 可以带 bank_account_id', async () => {
    const bnk = await request(app).post('/api/bank-accounts').set(A(adminTok))
      .send({ name: '报销专用', is_default: false });
    const r = await request(app).post(`/api/reimbursements/${reimId}/mark-paid`).set(A(financeTok))
      .send({ bank_account_id: bnk.body.id });
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/reimbursements/${reimId}`).set(A(financeTok));
    expect(d.body.status).toBe('paid');
    expect(d.body.paid_at).toBeTruthy();
    expect(d.body.bank_account_id).toBe(bnk.body.id);
  });

  test('驳回必须填理由', async () => {
    const c = await request(app).post('/api/reimbursements').set(A(userTok))
      .send({ title: '驳回测试', amount: 100 });
    const r1 = await request(app).post(`/api/reimbursements/${c.body.id}/reject`).set(A(financeTok)).send({});
    expect(r1.status).toBe(400);
    const r2 = await request(app).post(`/api/reimbursements/${c.body.id}/reject`).set(A(financeTok)).send({ remark: '   ' });
    expect(r2.status).toBe(400);
    const r3 = await request(app).post(`/api/reimbursements/${c.body.id}/reject`).set(A(financeTok)).send({ remark: '凭证不全' });
    expect(r3.status).toBe(200);
    const d = await request(app).get(`/api/reimbursements/${c.body.id}`).set(A(userTok));
    expect(d.body.status).toBe('rejected');
    expect(d.body.approval_remark).toBe('凭证不全');
  });

  test('rejected 状态可以由本人删除', async () => {
    const c = await request(app).post('/api/reimbursements').set(A(userTok))
      .send({ title: 'todel', amount: 1 });
    await request(app).post(`/api/reimbursements/${c.body.id}/reject`).set(A(financeTok)).send({ remark: 'x' });
    const r = await request(app).delete(`/api/reimbursements/${c.body.id}`).set(A(userTok));
    expect(r.status).toBe(200);
  });

  test('paid 状态不能删除', async () => {
    const r = await request(app).delete(`/api/reimbursements/${reimId}`).set(A(userTok));
    expect(r.status).toBe(400);
  });

  test('_pending_count：财务能看到数字', async () => {
    const r = await request(app).get('/api/reimbursements/_pending_count').set(A(financeTok));
    expect(r.status).toBe(200);
    expect(typeof r.body.count).toBe('number');
  });

  test('_pending_count：普通用户固定返回 0', async () => {
    const r = await request(app).get('/api/reimbursements/_pending_count').set(A(userTok));
    expect(r.body.count).toBe(0);
  });

  test('?status=submitted 过滤', async () => {
    const r = await request(app).get('/api/reimbursements?status=submitted').set(A(financeTok));
    expect(r.status).toBe(200);
    expect(r.body.every(x => x.status === 'submitted')).toBe(true);
  });

  test('审计日志包含 create / update / approve / mark-paid / reject', async () => {
    const r = await request(app).get('/api/audit-log?table_name=reimbursements&limit=200').set(A(adminTok));
    const actions = new Set(r.body.map(x => x.action));
    expect(actions.has('create')).toBe(true);
    expect(actions.has('update')).toBe(true);
    expect(actions.has('approve')).toBe(true);
    expect(actions.has('mark-paid')).toBe(true);
    expect(actions.has('reject')).toBe(true);
  });
});
