# Business Center · 财务管理系统

一个轻量级企业财务管理系统：客户、项目、合同、付款计划、应收应付、发票、供应商、用户权限、审计日志。

## 技术栈

- **前端**：Vite + React 19 + Ant Design 6 + react-router 7 + TypeScript
- **后端**：Express 5 + better-sqlite3 + JWT (httpOnly cookie) + zod
- **共享**：[shared/schemas/](shared/schemas/) 前后端共用 zod schema

## 快速开始

```bash
# 1. 安装依赖
npm install
cd server && npm install
cd ../client && npm install
cd ..

# 2. 配置后端环境变量
cp server/.env.example server/.env
# 编辑 server/.env，把 JWT_SECRET 换成至少 32 字符的随机字符串
# 生成命令：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. 同时启动前后端
npm run dev
# 或分别启：
#   npm run dev:server   # 后端 → http://localhost:3001
#   npm run dev:client   # 前端 → http://localhost:5173
```

访问 http://localhost:5173 ，默认账号 `admin` / `admin123`，**首次登录会强制要求修改密码**。

## 项目结构

```
.
├── client/                 # Vite + React 前端
│   ├── src/
│   │   ├── pages/          # 各模块页面（合同/发票/客户/...）
│   │   ├── components/     # MainLayout 等共享组件
│   │   ├── contexts/       # AuthContext
│   │   └── utils/          # request.ts (axios) / validate.ts (zod)
├── server/                 # Express 后端
│   ├── routes/             # 按域拆分的路由
│   ├── middleware/auth.js  # JWT 鉴权中间件
│   ├── lib/                # helpers / validate
│   ├── schemas/            # 加载 shared/schemas
│   ├── database.js         # better-sqlite3 + 迁移
│   ├── app.js              # Express 应用组装
│   └── index.js            # 启动入口
├── shared/schemas/         # 前后端共用 zod schemas
├── docker-compose.yml      # nginx + server + client(nginx) 三容器
└── IMPROVEMENTS.md         # 13 项改进的设计文档与状态
```

## 关键设计

- **金额全程整数分**：DB 存"分"避免浮点漂移，API/前端用"元"，handler 在边界 ÷100/×100 转换
- **外键 ON DELETE CASCADE/RESTRICT**：删父记录自动级联子记录，孤儿数据由 SQLite 兜底
- **JWT 走 httpOnly cookie**：前端 JS 拿不到 token，避免 XSS 偷取
- **审计日志**：所有 CUD 操作落 `audit_log` 表（who/when/before/after/IP）
- **登录限频**：5 分钟内同 IP 最多 20 次（生产可降到 5-10）
- **首次默认密码强制改密**：`admin/admin123` 首次登录跳转 `/change-password`
- **多步写事务包裹**：合同+付款计划、付款+重算 paid_amount 等

详见 [IMPROVEMENTS.md](IMPROVEMENTS.md)。

## 测试

```bash
cd server
npm test                 # jest + supertest，17 个用例覆盖全模块
```

## 部署（Docker）

```bash
# 配置好 .env 后
docker-compose up -d
```

服务：nginx 80 → frontend 80 + server 3001。详见 [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md)。

## 许可

私有项目。
