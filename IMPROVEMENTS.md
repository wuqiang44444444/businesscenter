# 财务管理系统改进清单

基于 2026-05-01 代码审查整理。13 项问题按优先级排序，每项含问题描述、影响、修法。

> 状态图例：☐ 未开始 / ◐ 进行中 / ☑ 已完成

---

## P0 — 财务系统硬伤

### ☑ 1. 外键写了但没启用，已经在产生孤儿数据
**现状**：`server/database.js` 9 处 `FOREIGN KEY` 声明都是装饰品。sql.js 默认 `foreign_keys=OFF`，没有 `PRAGMA foreign_keys = ON`。
**影响**：`server/index.js:326-327` 删合同时只手动清了 `payment_plans`，忘了清 `invoices` → 孤儿发票。其他级联场景同样无保障。
**修法**：`initDatabase` 里 `db.run('PRAGMA foreign_keys = ON')`；schema 里 FK 改为 `ON DELETE CASCADE` 或 `ON DELETE RESTRICT`；删除 handler 里手动 cascade 的代码删掉。

### ☑ 2. 金额用浮点 + paid_amount 反范式化
**现状**：`server/index.js:646` `Math.round(amount / count * 100) / 100` 切付款计划，12 期 100 元 → 99.96，少 4 分钱。`accounts_payable.paid_amount` 反范式存，每次付款写两处，无事务，可漂。
**影响**：财务系统对账不平。
**修法**：金额统一改用整数（分）；`paid_amount` 不再存，需要时 `SUM(payable_payments.amount)`。涉及 schema 迁移 + 全量 CRUD + 前端 InputNumber + 已有数据 ×100。**侵入性大，单独拉分支做。**

### ☑ 3. JWT_SECRET 默认值是随机字符串
**现状**：`server/index.js:9` `JWT_SECRET || 'enterprise-secret-key-2026-' + Math.random()`。
**影响**：env 没配时每次重启所有用户被踢下线，且看似工作其实是配错的。
**修法**：缺 env 时 `process.exit(1)`，启动失败胜过静默错配。

### ☑ 4. /api/login 无频控 + 默认账号 admin/admin123
**现状**：登录无任何节流，[server/database.js:201](server/database.js#L201) 默认账号写死。
**影响**：暴力破解。
**修法**：加 `express-rate-limit`（5 次/分钟/IP）；首次登录强制改密（标记 `must_change_password`）。

---

## P1 — 引擎选错

### ☑ 5. sql.js 替换为 better-sqlite3
**现状**：sql.js 是给浏览器/WASM 用的，服务端用导致每次 mutation 全量 `writeFileSync` 整个 DB 文件，不支持事务，比 better-sqlite3 慢 50-100x。
**修法**：换 `better-sqlite3`，重写 `database.js`，业务代码 API 几乎一致（`db.prepare(...).run/get/all`）。**Windows 安装需要构建工具，可能失败，做时观察。**

### ☑ 6. 多步写加事务
**现状**：合同+付款计划批量、应付+付款+更新 paid_amount 等多步写没有事务包裹。
**依赖**：#5 完成后才有原生事务支持。
**修法**：`db.transaction(() => { ... })()` 包住关键多步写。

---

## P2 — 工程化债

### ☑ 7. 880 行 monolith index.js 拆 routes/
**现状**：所有路由挤一个文件。
**修法**：按域拆 `routes/customers.js`、`routes/contracts.js` 等；`requireFields` 提到 `lib/validate.js`；中间件提到 `middleware/`。

### ☑ 8. 零测试，落 smoke test 进 CI
**现状**：项目没有任何测试。
**修法**：把临时的 `test_finance_app.ps1` 改造成 jest+supertest，覆盖每个模块的 happy path 和已识别的边界。CI 暂无，先做能本地一键跑的版本。

### ☑ 9. 删除空壳 nextjs-app/
**现状**：[nextjs-app/](nextjs-app/) 是未完成的迁移占位，3 个目录都是空文件夹。
**影响**：每个新维护者首次都要被它误导。
**修法**：直接删。如果以后真要迁移，新建分支重做。

### ☑ 10. 前后端类型不共享
**现状**：前端 axios 调用的 payload 字段全靠看后端代码记。
**修法**：单一来源 [shared/schemas/index.mjs](shared/schemas/index.mjs)（ESM 工厂函数 `buildSchemas(z)`）；server 用 dynamic import 在启动时构建并缓存到 [server/schemas/index.js](server/schemas/index.js)，client 用 Vite alias `@shared` 直接 import。
**关键决策**：
- 文件用 ESM 而不是 CJS：避免 Vite dev 模式不转 CJS 的坑
- 工厂函数模式：避免在 shared 文件里 `import 'zod'` 引发的解析路径分歧
- server CJS 主程序里 `(async () => { await initSchemas(); require('./app'); ... })()`，确保 routes 加载时 schemas 已就绪
- jest 用 `--experimental-vm-modules` 开 dynamic import
**前端用法示例**：[client/src/utils/validate.ts](client/src/utils/validate.ts) 提供 `validate(schemaName, data)`，[Login.tsx](client/src/pages/Login.tsx) 和 [ChangePassword.tsx](client/src/pages/ChangePassword.tsx) 已用上。

---

## P3 — 半成品 / 安全细节

### ☑ 11. 导入导出按钮能点但实际不工作
**现状**：[client/src/components/ImportExportModal.tsx](client/src/components/ImportExportModal.tsx) 调 `/customers/export` 等路由，**服务端不存在这些路由**，客户端也没装 xlsx。
**修法**：先把按钮隐藏（避免用户误以为能用）；后续要么前端 xlsx + 服务端解析，要么直接用 SheetJS 客户端处理，立项再做。

### ☑ 12. JWT 存 localStorage（XSS 风险）
**现状**：见 `client/src/utils/request.ts` 和 AuthContext。
**修法**：改 httpOnly cookie + SameSite=Strict + CSRF token。前端去掉 `Authorization` header，后端登录改为 `Set-Cookie`。

---

## P4 — 产品层

### ☑ 13. 加审计日志表
**现状**：财务系统没有"谁改了什么"。
**修法**：建 `audit_log(id, user_id, action, table_name, record_id, before_json, after_json, created_at)`；所有 PUT/DELETE 写一行；前端给 admin 看一个查询页面。

---

## 修复顺序

按"代价/收益"打分排：

1. #3 JWT_SECRET fail-fast —— 5 分钟
2. #1 外键启用 + 级联 —— 30 分钟
3. #4 登录频控 —— 30 分钟
4. #9 删空壳 nextjs-app —— 1 分钟
5. #11 隐藏导入导出按钮 —— 10 分钟
6. #5 替换 better-sqlite3 —— 半天，依赖 native build
7. #6 加事务 —— 1 小时（依赖 #5）
8. #13 审计日志 —— 半天
9. #7 拆 routes —— 半天
10. #10 zod 共享 schema —— 半天
11. #8 jest 测试 —— 1 天
12. #12 cookie 改造 —— 1 天
13. #2 金额改整数分 —— 2 天，最大动静
