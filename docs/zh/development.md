# 开发手册

## 环境

| 工具             | 要求                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| Node             | 按 `.node-version`，当前为 24.21.0                                         |
| pnpm             | 9.0.0                                                                      |
| FFmpeg / FFprobe | 媒体功能需要它们。                                                         |
| C++ 工具链       | pnpm 从源码构建 `node-pty` 或 koffi 时需要 `python3`、`make` 和 C++ 编译器 |
| Docker Compose   | 容器构建与部署需要它。                                                     |
| Rust             | 按 `rust-toolchain.toml`。仅桌面版需要。                                   |

Node 24.21.0 是刻意选择的版本。MXC 沙箱 SDK 需要 Node 24 或更高，它在 Windows 上的原生 stdio 路径需要 24.21.0。Dockerfile 的 Node 版本与 `.node-version` 不一致时，`pnpm release:check` 会失败。

```bash
pnpm install --frozen-lockfile
```

不要把 `node_modules`、构建产物、运行时资源、真实 `.env` 或本地数据库提交到仓库。

## 启动开发栈

```bash
cp .env.example .env
# 填写 DBRAINX_ADMIN_EMAIL 与 DBRAINX_ADMIN_PASSWORD
pnpm dev
```

`pnpm dev` 在本机启动 PocketBase、Web 和 Server。
首次运行会把 PocketBase 下载到 `pb/`，把 yt-dlp 下载到 `.cache/yt-dlp/`。
`pnpm dev:remote` 额外启动网关，供公网域名访问。

| 服务                    | 变量                   | 默认           | 地址                       |
| ----------------------- | ---------------------- | -------------- | -------------------------- |
| Web                     | `DBRAINX_WEB_PORT`     | 3000           | <http://localhost:3000>    |
| Server                  | `DBRAINX_SERVER_PORT`  | 3001           | <http://localhost:3001>    |
| PocketBase              | `DBRAINX_PB_HTTP`      | 127.0.0.1:8090 | <http://127.0.0.1:8090>    |
| 网关（仅 `dev:remote`） | `DBRAINX_GATEWAY_PORT` | 8080           | <https://p8080>.<开发域名> |

端口来自根 `.env`。同名的 shell 变量优先。
开发数据写入 `pb/pb_data`。
用 `pnpm --filter <package> <script>` 单独运行某个包。

## 包

执行引擎新增了五个工作区包。节点类型和操作归属声明它们的插件包，不放进 `backend/domain` 或 `packages/interfaces`。

| 包                    | 内容                                                  |
| --------------------- | ----------------------------------------------------- |
| `backend/plugin-host` | 清单门禁、信任检查、依赖闭包、贡献快照、worker 桥。   |
| `backend/sandbox`     | MXC 执行、路径与配额策略、沙箱生命周期。              |
| `packages/plugin-sdk` | 插件编译所依据的契约：清单、节点类型、操作、UI 入口。 |
| `plugins/builtin`     | 随应用发布的内置节点类型与操作。                      |
| `plugins/counter`     | 已签名的测试夹具。它使用仅限测试的密钥。              |

生产代码中只有 `apps/server` 导入 `plugins/**`。测试可以直接导入插件包或夹具来验证它。

## 沙箱

`backend/sandbox` 在 MXC 容器里运行插件代码，不在 Server 进程里运行。`@microsoft/mxc-sdk` 不进入 esbuild 打包，随本平台的 native 辅助程序一起发布。主机没有可用后端时不会启动失败：沙箱返回 `SANDBOX_UNAVAILABLE` 并给出具体原因，读取、写入、图和编辑器仍可使用。

```bash
node scripts/sandbox-probe.mjs
pnpm sandbox:real
```

无论有没有后端，探针都以 0 退出。它列出每个后端的一行结果、主机事实，以及本机缺少的每项能力对应的 `codes:` 行。`pnpm sandbox:real` 只运行本机能执行的负例，其余用例按具体原因跳过。跳过不算通过。

沙箱文件位于 `DBRAINX_SANDBOX_ROOT`；该变量为空时位于 `<上传暂存目录>/sandbox-storage`。根目录必须是绝对路径，相对路径会禁用沙箱清理并打印警告。

## 桌面版

```bash
pnpm dev:desktop
pnpm build:desktop
```

原生构建需要 Rust 和对应平台的运行时。
Ubuntu 可安装工作流中的依赖。

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev librsvg2-dev build-essential patchelf ffmpeg gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav
```

应用从 `pb/pocketbase` 读取 PocketBase，从 PATH 查找 FFmpeg 和 FFprobe。
可以用 `DBRAINX_POCKETBASE_PATH`、`FFMPEG_PATH`、`FFPROBE_PATH` 指定其他路径。
准备好的运行时包含后端打包、PocketBase hooks、插件清单，以及带本平台 native 辅助程序的 MXC 包。请在目标平台上准备运行时，使辅助程序和运行时哈希与该机器一致。`prepare-runtime.mjs` 在退出前校验每个哈希。
安装包位于 `apps/desktop/src-tauri/target/release/bundle`。
发行目标是 Linux x64、Windows x64 和 macOS x64 / arm64。

## 提交前检查

```bash
pnpm release:check
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm test:ui
pnpm --filter @workspace/services test
pnpm build
pnpm smoke:server
bash scripts/release/check-workflows.sh
```

`pnpm lint:gate` 会按已保存基线阻止新增诊断。
`pnpm test:release` 运行 [`test-manifest.mjs`](../../scripts/release/test-manifest.mjs) 中的显式清单。新增的测试文件既不在 `testFiles` 也不在 `skippableTests` 时，门禁会失败，因此要把它连同运行命令或排除原因加进清单。
`pnpm test:ui` 用 esbuild 编译 JSX 测试文件。服务层测试打包 `packages/services/test`。
Server smoke 测试只能使用隔离数据，且先构建再测试。
桌面改动还需运行[桌面说明](../../apps/desktop/AGENTS.md)中的检查。

## 插件清单

插件清单带有 `checksum` 与 `signature`。
在仓库根目录运行以下命令。

```bash
node scripts/plugin-sign.mjs --test-key plugins/counter
node scripts/plugin-sign.mjs --verify plugins/counter
```

改动插件内任一文件后，重新运行第一条命令。
当文件与校验和不一致、签名无法验证，或缺这两个字段之一时，第二条命令报告 `UNTRUSTED_PLUGIN`。

`plugins/counter` 是测试夹具。
为它签名的仓库密钥仅供测试。
其 id 为 `dbrainx.test-key`，除非测试显式允许测试密钥，加载器会拒绝它。
不要把它加入 `DBRAINX_PLUGIN_TRUSTED_KEYS`。
部署在 `DBRAINX_PLUGIN_TRUSTED_KEYS` 中提供自己的公钥，取值为 JSON 对象：密钥 id 映射到 base64 公钥。
部署的签名私钥不放在本仓库。

## 计划中的插件上下文契约

这份契约只是计划，尚未实现。当前运行代码只提供第二条列出的内容。

- **状态。** 计划中。本节描述的字段目前都不在 `OperationContext` 上，执行器也不会组装它们。
- **今天的数据信封。** [`OperationContext`](../../backend/domain/src/ports/operation-context.ts) 只承载数据信封：`actor`、`effectsActor`、`workspaceId`、`scope`、`target`、`node`、`correlationId`、`runId`、`eventId`。
- **域类型缺少的字段。** `pluginId`，带 `eventId` / `eventType` / `payload` / `sourceNodeId` 的 `event` 对象，宿主端口 `http`、`media`、`notify`、`sandbox`、`secret`，以及节点方法 `readNode`、`writeNode`、`invokeNode`、`createNode`、`deleteNode`、`emit`。
- **能力面目前所在的位置。** 只在 [`worker-context.ts`](../../backend/plugin-host/src/worker-context.ts) 的 `PluginWorkerContext` 上。插件作者写 `OperationRun` 时拿到的是域里的 `OperationContext`，所以要通过 SDK 类型调用这些能力，必须做类型断言。
- **计划目标。** 完整的 §4.4.2 契约，通过 `backend/domain` 发布，并从 `packages/plugin-sdk` 再导出。执行器为进程内 handler 与 worker handler 都组装它。worker 边界保留 `requestId` 请求/应答表：函数与 `ExecutionScope.allows` 永不跨过这条边界，worker 用收到的 scope 数据重建 `allows`。

## 发行

所有者直接提交到 `develop`，或通过仓库内的 `feature/*`、`fix/*` 分支合并。
`develop` 上的版本标签触发候选构建。
所有者用合并提交把 `develop` 晋升到 `main`，并公开生成的发行草稿。
详见 [CI/CD 与版本发布](ci-cd.md)。

请让本手册与 `ci-cd.md` 同 `.github/workflows/ci.yml` 保持一致。

## 数据库迁移

数据库模式改动涉及两个文件。

1. 更新 `pb/pb_migrations_base/0000000001_base_schema.js`，使新数据库以新结构创建。
2. 在 `pb/pb_migrations_changes/` 新增一个编号文件，使已有数据库达到相同结构。

base 脚本只在创建数据库时运行一次，其 sha256 记录在 `.dbrainx-migration-origin`。已安装的数据库只通过变更脚本升级。当前已发行的最高变更是 `0000000014_automation_timestamps.js`，因此下一个变更从 `0015` 开始。

不得修改已发行的变更迁移。PocketBase 按文件名应用迁移，改过的文件要么不再运行，要么与它已经塑造过的数据库不一致。发行新文件前，先在旧数据的副本上测试升级。

## 维护仓库

更新依赖时同步锁文件。
平台发生变化时，测试原生运行时与备份恢复行为。
