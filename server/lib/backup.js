// 自动备份：每天凌晨用 better-sqlite3 原生 backup API 把 data.db 复制到 backups/
// 文件名 data-YYYY-MM-DD.db；保留最近 N 天（默认 30）

const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const ONE_DAY = 24 * 60 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 跑一次备份。返回 { path, size }
async function runBackup() {
  ensureDir();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `data-${date}.db`;
  const dest = path.join(BACKUP_DIR, filename);

  // raw 是 better-sqlite3 实例。.backup() 是原生原子备份（WAL 安全，热备份）
  const compatDb = getDb();
  const raw = compatDb.raw;
  if (!raw || typeof raw.backup !== 'function') {
    throw new Error('数据库实例不支持原生 backup');
  }
  // 如果今天已备份过，先覆盖（同 day 多次备份只保留最新）
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  await raw.backup(dest);

  const size = fs.statSync(dest).size;
  return { path: dest, filename, size, date };
}

// 删超期备份
function cleanupOld(keepDays = 30) {
  ensureDir();
  const now = Date.now();
  const removed = [];
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!/^data-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
    const abs = path.join(BACKUP_DIR, f);
    const age = now - fs.statSync(abs).mtimeMs;
    if (age > keepDays * ONE_DAY) {
      fs.unlinkSync(abs);
      removed.push(f);
    }
  }
  return removed;
}

function listBackups() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => /^data-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
    });
}

// 启动调度器：服务启动后 1 分钟跑一次（首次）+ 之后每 24 小时
function start(keepDays = 30) {
  const tick = async () => {
    try {
      const r = await runBackup();
      const removed = cleanupOld(keepDays);
      console.log(`[backup] 备份完成: ${r.filename} (${(r.size / 1024 / 1024).toFixed(2)} MB)`,
        removed.length ? `，已清理 ${removed.length} 个旧备份` : '');
    } catch (e) {
      console.error('[backup] 失败:', e.message);
    }
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, ONE_DAY);
  console.log('[backup] 调度器已启动（每 24 小时一次，保留 ' + keepDays + ' 天）');
}

module.exports = { runBackup, cleanupOld, listBackups, start };
