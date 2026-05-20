const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

function createApp() {
  const app = express();
  // 允许带 cookie 的跨域请求（dev 时 client 5174 → api 3001 经 Vite 代理走同源；
  // 直接跨域时仍需 origin 反射 + credentials:true）
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

  // ========== API 路由 ==========
  app.use('/api', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/customers', require('./routes/customers'));
  app.use('/api/projects', require('./routes/projects'));
  app.use('/api/contracts', require('./routes/contracts'));
  app.use('/api/payment-plans', require('./routes/payment-plans'));
  app.use('/api/suppliers', require('./routes/suppliers'));
  app.use('/api/accounts-payable', require('./routes/accounts-payable'));
  app.use('/api/payable-payments', require('./routes/payable-payments'));
  app.use('/api/invoices', require('./routes/invoices'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/receivables', require('./routes/receivables'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/audit-log', require('./routes/audit-log'));
  app.use('/api/import-export', require('./routes/import-export'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/attachments', require('./routes/attachments'));
  app.use('/api/print', require('./routes/print'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/bank-accounts', require('./routes/bank-accounts'));
  app.use('/api/reimbursements', require('./routes/reimbursements'));
  app.use('/api/custom-reports', require('./routes/custom-reports'));

  // ========== 生产环境：直接服务构建好的前端 ==========
  // 部署时只需 cd client && npm run build，然后跑这个 server
  // dev 模式下 client/dist 不存在，跳过这块；浏览器还是访问 Vite 5173
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    // SPA 回退：非 /api 的所有路径都返回 index.html，让 react-router 接管
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // ========== 全局错误处理 ==========
  app.use((err, req, res, next) => {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    if (res.headersSent) return next(err);
    const msg = err && err.message ? err.message : String(err);
    const isBindError = /tried to bind a value of an unknown type|SQLite3 can only bind|Too few parameter values|Too many parameter values|wrong number of arguments/i.test(msg);
    res.status(isBindError ? 400 : 500).json({
      error: isBindError ? '请求参数无效' : '服务端错误',
    });
  });

  return app;
}

module.exports = { createApp };
