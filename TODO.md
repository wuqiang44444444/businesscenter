# TODO

> 已完成项见 COMPETITIVE_GAPS.md 的 ✅ 状态。这里只列剩余待做。

## 优先级建议

不指方向时按这个顺序做：**#22 → #20 → #21 → #13 → #14 → #16 → #17**

理由：
- #22 开放 API 价值高、纯后端、可独立测；
- #20 自定义仪表盘是 #18 自定义报表的自然延伸；
- #21 i18n 机械但工作量大，留到产品成熟后做；
- #13 外币动 schema + 所有金额路由，改动面最大；
- #14 SSO 需要外部应用注册回调，本地难调；
- #16/#17 都要接第三方/税局接口，依赖外部资源。

---

## 二档 · 影响"小公司能不能用来替代友商"

### #13 外币支持
- **工时**：~3 天
- **改动面**：schema + 所有金额路由 + 前端所有金额输入/显示
- **关键设计**：
  - 新表 `exchange_rates`（from_currency, to_currency, rate, effective_date）
  - 业务表（contracts/invoices/payment_plans/accounts_payable/payable_payments/reimbursements/bank_accounts）加 `currency TEXT DEFAULT 'CNY'`
  - 金额仍按"分"存储，但跟币种绑定（USD 也存美分）
  - 跨币种报表（应收/应付总览）需要按汇率折算到本位币（CNY）
  - 前端：金额输入旁加币种下拉；显示时按币种符号 + 折算提示
- **难点**：历史数据回填 currency='CNY'；汇率取哪天的（合同日/发票日/付款日？）—— 建议固定按付款日的汇率
- **测试要点**：跨币种合同 + 跨币种付款；汇率缺失时报错或默认 1:1

### #14 SSO（企微 / 钉钉登录）
- **工时**：~1 天（不算外部应用注册时间）
- **依赖**：企业微信 / 钉钉开发者后台注册自建应用，拿 CorpID / AppKey / Secret
- **关键设计**：
  - 路由 `/api/auth/wecom/callback` 和 `/api/auth/dingtalk/callback`
  - 用 OAuth2 authorization_code 流程拿用户身份
  - 第一次登录在 `users` 表里建对应记录（role 默认 user）；以后用手机号 / unionid 做匹配
  - users 表加 `wecom_userid`、`dingtalk_unionid` 字段
- **本地难调**：回调 URL 必须公网可达，要么用 ngrok / cpolar 反向代理出去
- **建议**：等真用上企微 / 钉钉时再做；个人 / 单机用户不需要

---

## 三档 · 锦上添花

### #16 OCR 发票识别
- **工时**：~1 天（接口好的话）
- **依赖**：第三方 OCR API（百度 / 腾讯云 / 阿里云都有发票识别接口，¥0.05-0.1/次）
- **关键设计**：
  - 在发票上传附件时，识别后自动回填发票号 / 金额 / 税额 / 开票日
  - 仅识别失败时让用户手填
- **测试要点**：用真实发票图扫一遍；接口费用上限保护

### #17 电子专票对接
- **工时**：~3 天（强依赖税局接口资质）
- **依赖**：企业要在金税系统拿到电子专票对接资质（不是所有企业都能开）
- **建议**：除非有真实业务需求，否则不要做。本地用户、小微企业基本用不到。

### #20 自定义仪表盘
- **工时**：~半天
- **关键设计**：
  - 新表 `dashboard_layouts`（id, user_id, layout_json）
  - 把现有 Dashboard 的卡片拆成可插拔组件（仪表盘卡片、应收 TOP、月度趋势 等）
  - 用 react-grid-layout 或 antd 自己的 Layout 系统支持拖拽
  - 每个用户存一份布局，加载时 hydrate
- **难点**：组件配置（如 TOP N 的 N 是几）也要存到 layout，否则只能"显示/隐藏"
- **建议**：和 #18 自定义报表的卡片组件复用，可以把自定义报表也当作可拖到仪表盘的卡片
- **没必要做**：除非用户真有多种角色需求差异

### #21 i18n（国际化）
- **工时**：~2 天
- **关键设计**：
  - 装 react-intl（推荐）或 i18next
  - 抽出 `client/src/locales/{zh-CN,en-US}/messages.json`
  - 所有硬编码中文走 `<FormattedMessage id="xxx" />` 或 `intl.formatMessage`
  - 后端错误消息也加 i18n key（前端按 key 翻译）
  - 顶栏加语言切换器（存在 localStorage）
- **工作量主要在抽 key**，机械但量大（估计 200+ 字符串）
- **没必要做**：当前只服务中文用户

### #22 开放 API + Webhook
- **工时**：~2 天
- **关键设计**：
  - 新表 `api_tokens`（id, user_id, name, token_hash, scopes, last_used_at, expires_at）
  - 中间件支持 `Authorization: Bearer <token>` 走 token 路径（bypass JWT）
  - token 可设置 scope（read/write，按资源粒度）
  - 新表 `webhook_subscriptions`（id, owner_id, url, event_types, secret, status）
  - 关键事件（合同创建/审批通过、发票开出、付款完成）异步推 webhook
  - 重试 + 签名（HMAC-SHA256 with secret）
  - 文档化既有 CRUD 端点：Swagger / OpenAPI 自动生成
- **测试要点**：
  - token 撤销立即失效；scope 越界拒绝
  - webhook 重试策略（指数退避，3 次失败后标记 inactive）
- **建议**：先做 API token，webhook 看真实集成需求

---

## 非"功能"类的待办

### 性能 / 工程

- [ ] 接 husky + lint-staged，commit 前自动跑 jest 受影响的测试
- [ ] CI（GitHub Actions）：push 时跑 jest + client build
- [ ] 数据库备份策略：现在每天本地复制，要不要加 S3 / 异地备份
- [ ] 单 chunk warning 还有两个 ~580KB 的（jsx-runtime 和 main index），可进一步拆 vendor

### 文档

- [ ] 把 6 个数据源的字段+权限规则整理成用户文档（自定义报表用户需要）
- [ ] API 文档（先写关键端点的 README，等做 #22 时再用 Swagger 自动化）
- [ ] OPERATIONS.md 已经有部署/运维基础，缺一份"故障排查 checklist"（admin 密码忘了怎么办、DB 损坏怎么从备份恢复、邮件发不出去怎么 debug）

### 体验

- [ ] 移动端响应式做了但**未真实浏览器验证**——用 Chrome devtools iPhone 视角走一遍：Drawer、表格横滑、Modal 在窄屏不溢出
- [ ] 自定义报表 #18 同上未真机验证——重点看：切数据源时过滤器清空、enum 标签显示、in/between 多值输入、CSV 在 Excel 打开中文
- [ ] 图表升级（饼图/堆叠柱图）未真机验证——单分类退化、堆叠对齐
- [ ] 仪表盘卡片在超长数字（> 10 位）下的换行/截断
- [ ] 暗色模式（用户没要求，但 antd 自带 theme.algorithm 几乎免费）

### 安全 / 合规

- [ ] 给所有用户开启二步验证（TOTP），现在只有强制改密
- [ ] 审计日志可导出，但删不掉——长期跑可能爆磁盘，加定期归档（每年压缩成 zip 移走）
- [ ] 数据加密：现在 SQLite 文件明文落盘，敏感字段（如银行卡号）考虑应用层加密
