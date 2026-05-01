# Docker 部署指南

## 本地构建测试

```bash
# 构建并启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

访问地址：
- 前端：http://localhost
- 后端：http://localhost:3001

---

## 服务器部署

### 1. 安装 Docker 和 Docker Compose

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# 安装 Docker Compose
sudo apt install docker-compose-plugin -y
```

### 2. 上传代码到服务器

```bash
# 在本地打包（排除 node_modules）
tar -czf codebuddy.tar.gz --exclude='node_modules' --exclude='.git' .

# 上传到服务器
scp codebuddy.tar.gz user@your-server:/var/www/

# 在服务器上解压
cd /var/www
tar -xzf codebuddy.tar.gz -C codebuddy
```

### 3. 启动服务

```bash
cd /var/www/codebuddy
docker-compose up -d
```

### 4. 配置域名和 HTTPS

安装 Nginx 作为反向代理：

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Nginx 配置 `/etc/nginx/sites-available/codebuddy`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

启用 HTTPS：

```bash
sudo ln -s /etc/nginx/sites-available/codebuddy /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.com
```

### 5. 常用命令

```bash
# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f server
docker-compose logs -f client

# 重启服务
docker-compose restart

# 更新代码后重新构建
docker-compose up -d --build

# 进入容器
docker exec -it codebuddy-server sh
```

### 6. 数据备份

```bash
# 备份数据库
docker cp codebuddy-server:/app/data.db ./backup/data.db.$(date +%Y%m%d)

# 恢复数据库
docker cp ./backup/data.db.20250101 codebuddy-server:/app/data.db
```
