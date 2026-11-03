# 运维手册

本手册只介绍 Web 部署的部署、更新与备份。
一套部署包含四个服务：PocketBase、Node Server、Web 和 Gateway。只有 Gateway 发布宿主机端口。

## 从源码部署

在仓库根目录配置并启动：

```bash
cp .env.example .env
# 填写 DBRAINX_ADMIN_EMAIL 与 DBRAINX_ADMIN_PASSWORD
# 后续命令保持一致使用同一个私有 Compose project 名
docker compose -p dbrainx config --quiet
docker compose -p dbrainx up --build --wait
```

该构建使用当前源码，不是已发布的发行镜像。
打开 `http://localhost:3000`，检查页面、用户登录和文件功能。

## 部署已发布版本

从对应 Release 下载 `dbrainx-deploy-vVERSION.tar.gz` 和 `SHA256SUMS`。
核对归档的哈希后，把归档解压到部署目录。
归档中的文件应保持同级。
在该目录执行命令。

```bash
cp .env.example .env
# 填写管理员邮箱与密码
# 私有 GHCR 镜像先登录：docker login ghcr.io
docker compose -p dbrainx -f docker-compose.yml -f compose.release.yml config --quiet
docker compose -p dbrainx -f docker-compose.yml -f compose.release.yml pull
docker compose -p dbrainx -f docker-compose.yml -f compose.release.yml up --no-build --wait
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

在部署目录的 `.env` 中设置 `DBRAINX_AUTO_UPDATE=true`，然后在该目录启动更新容器。

```bash
docker compose -f compose.updater.yml up -d --build
docker compose -f compose.updater.yml logs -f updater
```

更新容器每 15 秒检查一次最新的成功候选，发现新候选时调用 `update.sh`。
更新失败时自动尝试暂停，并写入 `.auto-update-failed`。检查服务、必要时恢复备份，然后删除该标记。
设置 `DBRAINX_GITHUB_TOKEN` 可提高 GitHub API 上限。
更新容器需要 Docker 套接字和部署目录的写权限。只在可信主机上使用。

## 端口与外部访问

在部署 `.env` 中设置 Gateway 的宿主机地址，然后再次运行 up。restart 不应用新的端口映射。

```dotenv
DBRAINX_BIND_HOST=127.0.0.1
DBRAINX_PORT=18080
```

3001 和 8090 是容器内部端口，不要公开它们。
对外流量由 TLS 反向代理承接。转发到 Gateway，保留原始 Host 头，支持 WebSocket，并按实际附件大小设置上传限制。
只有代理改写 Host 头时才设置 `DBRAINX_PUBLIC_ORIGIN`，使用精确的浏览器 Origin，不加尾斜杠。
不要把 PocketBase 管理接口发布到公网。临时管理访问使用 SSH 隧道，操作后删除端口映射。

## 配置

| 变量 | 用途 |
| --- | --- |
| `DBRAINX_ADMIN_EMAIL` | 必填。运维管理员邮箱。 |
| `DBRAINX_ADMIN_PASSWORD` | 管理员密码。不要提交到 Git。 |
| `DBRAINX_ADMIN_PASSWORD_FILE` | 密码文件优先。容器需要挂载该文件。 |
| `DBRAINX_BIND_HOST` | Gateway 宿主机监听地址。默认 `127.0.0.1`。 |
| `DBRAINX_PORT` | Gateway 宿主机端口。默认 `3000`。 |
| `DBRAINX_PUBLIC_ORIGIN` | 通常留空。前置代理改写 Host 头时设为精确的浏览器 Origin。 |
| `DBRAINX_AUTO_UPDATE` | `true` 启用独立更新容器。默认为 `false`。 |
| `DBRAINX_GITHUB_TOKEN` | 可选，供更新容器使用的 token。它提高 GitHub API 上限。 |
| `DBRAINX_MEDIA_COOKIE_SECRET` | 部署必填。加密保存的媒体站点登录信息。保持不变。换值会使它们不可读。 |
| `DBRAINX_SECRET_KEY` | 插件密钥密钥的原始值，插件密钥以 AES-256-GCM 加密保存。没有它就无法构造该加密器，也不存在明文降级路径。请保持不变：换值会使已保存的密文无法读取，直到用新值重新加密。 |
| `DBRAINX_SANDBOX_ROOT` | 沙箱文件的绝对目录。默认是上传暂存目录下的 `sandbox-storage`。相对路径会禁用沙箱清理。 |

Server 进程需要 `DBRAINX_ADMIN_EMAIL` 以及 `DBRAINX_ADMIN_PASSWORD` 或 `DBRAINX_ADMIN_PASSWORD_FILE`，才能组装执行引擎、沙箱清理和插件授权表。
随附的 `docker-compose.yml` 只把这对凭据传给 PocketBase 服务，也没有把 `DBRAINX_ENGINE_*` 设置、`DBRAINX_SECRET_KEY` 或 `DBRAINX_SANDBOX_ROOT` 传给 Server 服务。因此随附容器不会组装它们。部署需要这些功能时，请把同样的变量也传给 Server 服务。

完整变量列表见 `.env.example` 与 `deploy/.env.example`。
存储上限变量使用内置默认值。
使用密码文件时，添加 Compose override，只把该文件只读挂载到 PocketBase 服务。

## 执行引擎

执行引擎认领计划任务与事件投递，运行每个操作处理器，并为每次尝试写入一行 `operation_runs`。它只在拥有 PocketBase 运维凭据的进程中组装。Server 启动时打印一行摘要，使生效策略可见：

```text
[engine] enabled owner=<hostname>:<pid> poll=500ms idle=1000..30000ms drain=30000ms jobs=10/2 deliveries=20/2 lease=30000ms attempts=5 cleanup=3600000ms retention=604800000ms batch=100
```

没有凭据时，这行会变成 `[engine] not composed: ...`，`run.engineStatus` 返回 `available: false`，桌面设置开关保持禁用。读取、写入、图和编辑器不需要引擎。`DBRAINX_ENGINE_ENABLED=0` 启动时不认领任务，本地后端可以在 `/settings/engine` 开关运行中的引擎。

### 引擎设置

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `DBRAINX_ENGINE_ENABLED` | `1` | 启动 worker。本地开关可以在运行时关闭它。 |
| `DBRAINX_ENGINE_WORKER_ID` | `<hostname>:<pid>` | 记录在每次认领与完成上的租约所有者。 |
| `DBRAINX_ENGINE_POLL_MS` | `500` | 认领到工作的 tick 之后的暂停。 |
| `DBRAINX_ENGINE_IDLE_BACKOFF_MS` | `1000` | 未认领到工作的 tick 之后的首次暂停。每次空转翻倍。 |
| `DBRAINX_ENGINE_IDLE_BACKOFF_MAX_MS` | `30000` | 空转暂停的上限。 |
| `DBRAINX_ENGINE_DRAIN_MS` | `30000` | 停机等待在途运行的时间。截止时仍有运行时，进程以 1 退出。 |
| `DBRAINX_ENGINE_CONCURRENCY` | `2` | 一个 tick 同时运行的任务派发数，以及一个 dispatch tick 处理的工区分桶数。启动时读取一次，改动后需重启。 |
| `DBRAINX_ENGINE_LEASE_MS` | `30000` | 投递与任务的租约。 |
| `DBRAINX_ENGINE_CLAIM_LIMIT` | `20` | 一次投递认领可取的记录数。 |
| `DBRAINX_ENGINE_JOB_LIMIT` | `10` | 一个 tick 可认领的任务数。 |
| `DBRAINX_ENGINE_MAX_ATTEMPTS` | `5` | 进入死信前的投递尝试次数。 |
| `DBRAINX_ENGINE_CLEANUP_INTERVAL_MS` | `3600000` | 两次保留期清理之间的暂停。`0` 关闭定时器，仍保留 `engine.cleanup`。 |
| `DBRAINX_ENGINE_EVENT_RETENTION_MS` | `604800000` | 早于该时长的 `done` 事件会被回收。 |
| `DBRAINX_ENGINE_SANDBOX_IDLE_MS` | `604800000` | 空闲超过该时长的 ready 沙箱会过期。 |
| `DBRAINX_ENGINE_CLEANUP_BATCH` | `100` | 每次清理每个阶段最多处理的记录数。 |

非法值会让 Server 在启动时失败。静默地以 1 ms 轮询或 0 ms 排空截止运行的引擎，比拒绝启动更糟。

### 指标

`engine.metrics` 是 tRPC 查询。输入为 `{ workspaceId, windowMs?, scanLimit? }`。工作区成员都可以读取，因为这些数字描述的正是调用者本来就能读的工作区。结果是 `{ available: true, metrics }`；本进程没有组装引擎时是 `{ available: false, reason }`。

| 字段 | 含义 |
| --- | --- |
| `events.pendingCount` | 有 pending 投递的事件数，从队头开始统计。 |
| `events.pendingDeliveryCount` | pending 投递行数。精确计数。 |
| `events.oldestPendingAgeMs` | 最老的待认领事件已等待多久。空队列为 `null`。 |
| `events.deadLetterCount` | 死信中的投递行数。 |
| `events.cascadeDepth.distribution` | 按级联深度统计的运行数，附 `scanned` 与 `truncated`。 |
| `runs.successRate` | `succeeded / (succeeded + failed + dead)`。运行中的行不进分母。 |
| `runs.latencyMs.p50`、`p95` | 最近秩延迟。空样本为 `null`。 |
| `runs.failuresByPlugin`、`failuresByOperation` | 失败计数，按数量降序。 |
| `runs.operationsPerPluginPerMinute` | 每个插件的操作数与每分钟速率。 |
| `deliveries` | `pending`、`processing`、`done`、`failed`、`dead`。 |

`windowMs` 与 `scanLimit` 会被夹紧到服务上限。两个分布是有界扫描，提前停止时设置 `truncated`。这个视图里的数字没有一个来自日志文本。

### 保留期与清理

保留期清理运行在独立定时器上，位于 worker 循环之外，因此大批量不会推迟认领。超过间隔的批次会产生一次跳过的 tick，而不是两次同时处理同样的记录。每次运行打印一行带有自身计数的 JSON：

```text
{"event":"engine.cleanup","ok":true,"startedAt":"...","finishedAt":"...","retentionMs":604800000,"cutoff":"...","candidates":4,"deleted":2,"skipped":2,"deliveriesDeleted":3,"truncated":false,"scopeRowsDeleted":0,"sandboxesExpired":0,"sandboxFilesSoftDeleted":0,"failures":[]}
```

一次运行会回收早于保留期的 `done` 事件，删除自动化已不存在的 `automation_scope` 行，并让空闲超过期限的 ready 沙箱过期。仍有非 `done` 投递引用的事件会被跳过，并点名阻塞状态。它从不删除软删除的节点。失败的阶段记录在 `failures` 中，不会把本次运行报告为干净。

`engine.cleanup` 与 tRPC mutation 是同一服务，输入为 `{ workspaceId }`。它返回 `{ available: true, result }` 或 `{ available: false, reason }`。它只在本地后端可用（`DBRAINX_DESKTOP=1`、`DBRAINX_LOCAL_MODE=1`，或 `NODE_ENV` 不是 `production`），且只允许工作区所有者。共享部署靠定时器做保留期清理，不接受用户请求触发。

## 错误码

客户端按码字符串分支，不看 HTTP 状态。
`operation.invoke` 把码放在 message 前缀里，同时设置 tRPC 码。
`run.replay` 把拒绝作为数据返回：`{ kind: "refused", code, message }`。
沙箱码出现在 `operation_runs.error` 与 `sandbox_calls.errorCode` 中。

### 操作码

| 码 | tRPC 码 | 服务端何时返回 |
| --- | --- | --- |
| `OPERATION_NOT_FOUND` | `NOT_FOUND` | 操作未注册，或不适用于该节点类型。 |
| `TARGET_NOT_FOUND` | `NOT_FOUND` | target 不存在，或在别的工作区。 |
| `FORBIDDEN` | `FORBIDDEN` | 用户角色、节点权限或系统操作拒绝了这次调用。 |
| `CAPABILITY_DENIED` | `FORBIDDEN` | 没有任何 grant 覆盖所需能力。 |
| `OUT_OF_SCOPE` | `FORBIDDEN` | node target 不在本次运行的作用域内。 |
| `RATE_LIMITED` | `TOO_MANY_REQUESTS` | 高风险能力用完了自己的令牌桶。 |
| `TARGET_KIND_UNSUPPORTED` | `NOT_IMPLEMENTED` | 本进程没有 edge 或 view target 的访问策略。 |
| `CAPABILITY_POLICY_UNAVAILABLE` | `PRECONDITION_FAILED` | 本进程没有能力策略来源。 |
| `SCHEMA_INVALID` | `BAD_REQUEST` | 输入不符合操作 schema。 |
| `VERSION_CONFLICT` | `CONFLICT` | `expectedVersion` 不是记录当前版本。 |
| `OPERATION_TIMEOUT` | `TIMEOUT` | handler 没有在超时内结束。 |
| `OPERATION_FAILED` | `INTERNAL_SERVER_ERROR` | handler 抛错。读 `failureCode` 获得稳定原因。 |
| `RUN_CONFLICT` | `CONFLICT` | 幂等键已指向一个本次调用不能继续的 run。 |
| `AUDIT_FAILED` | `INTERNAL_SERVER_ERROR` | 服务端无法写入 run 行，或无法把它移到终态。 |

### 重放拒绝码

| 码 | `run.replay` 何时返回 |
| --- | --- |
| `RUN_NOT_FOUND` | run 不存在，或在别的工作区。 |
| `RUN_ALREADY_SUCCEEDED` | run 已成功。重放会再次施加效果。 |
| `RUN_IN_PROGRESS` | run 仍在运行。 |
| `RUN_TERMINAL` | run 在死信里。该状态是终态。 |
| `OPERATION_NOT_FOUND` | run 的操作已不再注册。 |
| `OPERATION_NOT_IDEMPOTENT` | 操作没有声明 `idempotent: true`。 |
| `REPLAY_UNAVAILABLE` | 本进程没有执行器。 |
| `REPLAY_DENIED` | run 曾被拒绝，或网关拒绝了这次重放。 |

### 沙箱码

| 码 | 何时出现 |
| --- | --- |
| `SANDBOX_UNAVAILABLE` | 没有可用的 MXC 后端，或后端缺少所需策略。 |
| `SANDBOX_POLICY_DENIED` | grant 不覆盖该路径、可执行文件或网络范围。 |
| `SANDBOX_PATH_ESCAPE` | 路径或符号链接越出沙箱 root。 |
| `SANDBOX_PATH_INVALID` | 路径格式非法，或目标不是普通文件。 |
| `SANDBOX_PATH_RESERVED` | 路径段是 Windows 设备名。 |
| `SANDBOX_QUOTA_EXCEEDED` | 文件、字节、进程或输出超过配额。 |
| `SANDBOX_TIMEOUT` | 命令超过超时。 |
| `SANDBOX_EXEC_FAILED` | 命令失败、MXC 没有启动，或结果无法解析。 |
| `SANDBOX_OUTPUT_TRUNCATED` | 输出超过 `maxOutputBytes`，被截断。 |

## 检查服务

```bash
docker compose -p dbrainx ps
docker compose -p dbrainx logs --tail=100 pocketbase server web gateway
curl -fsS http://127.0.0.1:3000/health
```

由 `update.sh` 管理的部署，给这些命令加上 `-f docker-compose.yml -f compose.current.yml`。
健康接口只说明服务可达。还要检查登录、工作空间、附件和媒体。
日志可能包含业务信息。分享日志前删除隐私数据。

## 备份与恢复

先停止写入，再停止整组服务。在停止状态备份完整的 `pb_data` 卷。该卷保存数据库和附件。

```bash
docker compose -p dbrainx stop
backup_dir="backups/pb-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pb_container=$(docker compose -p dbrainx ps -aq pocketbase)
test -n "$pb_container"
docker cp "$pb_container:/pb_data/." "$backup_dir/"
# 检查副本、数据库和附件。另存部署配置，然后启动服务。
docker compose -p dbrainx start
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

## 数据库迁移与回滚

PocketBase 启动时按文件名顺序应用 `pb/pb_migrations_changes/` 中的文件。`pb/pb_migrations_base/` 中的 base 脚本只在创建数据库时运行，因此已有部署只通过变更文件升级。不得修改已发行的变更文件；新的结构使用新的编号。

迁移在 `update.sh` 期间运行：脚本先把完整的 PocketBase 数据卷复制到 `backups/`，再启动新栈。启动失败时服务保持停止，脚本输出备份位置。

旧镜像不能撤销迁移。回滚就是恢复：停止服务，把匹配的数据库备份恢复到数据卷，切回旧镜像 digest，然后启动。有些变更按设计只能单向。`0000000007_webpage_object_storage.js` 把内联页面源码移入 files 集合，降级会把 blob 留在资源库，而不会把它还原为内联内容。

先在一个独立的 project 和卷上做恢复演练，再操作生产数据。
桌面个人数据的备份见[使用手册](usage.md)。
