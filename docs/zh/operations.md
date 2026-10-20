# 运维手册

本手册只介绍 Web 部署的部署、更新与备份。
一套部署包含四个服务：PocketBase、Node Server、Web 和 Gateway。只有 Gateway 发布宿主机端口。

## 从源码部署

在仓库根目录配置并启动：

```bash
cp .env.example .env
# 填写 DBRAIN_ADMIN_EMAIL 与 DBRAIN_ADMIN_PASSWORD
# 后续命令保持一致使用同一个私有 Compose project 名
docker compose -p dbrain config --quiet
docker compose -p dbrain up --build --wait
```

该构建使用当前源码，不是已发布的发行镜像。
打开 `http://localhost:3000`，检查页面、用户登录和文件功能。

## 部署已发布版本

从对应 Release 下载 `dbrain-deploy-vVERSION.tar.gz` 和 `SHA256SUMS`。
核对归档的哈希后，把归档解压到部署目录。
归档中的文件应保持同级。
在该目录执行命令。

```bash
cp .env.example .env
# 填写管理员邮箱与密码
# 私有 GHCR 镜像先登录：docker login ghcr.io
docker compose -p dbrain -f docker-compose.yml -f compose.release.yml config --quiet
docker compose -p dbrain -f docker-compose.yml -f compose.release.yml pull
docker compose -p dbrain -f docker-compose.yml -f compose.release.yml up --no-build --wait
```

后续 Compose 命令使用同一个 digest 覆盖层：`compose.release.yml`，更新后使用 `compose.current.yml`。
部署目录和 project 名保持稳定。
改动会误建新卷。
内部候选完成部署验证后才能承载重要数据。

## 更新

在同一个部署目录保留 `docker-compose.yml`、`nginx.conf`、`update.sh` 和 `.env`。
若 GHCR 包是私有的，先登录 `ghcr.io`。

```bash
sh update.sh candidate-RUN_ID-ATTEMPT
sh update.sh vVERSION
```

脚本拉取镜像并解析 digest。它把完整的 PocketBase 数据卷复制到 `backups/`，并写入 `compose.current.yml`。然后它启动服务并等待所有服务健康。
启动失败时，服务保持停止，脚本输出备份位置。
启动旧镜像前先恢复匹配的数据库备份。旧镜像本身不能撤销迁移。

### 自动更新候选

在部署目录的 `.env` 中设置 `DBRAIN_AUTO_UPDATE=true`，然后在该目录启动更新容器。

```bash
docker compose -f compose.updater.yml up -d --build
docker compose -f compose.updater.yml logs -f updater
```

更新容器每 15 秒检查一次最新的成功候选，发现新候选时调用 `update.sh`。
更新失败时自动尝试暂停，并写入 `.auto-update-failed`。检查服务、必要时恢复备份，然后删除该标记。
设置 `DBRAIN_GITHUB_TOKEN` 可提高 GitHub API 上限。
更新容器需要 Docker 套接字和部署目录的写权限。只在可信主机上使用。

## 端口与外部访问

在部署 `.env` 中设置 Gateway 的宿主机地址，然后再次运行 up。restart 不应用新的端口映射。

```dotenv
DBRAIN_BIND_HOST=127.0.0.1
DBRAIN_PORT=18080
```

3001 和 8090 是容器内部端口，不要公开它们。
对外流量由 TLS 反向代理承接。转发到 Gateway，保留原始 Host 头，支持 WebSocket，并按实际附件大小设置上传限制。
只有代理改写 Host 头时才设置 `DBRAIN_PUBLIC_ORIGIN`，使用精确的浏览器 Origin，不加尾斜杠。
不要把 PocketBase 管理接口发布到公网。临时管理访问使用 SSH 隧道，操作后删除端口映射。

## 配置

| 变量 | 用途 |
| --- | --- |
| `DBRAIN_ADMIN_EMAIL` | 必填。运维管理员邮箱。 |
| `DBRAIN_ADMIN_PASSWORD` | 管理员密码。不要提交到 Git。 |
| `DBRAIN_ADMIN_PASSWORD_FILE` | 密码文件优先。容器需要挂载该文件。 |
| `DBRAIN_BIND_HOST` | Gateway 宿主机监听地址。默认 `127.0.0.1`。 |
| `DBRAIN_PORT` | Gateway 宿主机端口。默认 `3000`。 |
| `DBRAIN_PUBLIC_ORIGIN` | 通常留空。前置代理改写 Host 头时设为精确的浏览器 Origin。 |
| `DBRAIN_AUTO_UPDATE` | `true` 启用独立更新容器。默认为 `false`。 |
| `DBRAIN_GITHUB_TOKEN` | 可选，供更新容器使用的 token。它提高 GitHub API 上限。 |
| `DBRAIN_MEDIA_COOKIE_SECRET` | 部署必填。加密保存的媒体站点登录信息。保持不变。换值会使它们不可读。 |

完整变量列表见 `.env.example` 与 `deploy/.env.example`。
存储上限变量使用内置默认值。
使用密码文件时，添加 Compose override，只把该文件只读挂载到 PocketBase 服务。

## 检查服务

```bash
docker compose -p dbrain ps
docker compose -p dbrain logs --tail=100 pocketbase server web gateway
curl -fsS http://127.0.0.1:3000/health
```

由 `update.sh` 管理的部署，给这些命令加上 `-f docker-compose.yml -f compose.current.yml`。
健康接口只说明服务可达。还要检查登录、工作空间、附件和媒体。
日志可能包含业务信息。分享日志前删除隐私数据。

## 备份与恢复

先停止写入，再停止整组服务。在停止状态备份完整的 `pb_data` 卷。该卷保存数据库和附件。

```bash
docker compose -p dbrain stop
backup_dir="backups/pb-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pb_container=$(docker compose -p dbrain ps -aq pocketbase)
test -n "$pb_container"
docker cp "$pb_container:/pb_data/." "$backup_dir/"
# 检查副本、数据库和附件。另存部署配置，然后启动服务。
docker compose -p dbrain start
```

备份时一并保留同版本的部署配置、镜像 digest 和密钥配置。
不要把备份放入 Git。把副本转移到访问受限的备份存储。
镜像部署的每条 Compose 命令都要加上 `-f docker-compose.yml` 和相应的 digest 覆盖层。

恢复前检查源卷、目标卷和备份版本。
在停止状态把完整备份恢复到专用目标卷。
不要把旧备份与含较新数据的目录混合。
不要运行 `down -v`。该命令会删除数据卷。

升级流程有六步。

1. 停止写入。
2. 做完整备份。
3. 在隔离副本上测试新版本的迁移和权限。
4. 切换到新发行覆盖层。
5. 启动并检查用户、附件和媒体。
6. 恢复流量。

回滚需要旧数据和旧镜像 digest。
先在一个独立的 project 和卷上做恢复演练，再操作生产数据。
桌面个人数据的备份见[使用手册](usage.md)。
