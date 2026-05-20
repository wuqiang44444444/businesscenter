// admin 维护接口（提醒、邮件测试等）
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const mailer = require('../lib/mailer');
const reminder = require('../lib/reminder-scheduler');

const router = express.Router();

// 手动触发一次提醒扫描
router.post('/run-reminders', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await reminder.runAll();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 发测试邮件，用来验证 SMTP 配置
router.post('/test-email', authMiddleware, adminMiddleware, async (req, res) => {
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: '请提供收件人 to' });
  if (!mailer.isReady()) return res.status(503).json({ error: 'SMTP 未配置' });
  try {
    const r = await mailer.send({
      to,
      subject: 'Business · 测试邮件',
      html: `<p>这是一封来自 Business 的测试邮件。</p><p>如果您收到了，说明 SMTP 已配置成功。</p>`,
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SMTP 配置状态
router.get('/mailer-status', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ configured: mailer.isReady() });
});

module.exports = router;
