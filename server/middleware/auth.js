const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  // 优先从 httpOnly cookie 读 token，其次回退到 Authorization 头（兼容脚本/旧客户端）
  const cookieToken = req.cookies?.auth_token;
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, SECRET);
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
