const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-att-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-dddd';

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
  // 清理测试上传目录
  const up = path.join(__dirname, '..', 'uploads');
  try { fs.rmSync(up, { recursive: true, force: true }); } catch {}
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('附件管理', () => {
  let customerId, attachmentId;
  beforeAll(async () => {
    const r = await request(app).post('/api/customers').set(auth()).send({ name: '附件测试客户' });
    customerId = r.body.id;
  });

  test('上传 PDF 附件', async () => {
    const buf = Buffer.from('%PDF-1.4 fake content for testing');
    const r = await request(app)
      .post(`/api/attachments/customers/${customerId}`)
      .set(auth())
      .attach('files', buf, { filename: '合同.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(200);
    expect(r.body.inserted.length).toBe(1);
    expect(r.body.inserted[0].original_name).toBe('合同.pdf');
    attachmentId = r.body.inserted[0].id;
  });

  test('列出实体附件', async () => {
    const r = await request(app)
      .get(`/api/attachments/customers/${customerId}`)
      .set(auth());
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0].original_name).toBe('合同.pdf');
    expect(r.body[0].uploaded_by_name).toBe('admin');
  });

  test('下载附件', async () => {
    const r = await request(app)
      .get(`/api/attachments/file/${attachmentId}`)
      .set(auth())
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body.toString()).toContain('PDF-1.4');
  });

  test('上传多个文件', async () => {
    const r = await request(app)
      .post(`/api/attachments/customers/${customerId}`)
      .set(auth())
      .attach('files', Buffer.from('content 1'), { filename: 'a.txt', contentType: 'text/plain' })
      .attach('files', Buffer.from('content 2'), { filename: 'b.txt', contentType: 'text/plain' });
    expect(r.status).toBe(200);
    expect(r.body.inserted.length).toBe(2);
  });

  test('未授权的 entity 拒绝', async () => {
    const r = await request(app)
      .post(`/api/attachments/users/${customerId}`)
      .set(auth())
      .attach('files', Buffer.from('x'), 'a.txt');
    expect(r.status).toBe(400);
  });

  test('未上传文件 → 400', async () => {
    const r = await request(app)
      .post(`/api/attachments/customers/${customerId}`)
      .set(auth());
    expect(r.status).toBe(400);
  });

  test('未授权访问 → 401', async () => {
    const r = await request(app).get(`/api/attachments/customers/${customerId}`);
    expect(r.status).toBe(401);
  });

  test('删除附件', async () => {
    const r = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set(auth());
    expect(r.status).toBe(200);

    const list = await request(app).get(`/api/attachments/customers/${customerId}`).set(auth());
    expect(list.body.find(a => a.id === attachmentId)).toBeUndefined();
  });

  test('被禁文件类型拒绝（.exe）', async () => {
    const r = await request(app)
      .post(`/api/attachments/customers/${customerId}`)
      .set(auth())
      .attach('files', Buffer.from('MZ'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect([400, 500]).toContain(r.status);
  });

  test('删除后 audit_log 应有 delete 记录', async () => {
    const r = await request(app).get('/api/audit-log?table_name=attachments&limit=20').set(auth());
    expect(r.status).toBe(200);
    const deleted = r.body.find(x => x.action === 'delete');
    expect(deleted).toBeTruthy();
  });
});
