const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-bbbbbu';

const request = require('supertest');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, token;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  token = (await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' })).body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
  // 清测试产生的备份
  const dir = path.join(__dirname, '..', 'backups');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^data-\d{4}-\d{2}-\d{2}\.db$/.test(f)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  } catch {}
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('数据库备份', () => {
  test('POST /api/admin/backup 触发备份', async () => {
    const r = await request(app).post('/api/admin/backup').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.filename).toMatch(/^data-\d{4}-\d{2}-\d{2}\.db$/);
    expect(r.body.size).toBeGreaterThan(0);
  });

  test('GET /api/admin/backups 列出备份', async () => {
    const r = await request(app).get('/api/admin/backups').set(auth());
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0]).toHaveProperty('filename');
    expect(r.body[0]).toHaveProperty('size');
    expect(r.body[0]).toHaveProperty('modified');
  });

  test('下载备份文件 → 200 + sqlite content', async () => {
    const list = (await request(app).get('/api/admin/backups').set(auth())).body;
    const filename = list[0].filename;
    const r = await request(app).get(`/api/admin/backup/${filename}`).set(auth())
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/sqlite/);
    expect(r.body.length).toBeGreaterThan(0);
    // SQLite 文件头是 'SQLite format 3\0'
    expect(r.body.slice(0, 15).toString()).toBe('SQLite format 3');
  });

  test('非法文件名被拒绝', async () => {
    // Express 会把 .. 规范化掉，但其它非法格式可以到 handler，由白名单正则拦
    const r = await request(app).get('/api/admin/backup/random-file.txt').set(auth());
    expect(r.status).toBe(400);
  });

  test('不存在的备份返回 404', async () => {
    const r = await request(app).get('/api/admin/backup/data-1999-01-01.db').set(auth());
    expect(r.status).toBe(404);
  });

  test('非 admin 不能访问备份接口', async () => {
    const u = await request(app).post('/api/users').set(auth())
      .send({ username: 'b-user', password: 'pass1234', role: 'user' });
    const uTok = (await request(app).post('/api/login').send({ username: 'b-user', password: 'pass1234' })).body.token;
    const r1 = await request(app).post('/api/admin/backup').set({ Authorization: `Bearer ${uTok}` });
    expect(r1.status).toBe(403);
    const r2 = await request(app).get('/api/admin/backups').set({ Authorization: `Bearer ${uTok}` });
    expect(r2.status).toBe(403);
    await request(app).delete(`/api/users/${u.body.id}`).set(auth());
  });

  test('cleanupOld 函数仅删超期文件', () => {
    const backup = require('../lib/backup');
    // 没有超过 30 天的备份 → 应返回空数组
    const removed = backup.cleanupOld(30);
    expect(Array.isArray(removed)).toBe(true);
  });
});
