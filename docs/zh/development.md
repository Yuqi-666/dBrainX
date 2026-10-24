# 开发手册

## 环境

| 工具 | 要求 |
| --- | --- |
| Node | 按 `.node-version`，当前为 24.15.0 |
| pnpm | 9.0.0 |
| FFmpeg / FFprobe | 媒体功能需要它们。 |
| Docker Compose | 容器构建与部署需要它。 |
| Rust | 按 `rust-toolchain.toml`。仅桌面版需要。 |

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

| 服务 | 变量 | 默认 | 地址 |
| --- | --- | --- | --- |
| Web | `DBRAINX_WEB_PORT` | 3000 | <http://localhost:3000> |
| Server | `DBRAINX_SERVER_PORT` | 3001 | <http://localhost:3001> |
| PocketBase | `DBRAINX_PB_HTTP` | 127.0.0.1:8090 | <http://127.0.0.1:8090> |
| 网关（仅 `dev:remote`） | `DBRAINX_GATEWAY_PORT` | 8080 | <https://p8080>.<开发域名> |

端口来自根 `.env`。同名的 shell 变量优先。
开发数据写入 `pb/pb_data`。
用 `pnpm --filter <package> <script>` 单独运行某个包。

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
安装包位于 `apps/desktop/src-tauri/target/release/bundle`。
发行目标是 Linux x64、Windows x64 和 macOS x64 / arm64。

## 提交前检查

```bash
pnpm release:check
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm build
pnpm smoke:server
```

`pnpm lint:gate` 会按已保存基线阻止新增诊断。
Server smoke 测试只能使用隔离数据，且先构建再测试。
桌面改动还需运行[桌面说明](../../apps/desktop/AGENTS.md)中的检查。

## 发行

所有者直接提交到 `develop`，或通过仓库内的 `feature/*`、`fix/*` 分支合并。
`develop` 上的版本标签触发候选构建。
所有者用合并提交把 `develop` 晋升到 `main`，并公开生成的发行草稿。
详见 [CI/CD 与版本发布](ci-cd.md)。

请让本手册与 `ci-cd.md` 同 `.github/workflows/ci.yml` 保持一致。

## 维护仓库

更新依赖时同步锁文件。
数据库模式改动必须新增迁移，不得修改已发行迁移。
平台发生变化时，测试原生运行时与备份恢复行为。
