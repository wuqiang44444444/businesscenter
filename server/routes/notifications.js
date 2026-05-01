const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { rowsToObjects } = require('../lib/helpers');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(rowsToObjects(getDb().exec(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [req.user.id])));
});

router.put('/:id/read', authMiddleware, (req, res) => {
  getDb().run(`UPDATE notifications SET is_read = '1' WHERE id = ?`, [req.params.id]);
  res.json({ success: true });
});

router.get('/unread-count', authMiddleware, (req, res) => {
  const result = getDb().exec(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = '0'`, [req.user.id]);
  res.json({ count: result[0]?.values[0][0] || 0 });
});

router.put('/read-all', authMiddleware, (req, res) => {
  getDb().run(`UPDATE notifications SET is_read = '1' WHERE user_id = ? AND is_read = '0'`, [req.user.id]);
  res.json({ success: true });
});

module.exports = router;
