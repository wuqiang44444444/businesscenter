const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

let raw = null;       // better-sqlite3 实例
let compatDb = null;  // 暴露给 index.js 的 sql.js 兼容对象

// ========== sql.js 兼容层 ==========
// 让 index.js 的旧调用 db.exec(sql, params) / db.run(sql, params) 继续可用，
// 底层改成 better-sqlite3。语义对齐 sql.js：
//   - exec 对 SELECT 返回 [{columns, values}]，无行时返回 []
//   - exec / run 对 mutation 返回 []
function exec(sql, params = []) {
  const stmt = raw.prepare(sql);
  const args = Array.isArray(params) ? params : [params];
  if (stmt.reader) {
    const rows = stmt.all(...args);
    if (rows.length === 0) return [];
    const columns = Object.keys(rows[0]);
    const values = rows.map(r => columns.map(c => r[c]));
    return [{ columns, values }];
  }
  stmt.run(...args);
  return [];
}

function run(sql, params = []) {
  const args = Array.isArray(params) ? params : [params];
  raw.prepare(sql).run(...args);
}

function transaction(fn) {
  return raw.transaction(fn);
}

// ========== 初始化 ==========
async function initDatabase() {
  raw = new Database(DB_PATH);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  compatDb = { exec, run, transaction, raw };

  // 表定义（FK ON DELETE 行为见 IMPROVEMENTS.md #1）
  raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      real_name TEXT,
      role TEXT DEFAULT 'user',
      permissions TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      must_change_password INTEGER DEFAULT 0,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      industry TEXT,
      remark TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      customer_id TEXT,
      status TEXT DEFAULT 'active',
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      manager TEXT,
      budget REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      project_id TEXT,
      contract_no TEXT,
      amount REAL DEFAULT 0,
      payment_mode TEXT DEFAULT 'monthly',
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      description TEXT,
      attachment TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS payment_plans (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      period TEXT,
      amount REAL DEFAULT 0,
      due_date TEXT,
      actual_date TEXT,
      status TEXT DEFAULT 'pending',
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      category TEXT,
      bank_name TEXT,
      bank_account TEXT,
      remark TEXT,
      status TEXT DEFAULT 'active',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS accounts_payable (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      invoice_no TEXT,
      description TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS payable_payments (
      id TEXT PRIMARY KEY,
      payable_id TEXT NOT NULL,
      amount REAL DEFAULT 0,
      payment_date TEXT,
      payment_method TEXT,
      remark TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (payable_id) REFERENCES accounts_payable(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      invoice_no TEXT UNIQUE NOT NULL,
      invoice_type TEXT DEFAULT 'normal',
      amount REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0.13,
      tax_amount REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      issue_date TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      remark TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      related_id TEXT,
      related_type TEXT,
      is_read TEXT DEFAULT '0',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip TEXT,
      -- 用 strftime %f 拿到毫秒精度（YYYY-MM-DD HH:MM:SS.fff），避免同秒多事件无法排序
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      entity_table TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER DEFAULT 0,
      uploaded_by TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_table, entity_id);
  `);

  // 老库补 must_change_password / email 列（幂等）
  const userCols = raw.prepare(`PRAGMA table_info(users)`).all();
  if (!userCols.some(c => c.name === 'must_change_password')) {
    raw.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`);
  }
  if (!userCols.some(c => c.name === 'email')) {
    raw.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
  }

  migrateForeignKeys();
  migrateMoneyToCents();
  migrateAuditTimestampMs();
  migrateContractApproval();

  // 默认管理员
  const adminRow = raw.prepare(`SELECT password, must_change_password FROM users WHERE username='admin'`).get();
  if (!adminRow) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    raw.prepare(`INSERT INTO users (id, username, password, real_name, role, permissions, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .run('admin', 'admin', hashedPassword, '系统管理员', 'admin', JSON.stringify(['all']));
    console.log('默认管理员已创建: admin / admin123（首次登录后必须改密）');
  } else if (!adminRow.must_change_password && bcrypt.compareSync('admin123', adminRow.password)) {
    raw.prepare(`UPDATE users SET must_change_password = 1 WHERE username = 'admin'`).run();
    console.log('检测到 admin 仍使用默认密码，已标记强制改密');
  }

  return compatDb;
}

// 老 schema（无 ON DELETE 子句）→ 新 schema 迁移
function migrateForeignKeys() {
  const tablesToMigrate = ['projects', 'contracts', 'payment_plans', 'accounts_payable', 'payable_payments', 'invoices', 'notifications'];
  const newSchemas = {
    projects: `CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, customer_id TEXT,
      status TEXT DEFAULT 'active', start_date TEXT, end_date TEXT,
      description TEXT, manager TEXT, budget REAL DEFAULT 0, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    )`,
    contracts: `CREATE TABLE contracts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, customer_id TEXT NOT NULL,
      project_id TEXT, contract_no TEXT, amount REAL DEFAULT 0,
      payment_mode TEXT DEFAULT 'monthly', start_date TEXT, end_date TEXT,
      status TEXT DEFAULT 'active', description TEXT, attachment TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
    )`,
    payment_plans: `CREATE TABLE payment_plans (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, period TEXT,
      amount REAL DEFAULT 0, due_date TEXT, actual_date TEXT,
      status TEXT DEFAULT 'pending', remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    )`,
    accounts_payable: `CREATE TABLE accounts_payable (
      id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, project_id TEXT,
      title TEXT NOT NULL, amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0,
      due_date TEXT, status TEXT DEFAULT 'pending', invoice_no TEXT,
      description TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
    )`,
    payable_payments: `CREATE TABLE payable_payments (
      id TEXT PRIMARY KEY, payable_id TEXT NOT NULL, amount REAL DEFAULT 0,
      payment_date TEXT, payment_method TEXT, remark TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (payable_id) REFERENCES accounts_payable(id) ON DELETE CASCADE
    )`,
    invoices: `CREATE TABLE invoices (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL,
      invoice_no TEXT UNIQUE NOT NULL, invoice_type TEXT DEFAULT 'normal',
      amount REAL DEFAULT 0, tax_rate REAL DEFAULT 0.13, tax_amount REAL DEFAULT 0,
      total_amount REAL DEFAULT 0, issue_date TEXT, due_date TEXT,
      status TEXT DEFAULT 'pending', remark TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    )`,
    notifications: `CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT, related_id TEXT, related_type TEXT,
      is_read TEXT DEFAULT '0',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  };

  let anyMigrated = false;
  for (const t of tablesToMigrate) {
    const row = raw.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (!row) continue;
    if ((row.sql || '').includes('ON DELETE')) continue;

    console.log(`迁移外键约束: ${t}`);
    raw.pragma('foreign_keys = OFF');
    const migrate = raw.transaction(() => {
      raw.exec(`ALTER TABLE ${t} RENAME TO ${t}__old`);
      raw.exec(newSchemas[t]);
      const cols = raw.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).join(', ');
      raw.exec(`INSERT INTO ${t} (${cols}) SELECT ${cols} FROM ${t}__old`);
      raw.exec(`DROP TABLE ${t}__old`);
    });
    migrate();
    raw.pragma('foreign_keys = ON');
    anyMigrated = true;
  }
  if (anyMigrated) console.log('外键迁移完成');
}

// 一次性迁移：把所有金额列从"元"改为"分"（×100 取整）
// 之后所有读写都用分；handler 在 API 边界做 ÷100 / ×100 转换。
function migrateMoneyToCents() {
  const ID = 'money_to_cents_v1';
  const done = raw.prepare(`SELECT id FROM migrations WHERE id = ?`).get(ID);
  if (done) return;

  const moneyColumns = [
    ['contracts', 'amount'],
    ['payment_plans', 'amount'],
    ['accounts_payable', 'amount'],
    ['accounts_payable', 'paid_amount'],
    ['payable_payments', 'amount'],
    ['invoices', 'amount'],
    ['invoices', 'tax_amount'],
    ['invoices', 'total_amount'],
    ['projects', 'budget'],
  ];

  const tx = raw.transaction(() => {
    for (const [t, c] of moneyColumns) {
      raw.exec(`UPDATE ${t} SET ${c} = ROUND(${c} * 100) WHERE ${c} IS NOT NULL`);
    }
    raw.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(ID);
  });
  tx();
  console.log('迁移完成：金额改为整数分存储');
}

// 把 audit_log.created_at 默认值从秒精度升级到毫秒精度
// 原 default: datetime('now','localtime') → strftime('%Y-%m-%d %H:%M:%f','now','localtime')
function migrateAuditTimestampMs() {
  const ID = 'audit_log_ts_ms_v1';
  const done = raw.prepare(`SELECT id FROM migrations WHERE id = ?`).get(ID);
  if (done) return;

  const row = raw.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'`).get();
  if (!row) {
    raw.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(ID);
    return;
  }
  // 已经是新 schema（含 strftime）就跳过
  if ((row.sql || '').includes('strftime')) {
    raw.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(ID);
    return;
  }

  console.log('迁移审计日志时间戳到毫秒精度...');
  raw.pragma('foreign_keys = OFF');
  const tx = raw.transaction(() => {
    raw.exec(`ALTER TABLE audit_log RENAME TO audit_log__old`);
    raw.exec(`CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now','localtime'))
    )`);
    raw.exec(`INSERT INTO audit_log (id, user_id, username, action, table_name, record_id, before_json, after_json, ip, created_at)
              SELECT id, user_id, username, action, table_name, record_id, before_json, after_json, ip, created_at FROM audit_log__old`);
    raw.exec(`DROP TABLE audit_log__old`);
    raw.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id)`);
    raw.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at)`);
    raw.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(ID);
  });
  tx();
  raw.pragma('foreign_keys = ON');
  console.log('审计日志时间戳迁移完成');
}

// 给 contracts 加审批工作流字段。老数据默认 'approved' 不阻塞使用。
function migrateContractApproval() {
  const ID = 'contract_approval_v1';
  const done = raw.prepare(`SELECT id FROM migrations WHERE id = ?`).get(ID);
  if (done) return;

  const cols = raw.prepare(`PRAGMA table_info(contracts)`).all().map(c => c.name);
  const tx = raw.transaction(() => {
    if (!cols.includes('approval_status')) {
      raw.exec(`ALTER TABLE contracts ADD COLUMN approval_status TEXT DEFAULT 'approved'`);
      raw.exec(`UPDATE contracts SET approval_status = 'approved' WHERE approval_status IS NULL`);
    }
    if (!cols.includes('approval_remark')) raw.exec(`ALTER TABLE contracts ADD COLUMN approval_remark TEXT`);
    if (!cols.includes('submitted_at')) raw.exec(`ALTER TABLE contracts ADD COLUMN submitted_at TEXT`);
    if (!cols.includes('submitted_by')) raw.exec(`ALTER TABLE contracts ADD COLUMN submitted_by TEXT`);
    if (!cols.includes('approved_at')) raw.exec(`ALTER TABLE contracts ADD COLUMN approved_at TEXT`);
    if (!cols.includes('approved_by')) raw.exec(`ALTER TABLE contracts ADD COLUMN approved_by TEXT`);
    raw.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(ID);
  });
  tx();
  console.log('合同审批字段迁移完成');
}

// better-sqlite3 写入即落盘，saveDatabase 保留为 no-op 以兼容旧调用点
function saveDatabase() {}

function getDb() {
  return compatDb;
}

module.exports = { initDatabase, saveDatabase, getDb };
