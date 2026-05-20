require('dotenv').config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: 必须设置环境变量 JWT_SECRET（至少 32 字符）。开发可用：JWT_SECRET=$(openssl rand -hex 32) npm start');
  process.exit(1);
}

const { initDatabase } = require('./database');
const { initSchemas } = require('./schemas');
const mailer = require('./lib/mailer');
const reminder = require('./lib/reminder-scheduler');

const PORT = parseInt(process.env.PORT, 10) || 3001;

(async () => {
  try {
    // schemas 必须在 app/routes 加载前就绪，否则 validateBody(schemas.X) 拿到 undefined
    await initSchemas();
    await initDatabase();
    mailer.init();          // SMTP 没配 → no-op，不影响启动
    reminder.start();       // 调度器，SMTP 没配也 no-op
    const { createApp } = require('./app');
    const app = createApp();
    app.listen(PORT, () => {
      console.log(`服务端运行在 http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
})();
