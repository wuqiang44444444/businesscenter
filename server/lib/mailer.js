// 邮件发送：基于 nodemailer + SMTP。
// SMTP 没配 → 整个模块为 no-op，不会让 server 启动失败。

const nodemailer = require('nodemailer');

let transporter = null;
let configured = false;

function init() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[mailer] 未配置 SMTP env，邮件功能停用');
    return false;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10) || 465,
    secure: (parseInt(SMTP_PORT, 10) || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  configured = true;
  console.log(`[mailer] SMTP 已配置 (${SMTP_HOST})`);
  return true;
}

function isReady() {
  return configured;
}

async function send({ to, subject, html, text }) {
  if (!configured) {
    console.log(`[mailer] (跳过，SMTP 未配置) → ${to} · ${subject}`);
    return { skipped: true };
  }
  if (!to) throw new Error('收件人为空');

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await transporter.sendMail({
    from: `Business <${from}>`,
    to,
    subject,
    text: text || subject,
    html,
  });
  return { sent: true, messageId: info.messageId };
}

module.exports = { init, isReady, send };
