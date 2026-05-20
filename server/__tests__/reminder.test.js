const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-remind-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-rrrr';
// 不配 SMTP → mailer.send 应该返回 {skipped:true}

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, token;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const mailer = require('../lib/mailer');
  mailer.init();
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

describe('邮件提醒', () => {
  test('mailer-status SMTP 未配置时 configured=false', async () => {
    const r = await request(app).get('/api/admin/mailer-status').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
  });

  test('run-reminders SMTP 没配返回 skipped', async () => {
    const r = await request(app).post('/api/admin/run-reminders').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.skipped).toBe(true);
  });

  test('test-email SMTP 没配返回 503', async () => {
    const r = await request(app).post('/api/admin/test-email').set(auth()).send({ to: 'a@b.c' });
    expect(r.status).toBe(503);
  });

  test('test-email 缺收件人 400', async () => {
    const r = await request(app).post('/api/admin/test-email').set(auth()).send({});
    expect(r.status).toBe(400);
  });

  test('非 admin 不能访问 admin 接口', async () => {
    const u = await request(app).post('/api/users').set(auth())
      .send({ username: 'remind-user', password: 'pass1234', role: 'user' });
    const uToken = (await request(app).post('/api/login').send({ username: 'remind-user', password: 'pass1234' })).body.token;
    const r = await request(app).post('/api/admin/run-reminders').set({ Authorization: `Bearer ${uToken}` });
    expect(r.status).toBe(403);
    await request(app).delete(`/api/users/${u.body.id}`).set(auth());
  });

  test('用户表支持 email 字段', async () => {
    const u = await request(app).post('/api/users').set(auth())
      .send({ username: 'mailtest', password: 'pass1234', email: 'test@example.com' });
    expect(u.status).toBe(200);
    expect(u.body.email).toBe('test@example.com');

    const list = await request(app).get('/api/users').set(auth());
    const found = list.body.find(x => x.username === 'mailtest');
    expect(found.email).toBe('test@example.com');

    // 更新 email
    await request(app).put(`/api/users/${u.body.id}`).set(auth())
      .send({ real_name: '', role: 'user', permissions: [], status: 'active', email: 'new@example.com' });
    const list2 = await request(app).get('/api/users').set(auth());
    expect(list2.body.find(x => x.username === 'mailtest').email).toBe('new@example.com');

    await request(app).delete(`/api/users/${u.body.id}`).set(auth());
  });

  test('email 格式非法 → 400', async () => {
    const r = await request(app).post('/api/users').set(auth())
      .send({ username: 'badmail', password: 'pass1234', email: 'not-an-email' });
    expect(r.status).toBe(400);
  });
});
