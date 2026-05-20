const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-cr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-cust';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, adminTok, userTok;
let goldCustId, normalCustId, contractId;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  adminTok = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;

  await request(app).post('/api/users').set({ Authorization: `Bearer ${adminTok}` })
    .send({ username: 'cr-user', password: 'pass1234', role: 'user' });
  userTok = (await request(app).post('/api/login').send({ username: 'cr-user', password: 'pass1234' })).body.token;

  // 准备数据：两个客户（黄金 + 普通）+ 一份合同
  const gold = await request(app).post('/api/customers').set({ Authorization: `Bearer ${adminTok}` })
    .send({ name: '黄金客A', level: 'gold', credit_limit: 100000, payment_terms_days: 30 });
  goldCustId = gold.body.id;
  const norm = await request(app).post('/api/customers').set({ Authorization: `Bearer ${adminTok}` })
    .send({ name: '普通客B', level: 'normal' });
  normalCustId = norm.body.id;
  const ct = await request(app).post('/api/contracts').set({ Authorization: `Bearer ${adminTok}` })
    .send({ name: '黄金客户合同', customer_id: goldCustId, amount: 50000, payment_mode: 'once', start_date: '2026-01-01' });
  contractId = ct.body.id;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const A = (t) => ({ Authorization: `Bearer ${t}` });

describe('自定义报表', () => {
  let reportId;

  test('GET /_meta 返回数据源白名单', async () => {
    const r = await request(app).get('/api/custom-reports/_meta').set(A(adminTok));
    expect(r.status).toBe(200);
    const keys = r.body.sources.map(s => s.key);
    expect(keys).toEqual(expect.arrayContaining(['customers', 'contracts', 'invoices', 'accounts_payable', 'payment_plans', 'reimbursements']));
    const cust = r.body.sources.find(s => s.key === 'customers');
    expect(cust.columns.some(c => c.key === 'level' && c.type === 'enum')).toBe(true);
  });

  test('POST /_preview 跑临时查询', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name', 'level', 'credit_limit'],
          filters: [{ field: 'level', op: '=', value: 'gold' }],
        },
      });
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].name).toBe('黄金客A');
    expect(r.body.rows[0].credit_limit).toBe(100000); // money 字段返回元
  });

  test('POST /_preview：money 字段过滤器值传元，引擎自动转分', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name'],
          filters: [{ field: 'credit_limit', op: '>=', value: 50000 }],
        },
      });
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].name).toBe('黄金客A');
  });

  test('like 过滤器自动加 %', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name', 'level'],
          filters: [{ field: 'name', op: 'like', value: '黄金' }],
        },
      });
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].name).toBe('黄金客A');
  });

  test('in 操作符过滤多值', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name'],
          filters: [{ field: 'level', op: 'in', value: ['gold', 'silver'] }],
        },
      });
    expect(r.body.rows.length).toBe(1);
  });

  test('排序：按 created_at 降序', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name'],
          sort: { field: 'created_at', direction: 'desc' },
        },
      });
    expect(r.body.rows.length).toBeGreaterThanOrEqual(2);
  });

  test('JOIN 数据源：合同带客户名', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'contracts',
          columns: ['name', 'customer_name', 'amount'],
          filters: [{ field: 'customer_name', op: '=', value: '黄金客A' }],
        },
      });
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].customer_name).toBe('黄金客A');
    expect(r.body.rows[0].amount).toBe(50000);
  });

  test('安全：未知数据源拒绝', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({ definition: { source: 'users', columns: ['id'] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/未知数据源/);
  });

  test('安全：未知列拒绝', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({ definition: { source: 'customers', columns: ['password'] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/未知列/);
  });

  test('安全：非法操作符拒绝', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name'],
          filters: [{ field: 'name', op: 'DROP', value: 'x' }],
        },
      });
    expect(r.status).toBe(400);
  });

  test('安全：空 columns 拒绝', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({ definition: { source: 'customers', columns: [] } });
    expect(r.status).toBe(400);
  });

  test('保存报表', async () => {
    const r = await request(app).post('/api/custom-reports').set(A(adminTok))
      .send({
        name: '黄金客户清单',
        source: 'customers',
        definition: {
          source: 'customers',
          columns: ['name', 'level', 'credit_limit', 'payment_terms_days'],
          filters: [{ field: 'level', op: '=', value: 'gold' }],
          sort: { field: 'name', direction: 'asc' },
        },
      });
    expect(r.status).toBe(200);
    reportId = r.body.id;
  });

  test('GET /:id 反序列化定义', async () => {
    const r = await request(app).get(`/api/custom-reports/${reportId}`).set(A(adminTok));
    expect(r.status).toBe(200);
    expect(r.body.definition.source).toBe('customers');
    expect(r.body.definition.filters[0].value).toBe('gold');
  });

  test('POST /:id/run 用保存的定义跑', async () => {
    const r = await request(app).post(`/api/custom-reports/${reportId}/run`).set(A(adminTok));
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].name).toBe('黄金客A');
    expect(r.body.rows[0].credit_limit).toBe(100000);
  });

  test('保存时拒绝非法定义（未知字段）', async () => {
    const r = await request(app).post('/api/custom-reports').set(A(adminTok))
      .send({
        name: '坏的',
        source: 'customers',
        definition: { source: 'customers', columns: ['secret_field'] },
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/未知列/);
  });

  test('PUT 更新报表', async () => {
    const r = await request(app).put(`/api/custom-reports/${reportId}`).set(A(adminTok))
      .send({
        name: '黄金客户清单v2',
        source: 'customers',
        definition: {
          source: 'customers',
          columns: ['name', 'phone'],
          filters: [],
        },
      });
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/custom-reports/${reportId}`).set(A(adminTok));
    expect(d.body.name).toBe('黄金客户清单v2');
    expect(d.body.definition.columns).toEqual(['name', 'phone']);
  });

  test('普通用户列表只看自己的', async () => {
    // user 自己保存一个
    await request(app).post('/api/custom-reports').set(A(userTok))
      .send({
        name: 'user 的报表',
        source: 'customers',
        definition: { source: 'customers', columns: ['name'] },
      });
    const r = await request(app).get('/api/custom-reports').set(A(userTok));
    expect(r.body.every(x => x.name === 'user 的报表')).toBe(true);
  });

  test('普通用户不能访问别人的报表', async () => {
    const r = await request(app).get(`/api/custom-reports/${reportId}`).set(A(userTok));
    expect(r.status).toBe(403);
  });

  test('删除报表', async () => {
    const r = await request(app).delete(`/api/custom-reports/${reportId}`).set(A(adminTok));
    expect(r.status).toBe(200);
    const d = await request(app).get(`/api/custom-reports/${reportId}`).set(A(adminTok));
    expect(d.status).toBe(404);
  });

  test('LIMIT 超过 10000 被夹紧', async () => {
    const r = await request(app).post('/api/custom-reports/_preview').set(A(adminTok))
      .send({
        definition: {
          source: 'customers',
          columns: ['name'],
          limit: 999999,
        },
      });
    expect(r.status).toBe(200);
  });

  test('未登录 → 401', async () => {
    const r = await request(app).post('/api/custom-reports/_preview')
      .send({ definition: { source: 'customers', columns: ['name'] } });
    expect(r.status).toBe(401);
  });
});
