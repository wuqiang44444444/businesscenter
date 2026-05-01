const express = require('express');
const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { rowsToObjects } = require('../lib/helpers');

const router = express.Router();

router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const table = req.query.table_name || '';
  const userId = req.query.user_id || '';

  let sql = `SELECT * FROM audit_log WHERE 1=1`;
  const params = [];
  if (table) { sql += ` AND table_name = ?`; params.push(table); }
  if (userId) { sql += ` AND user_id = ?`; params.push(userId); }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  res.json(rowsToObjects(db.exec(sql, params)));
});

module.exports = router;
