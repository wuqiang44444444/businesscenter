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
  const result = db.exec(`SELECT id, username, real_name, role, permissions, status, created_at FROM users ORDER BY created_at DESC`);
  const users = rowsToObjects(result).map(u => ({ ...u, permissions: JSON.parse(u.permissions || '[]') }));
  res.json(users);
});

router.post('/', authMiddleware, adminMiddleware, validateBody(schemas.userCreate), (req, res) => {
  const { username, password, real_name, role, permissions } = req.body;
  const db = getDb();
  const existing = db.exec(`SELECT id FROM users WHERE username = ?`, [username]);
  if (existing[0] && existing[0].values.length > 0) return res.status(400).json({ error: '用户名已存在' });
  const id = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run(`INSERT INTO users (id, username, password, real_name, role, permissions) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, username, hashedPassword, real_name || '', role || 'user', JSON.stringify(permissions || [])]);
  audit(req, 'create', 'users', id, null, { id, username, real_name, role, permissions });
  res.json({ id, username, real_name, role, permissions: permissions || [] });
});

router.put('/:id', authMiddleware, adminMiddleware, validateBody(schemas.userUpdate), (req, res) => {
  const { real_name, role, permissions, status, password } = req.body;
  const db = getDb();
  const before = snapshot('users', req.params.id);
  if (before) delete before.password;
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run(`UPDATE users SET real_name=?, role=?, permissions=?, status=?, password=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [real_name || '', role || 'user', JSON.stringify(permissions || []), status || 'active', hashedPassword, req.params.id]);
  } else {
    db.run(`UPDATE users SET real_name=?, role=?, permissions=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [real_name || '', role || 'user', JSON.stringify(permissions || []), status || 'active', req.params.id]);
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
