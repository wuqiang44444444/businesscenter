const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  // 优先从 httpOnly cookie 读 token，其次回退到 Authorization 头（兼容脚本/旧客户端）
  const cookieToken = req.cookies?.auth_token;
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, SECRET);
    // 实时校验用户状态：禁用用户的旧 token 不能继续使用
    const row = getDb().exec(`SELECT status FROM users WHERE id = ?`, [req.user.id]);
    if (!row[0] || row[0].values.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    if (row[0].values[0][0] !== 'active') {
      return res.status(401).json({ error: '账号已禁用' });
    }
    next();
  } catch {
    res.status(401).json({ error: 'token无效' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  next();
}

module.exports = { authMiddleware, adminMiddleware, SECRET };
