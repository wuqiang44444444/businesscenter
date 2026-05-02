const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../database');
const { authMiddleware, SECRET } = require('../middleware/auth');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

// 登录限频：5 分钟内同 IP 最多 20 次（生产环境可降到 5-10）
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { error: '登录尝试过于频繁，请 5 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, validateBody(schemas.login), (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const result = db.exec(`SELECT * FROM users WHERE username = ? AND status = 'active'`, [username]);
  if (!result[0] || result[0].values.length === 0) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }
  const columns = result[0].columns;
  const row = result[0].values[0];
  const user = {};
  columns.forEach((col, i) => user[col] = row[i]);

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, permissions: JSON.parse(user.permissions || '[]') },
    SECRET,
    { expiresIn: '7d' }
  );
  // 设置 httpOnly cookie（防 XSS 偷 token）。SameSite=Lax 兼容大多数浏览器。
  // 是否要求 HTTPS：仅当 COOKIE_SECURE=true 时启用。
  // 默认 false，方便没配 HTTPS 的初始部署。配好 HTTPS 后再设 COOKIE_SECURE=true。
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({
    token,  // 兼容老客户端/脚本；新客户端应从 cookie 读
    user: {
      id: user.id,
      username: user.username,
      real_name: user.real_name,
      role: user.role,
      permissions: JSON.parse(user.permissions || '[]'),
      must_change_password: !!user.must_change_password,
    },
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { path: '/' });
  res.json({ success: true });
});

router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const result = db.exec(`SELECT id, username, real_name, role, permissions FROM users WHERE id = ?`, [req.user.id]);
  if (!result[0] || result[0].values.length === 0) return res.status(404).json({ error: '用户不存在' });
  const columns = result[0].columns;
  const row = result[0].values[0];
  const user = {};
  columns.forEach((col, i) => user[col] = row[i]);
  user.permissions = JSON.parse(user.permissions || '[]');
  res.json(user);
});

router.post('/change-password', authMiddleware, validateBody(schemas.changePassword), (req, res) => {
  const { old_password, new_password } = req.body;
  if (new_password === 'admin123') {
    return res.status(400).json({ error: '不能使用默认密码' });
  }
  const db = getDb();
  const r = db.exec(`SELECT password FROM users WHERE id = ?`, [req.user.id]);
  if (!r[0] || r[0].values.length === 0) return res.status(404).json({ error: '用户不存在' });
  if (!bcrypt.compareSync(old_password, r[0].values[0][0])) {
    return res.status(400).json({ error: '原密码错误' });
  }
  const newHash = bcrypt.hashSync(new_password, 10);
  db.run(`UPDATE users SET password=?, must_change_password=0, updated_at=datetime('now','localtime') WHERE id=?`, [newHash, req.user.id]);
  res.json({ success: true });
});

module.exports = router;
