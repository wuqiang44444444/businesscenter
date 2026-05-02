# 部署与运维手册

> 本文档记录这个项目的架构、部署步骤、日常更新流程、常用运维命令和常见问题。
> 用 admin/admin123 首次登录会强制改密。

---

## 一、架构总览

### 项目结构

```
businesscenter/
├── client/          前端：Vite + React + Antd（构建到 client/dist）
├── server/          后端：Express + better-sqlite3 + JWT cookie
├── shared/schemas/  前后端共用的 zod 数据校验定义
├── package.json     根目录脚本（npm run dev 同时起前后端）
└── docker-compose.yml  备用的容器化部署方式
```

### 部署模式（生产）

```
浏览器 ──http://公网IP──▶ Nodejs 进程（端口 80）
                          │
                          ├─ /api/* → Express 路由（业务逻辑）
                          └─ 其它路径 → 返回 client/dist/index.html（react-router 接管）

数据：server/data.db（SQLite 文件，落盘在服务器磁盘）
```

**关键点**：一个 Node 进程同时服务前端静态文件和后端 API，不需要单独的 nginx。
开发模式下前端走 Vite 5173，后端 3001，由 Vite 代理 /api 到后端。

### 服务器路径约定

- 代码根：`/opt/businesscenter`
- 数据库：`/opt/businesscenter/server/data.db`
- 环境变量：`/opt/businesscenter/server/.env`
- pm2 进程名：`finance-app`

---

## 二、首次部署（已完成的步骤记录）

### Step 1 · 买腾讯云轻量服务器

- 镜像：Ubuntu 22.04
- 配置：1C2G（够用）
- 防火墙开放：22 / 80 / 443
- 拿到公网 IP 和 root 密码

### Step 2 · SSH 登录（Mac）

```bash
ssh root@你的公网IP
# 输密码（不会显示，正常）
```

如果默认是 ubuntu 用户：

```bash
ssh ubuntu@你的公网IP
sudo su -   # 切到 root
```

### Step 3 · 装 Node 22 + pm2

```bash
apt update && apt install -y curl git xz-utils
cd /opt
curl -fSL https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v22.13.0/node-v22.13.0-linux-x64.tar.xz -o node.tar.xz
tar -xf node.tar.xz
mv node-v22.13.0-linux-x64 nodejs
ln -sf /opt/nodejs/bin/node /usr/local/bin/node
ln -sf /opt/nodejs/bin/npm /usr/local/bin/npm
ln -sf /opt/nodejs/bin/npx /usr/local/bin/npx
node -v   # 应输出 v22.13.0

# 切国内 npm 镜像（可选但强烈推荐）
npm config set registry https://registry.npmmirror.com

# 装 pm2
npm install -g pm2
ln -sf /opt/nodejs/bin/pm2 /usr/local/bin/pm2
```

### Step 4 · 拉代码 + 装依赖 + 构建前端

```bash
cd /opt
git clone https://github.com/wuqiang44444444/businesscenter.git
cd businesscenter
npm install
cd server && npm install && cd ..
cd client && npm install && npm run build && cd ..
```

最后一步会输出 `client/dist/index.html`，看到这个就 OK。

### Step 5 · 配置 server 环境变量

```bash
cd /opt/businesscenter/server

# 生成强密钥（复制输出的 64 字符）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 写 .env
nano .env
```

填入（替换 JWT_SECRET 为上面生成的值）：

```
JWT_SECRET=粘贴你生成的64字符随机串
PORT=80
# COOKIE_SECURE=true   ← 等你以后配好 HTTPS 再去掉这行注释
```

`Ctrl+O` 回车 `Ctrl+X` 保存退出。

### Step 6 · pm2 启动 + 开机自启

```bash
pm2 start index.js --name finance-app
pm2 save
pm2 startup
# 把它输出的最后一行 sudo env... 整句复制粘贴执行一遍
```

### Step 7 · 验证

```bash
pm2 status
# finance-app 应该 online

curl http://localhost/api/dashboard
# 应返回 {"error":"未登录"}，说明后端通了
```

浏览器打开 `http://你的IP`，admin/admin123 登录 → 强制改密 → 完成。

---

## 三、日常更新（改了代码后怎么部署）

### 本地（Mac/Windows）改代码后

```bash
# 1. 本地改完代码
cd ~/path/to/businesscenter

# 2. 跑一下测试
cd server && npm test && cd ..

# 3. 提交 + 推送
git add .
git commit -m "feat: xxx 功能改进"
git push
```

### 服务器拉新代码 + 重启

```bash
ssh root@你的IP
cd /opt/businesscenter

# 拉代码
git pull

# 如果改了 client/ 下的代码 → 重新构建前端
cd client && npm run build && cd ..

# 如果 server/package.json 增加了依赖 → 重装
cd server && npm install && cd ..

# 重启服务
pm2 restart finance-app
```

### 一键脚本（可选，懒人版）

可以在服务器上建个 `/opt/businesscenter/deploy.sh`：

```bash
#!/bin/bash
set -e
cd /opt/businesscenter
git pull
cd client && npm install && npm run build && cd ..
cd server && npm install && cd ..
pm2 restart finance-app
echo "✅ 部署完成"
```

赋予执行权限：`chmod +x /opt/businesscenter/deploy.sh`，
之后每次更新只要 `bash /opt/businesscenter/deploy.sh`。

---

## 四、常用运维命令

### pm2 进程管理

```bash
pm2 status              # 看所有进程状态
pm2 logs finance-app    # 看实时日志（Ctrl+C 退出）
pm2 logs finance-app --lines 200   # 看最近 200 行
pm2 restart finance-app # 重启
pm2 stop finance-app    # 停止（不会重启）
pm2 delete finance-app  # 删掉这个进程定义（小心，重新加要 pm2 start）
pm2 monit               # 实时 CPU/内存监控
```

### 数据库相关

```bash
# 看数据库大小
ls -lh /opt/businesscenter/server/data.db*

# 备份数据库（建议定期做）
cp /opt/businesscenter/server/data.db /opt/backup/data-$(date +%Y%m%d).db

# 恢复备份
pm2 stop finance-app
cp /opt/backup/data-20260501.db /opt/businesscenter/server/data.db
pm2 restart finance-app
```

### 重置 admin 密码（忘了密码或锁定时）

```bash
cd /opt/businesscenter/server
node -e "const Database=require('better-sqlite3');const bcrypt=require('bcryptjs');const db=new Database('./data.db');db.prepare('UPDATE users SET password=?, must_change_password=1 WHERE username=?').run(bcrypt.hashSync('admin123',10),'admin');console.log('admin reset');"
pm2 restart finance-app
```

之后浏览器无痕模式打开，用 admin/admin123 登。

### 服务器资源

```bash
df -h          # 磁盘使用率
free -h        # 内存使用
top            # CPU/内存进程列表（q 退出）
ss -tlnp       # 看哪些端口在监听
```

---

## 五、常见问题排查

### 问题 1：改密后登不进去（密码错误）

**原因**：cookie 加了 `Secure` 标志但访问的是 HTTP。
**修法**：
```bash
nano /opt/businesscenter/server/.env
# 删掉 COOKIE_SECURE=true 这一行（或把它注释掉）
pm2 restart finance-app
```
然后浏览器**无痕模式**重新登录。

### 问题 2：浏览器打开 IP 显示 502 / 拒绝连接

**原因**：server 没起来 / 没监听 80 端口。
**排查**：
```bash
pm2 status                # finance-app 状态是不是 online
pm2 logs finance-app      # 看启动报错
ss -tlnp | grep :80       # 80 端口有没有 node 在监听
```

### 问题 3：80 端口被占用，pm2 启动失败

**原因**：其它服务（比如 nginx）占用了 80。
**修法**：
```bash
ss -tlnp | grep :80   # 看是谁占的
# 如果是 nginx：
systemctl stop nginx && systemctl disable nginx
pm2 restart finance-app
```

### 问题 4：git pull 报 conflict

**原因**：服务器上有人手动改过文件。
**修法**：
```bash
cd /opt/businesscenter
git stash             # 把本地改动暂存
git pull
git stash pop         # 如果还需要本地改动，恢复（可能再次冲突）
```
通常服务器上不该手动改代码，所有改动从本地走 git。

### 问题 5：pm2 restart 后数据库被锁

**原因**：极小概率 better-sqlite3 没 release WAL。
**修法**：
```bash
pm2 stop finance-app
ls /opt/businesscenter/server/data.db*  # 看 -wal 和 -shm 文件
# 等几秒再启
pm2 start finance-app
```

### 问题 6：磁盘空间快满

**原因**：pm2 日志、npm 缓存、git 缓存堆积。
**修法**：
```bash
pm2 flush                                  # 清空所有 pm2 日志
npm cache clean --force                    # 清 npm 缓存
journalctl --vacuum-time=7d                # 清系统日志保留 7 天
```

---

## 六、加 HTTPS（未来扩展，需要域名）

### 准备
- 一个域名（备案了的）
- 域名 DNS A 记录指向你的服务器 IP

### 步骤

```bash
# 装 nginx + certbot
apt install -y nginx certbot python3-certbot-nginx

# 修改 server .env，把端口改成 3001（让 nginx 占 80/443）
nano /opt/businesscenter/server/.env
# PORT=3001

pm2 restart finance-app

# 配置 nginx
cat > /etc/nginx/sites-available/finance <<'EOF'
server {
    listen 80;
    server_name 你的域名.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -s /etc/nginx/sites-available/finance /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# 申请证书 + 自动配置 HTTPS
certbot --nginx -d 你的域名.com

# 启用 cookie secure
nano /opt/businesscenter/server/.env
# 加一行：COOKIE_SECURE=true
pm2 restart finance-app
```

之后访问 `https://你的域名.com` 即可，cookie 自动安全。证书 90 天自动续期。

---

## 七、备份建议

数据库就一个文件 `server/data.db`，关键。建议：

### 定期备份到本地

Mac 终端定时拉服务器的 db：

```bash
# 每天 03:00 拉一次（在 Mac 上 crontab -e）
0 3 * * * scp root@你的IP:/opt/businesscenter/server/data.db ~/backup/finance-$(date +\%Y\%m\%d).db
```

### 服务器内自动备份

```bash
# crontab -e（root 下）加：
0 4 * * * cp /opt/businesscenter/server/data.db /opt/backup/data-$(date +\%Y\%m\%d).db && find /opt/backup -name "data-*.db" -mtime +30 -delete
```

每天 04:00 备份，保留 30 天，自动清旧的。先 `mkdir -p /opt/backup`。

---

## 八、相关文档

- [README.md](README.md) — 项目介绍 + 本地开发
- [IMPROVEMENTS.md](IMPROVEMENTS.md) — 13 项关键改进的设计与状态
- [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md) — Docker 部署方案（备用）
