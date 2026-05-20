// 测试导入导出闭环：下载模板 → 导出 → 上传 → 预览 → 确认
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `finance-ie-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-ccccc';

const request = require('supertest');
const xlsx = require('xlsx');
const { initDatabase } = require('../database');
const { initSchemas } = require('../schemas');

let app, token;

beforeAll(async () => {
  await initSchemas();
  await initDatabase();
  const { createApp } = require('../app');
  app = createApp();
  const r = await request(app).post('/api/login').send({ username: 'admin', password: 'admin123' });
  token = r.body.token;
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
});

const auth = () => ({ Authorization: `Bearer ${token}` });

function readXlsxBuffer(buf) {
  const wb = xlsx.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: '' });
}

// supertest 默认不把二进制响应解为 Buffer。这里写个统一的 binary parser
function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

function buildXlsx(rows) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('导入导出 - 客户模块', () => {
  test('下载模板：返回 xlsx 且包含全部表头', async () => {
    const r = await request(app).get('/api/import-export/template/customers').set(auth())
      .buffer(true).parse(binaryParser);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheet/);
    const sheet = xlsx.read(r.body, { type: 'buffer' });
    const headerRow = xlsx.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]], { header: 1 })[0];
    expect(headerRow).toContain('客户名称');
    expect(headerRow).toContain('联系人');
    expect(headerRow).toContain('备注');
  });

  test('导出：包含已有客户数据', async () => {
    await request(app).post('/api/customers').set(auth()).send({ name: 'IE 客户 1', phone: '13800000001' });
    await request(app).post('/api/customers').set(auth()).send({ name: 'IE 客户 2', industry: '互联网' });

    const r = await request(app).get('/api/import-export/export/customers').set(auth())
      .buffer(true).parse(binaryParser);
    expect(r.status).toBe(200);
    const rows = readXlsxBuffer(r.body);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const names = rows.map(r => r['客户名称']);
    expect(names).toContain('IE 客户 1');
    expect(names).toContain('IE 客户 2');
  });

  test('导入预览：解析正常数据 + 抓必填缺失错误', async () => {
    const xlsxBuf = buildXlsx([
      { '客户名称': '导入客户 A', '电话': '13900000001', '行业': '制造' },
      { '客户名称': '', '电话': '13900000002' }, // 必填缺失
      { '客户名称': '导入客户 B' },
    ]);
    const r = await request(app).post('/api/import-export/import/customers/preview')
      .set(auth()).attach('file', xlsxBuf, 'test.xlsx');
    expect(r.status).toBe(200);
    expect(r.body.success.length).toBe(2);
    expect(r.body.errors.length).toBe(1);
    expect(r.body.errors[0].errors[0]).toMatch(/必填/);
    expect(r.body.previewId).toBeTruthy();
  });

  test('确认导入：success 行被插入 DB', async () => {
    const xlsxBuf = buildXlsx([
      { '客户名称': '确认客户 X', '电话': '13800000099' },
    ]);
    const pre = await request(app).post('/api/import-export/import/customers/preview')
      .set(auth()).attach('file', xlsxBuf, 'test.xlsx');
    expect(pre.body.success.length).toBe(1);

    const c = await request(app).post('/api/import-export/import/customers/confirm')
      .set(auth()).send({ previewId: pre.body.previewId });
    expect(c.status).toBe(200);
    expect(c.body.inserted).toBe(1);

    // DB 里应该有这条记录
    const list = await request(app).get('/api/customers?keyword=确认客户').set(auth());
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body.find(x => x.name === '确认客户 X')).toBeTruthy();
  });

  test('确认导入：previewId 用过后失效', async () => {
    const xlsxBuf = buildXlsx([{ '客户名称': '一次性客户' }]);
    const pre = await request(app).post('/api/import-export/import/customers/preview')
      .set(auth()).attach('file', xlsxBuf, 'test.xlsx');
    const c1 = await request(app).post('/api/import-export/import/customers/confirm')
      .set(auth()).send({ previewId: pre.body.previewId });
    expect(c1.status).toBe(200);
    // 再用同样 previewId
    const c2 = await request(app).post('/api/import-export/import/customers/confirm')
      .set(auth()).send({ previewId: pre.body.previewId });
    expect(c2.status).toBe(400);
  });
});

describe('导入导出 - 关联字段（合同 → 客户名）', () => {
  let custId;
  beforeAll(async () => {
    const r = await request(app).post('/api/customers').set(auth()).send({ name: '关联测试客户' });
    custId = r.body.id;
  });

  test('导入合同：客户名 → 自动解析为 customer_id', async () => {
    const xlsxBuf = buildXlsx([
      { '合同名称': '导入合同 A', '客户名称': '关联测试客户', '金额（元）': 100000, '付款方式': '按月', '开始日期': '2026-01-01' },
    ]);
    const pre = await request(app).post('/api/import-export/import/contracts/preview')
      .set(auth()).attach('file', xlsxBuf, 'c.xlsx');
    expect(pre.status).toBe(200);
    expect(pre.body.errors).toEqual([]);
    expect(pre.body.success[0].customer_id).toBe(custId);

    const ok = await request(app).post('/api/import-export/import/contracts/confirm')
      .set(auth()).send({ previewId: pre.body.previewId });
    expect(ok.status).toBe(200);
  });

  test('导入合同：找不到客户名 → 错误行', async () => {
    const xlsxBuf = buildXlsx([
      { '合同名称': '找不到客户的合同', '客户名称': '不存在的客户', '金额（元）': 1000 },
    ]);
    const pre = await request(app).post('/api/import-export/import/contracts/preview')
      .set(auth()).attach('file', xlsxBuf, 'c.xlsx');
    expect(pre.body.success.length).toBe(0);
    expect(pre.body.errors.length).toBe(1);
    expect(pre.body.errors[0].errors[0]).toMatch(/找不到|对应的记录/);
  });
});

describe('导入导出 - 错误处理', () => {
  test('未知模块 404', async () => {
    const r = await request(app).get('/api/import-export/template/notexist').set(auth());
    expect(r.status).toBe(404);
  });

  test('未上传文件 400', async () => {
    const r = await request(app).post('/api/import-export/import/customers/preview').set(auth());
    expect(r.status).toBe(400);
  });

  test('非 xlsx 文件被拒', async () => {
    const r = await request(app).post('/api/import-export/import/customers/preview')
      .set(auth()).attach('file', Buffer.from('hello'), 'test.txt');
    expect([400, 500]).toContain(r.status); // multer filter 抛错
  });

  test('未授权访问 401', async () => {
    const r = await request(app).get('/api/import-export/template/customers');
    expect(r.status).toBe(401);
  });
});

describe('导入导出 - 金额精度', () => {
  test('导入金额是元 → DB 存分 → 导出回来仍是元', async () => {
    const xlsxBuf = buildXlsx([{ '客户名称': '金额验证客户' }]);
    const pre = await request(app).post('/api/import-export/import/customers/preview')
      .set(auth()).attach('file', xlsxBuf, 'c.xlsx');
    await request(app).post('/api/import-export/import/customers/confirm')
      .set(auth()).send({ previewId: pre.body.previewId });
    const list = await request(app).get('/api/customers?keyword=金额验证').set(auth());
    const cust = list.body.find(x => x.name === '金额验证客户');
    expect(cust).toBeTruthy();

    // 用它建一个项目 + 预算
    const projXlsx = buildXlsx([
      { '项目名称': '预算 12345.67 的项目', '客户名称': '金额验证客户', '预算（元）': 12345.67 },
    ]);
    const ppre = await request(app).post('/api/import-export/import/projects/preview')
      .set(auth()).attach('file', projXlsx, 'p.xlsx');
    expect(ppre.body.errors).toEqual([]);
    const pConfirm = await request(app).post('/api/import-export/import/projects/confirm')
      .set(auth()).send({ previewId: ppre.body.previewId });
    expect(pConfirm.status).toBe(200);

    // 查回来：API 返回应该是元
    const projects = await request(app).get('/api/projects').set(auth());
    const proj = projects.body.find(p => p.name === '预算 12345.67 的项目');
    expect(proj.budget).toBeCloseTo(12345.67, 2);

    // 导出看 Excel 里也是元
    const exp = await request(app).get('/api/import-export/export/projects').set(auth())
      .buffer(true).parse(binaryParser);
    const rows = readXlsxBuffer(exp.body);
    const exported = rows.find(r => r['项目名称'] === '预算 12345.67 的项目');
    expect(Number(exported['预算（元）'])).toBeCloseTo(12345.67, 2);
  });
});
