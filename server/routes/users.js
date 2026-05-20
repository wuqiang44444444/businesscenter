const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { snapshot, audit, rowsToObjects } = require('../lib/helpers');
const { validateBody } = require('../lib/validate');
const schemas = require('../schemas');

const router = express.Router();

router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDb();
  const result = db.exec(`SELECT id, username, real_name, role, permissions, status, email, created_at FROM users ORDER BY created_at DESC`);
  const users = rowsToObjects(result).map(u => ({ ...u, permissions: JSON.parse(u.permissions || '[]') }));
  res.json(users);
});

router.post('/', authMiddleware, adminMiddleware, validateBody(schemas.userCreate), (req, res) => {
  const { username, password, real_name, role, permissions, email } = req.body;
  const db = getDb();
  const existing = db.exec(`SELECT id FROM users WHERE username = ?`, [username]);
  if (existing[0] && existing[0].values.length > 0) return res.status(400).json({ error: '用户名已存在' });
  const id = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run(`INSERT INTO users (id, username, password, real_name, role, permissions, email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, username, hashedPassword, real_name || '', role || 'user', JSON.stringify(permissions || []), email || null]);
  audit(req, 'create', 'users', id, null, { id, username, real_name, role, permissions, email });
  res.json({ id, username, real_name, role, permissions: permissions || [], email });
});

router.put('/:id', authMiddleware, adminMiddleware, validateBody(schemas.userUpdate), (req, res) => {
  const { real_name, role, permissions, status, password, email } = req.body;
  const db = getDb();

  // 防止把唯一的 admin 降级 / 禁用，否则系统会失去管理员
  const editingSelf = req.params.id === req.user.id || req.params.id === 'admin';
  if (editingSelf && (role !== undefined && role !== 'admin' || status === 'disabled')) {
    const others = db.exec(
      `SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND id != ?`,
      [req.params.id]
    );
    const otherActiveAdmins = others[0]?.values[0][0] || 0;
    if (otherActiveAdmins === 0) {
      return res.status(400).json({ error: '不能把唯一的管理员降级或禁用' });
    }
  }

  const before = snapshot('users', req.params.id);
  if (before) delete before.password;
  // email 只在显式传入时更新，没传保持原值
  const emailSql = email !== undefined ? ', email=?' : '';
  const emailVal = email !== undefined ? [email || null] : [];
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run(`UPDATE users SET real_name=?, role=?, permissions=?, status=?, password=?${emailSql}, updated_at=datetime('now','localtime') WHERE id=?`,
      [real_name || '', role || 'user', JSON.stringify(permissions || []), status || 'active', hashedPassword, ...emailVal, req.params.id]);
  } else {
    db.run(`UPDATE users SET real_name=?, role=?, permissions=?, status=?${emailSql}, updated_at=datetime('now','localtime') WHERE id=?`,
      [real_name || '', role || 'user', JSON.stringify(permissions || []), status || 'active', ...emailVal, req.params.id]);
  }
  const after = snapshot('users', req.params.id);
  if (after) delete after.password;
  audit(req, 'update', 'users', req.params.id, before, after);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDb();
  if (req.params.id === 'admin' || req.params.id === req.user.id) return res.status(400).json({ error: '不能删除自己或默认管理员' });
  const before = snapshot('users', req.params.id);
  if (before) delete before.password;
  db.run(`DELETE FROM users WHERE id = ?`, [req.params.id]);
  audit(req, 'delete', 'users', req.params.id, before, null);
  res.json({ success: true });
});

module.exports = router;
