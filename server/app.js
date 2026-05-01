const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

function createApp() {
  const app = express();
  // 允许带 cookie 的跨域请求（dev 时 client 5174 → api 3001 经 Vite 代理走同源；
  // 直接跨域时仍需 origin 反射 + credentials:true）
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

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
