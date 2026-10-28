# dBrainX Desktop

Tauri 2 + Next.js 静态导出。界面复用 Web，Desktop 在设备上运行现有完整 backend：应用服务、领域模型、tRPC 路由和实时事件均与 Web 共用。

## 本地运行结构

```text
Tauri → Node.js 本地后端 → PocketBase（SQLite 数据库和附件）
界面 → 本地 tRPC WebSocket / 文件网关
PDF → pdfjs-dist + 原生 canvas
视频 → FFmpeg / FFprobe
```

首次启动自动创建本地身份，无需云端账号或网络。数据库、文件、本地身份凭据和后端日志存放在 Tauri `app_local_data_dir()` 返回的应用目录，实际路径由 Tauri 平台接口决定。Linux 通常为 `$XDG_DATA_HOME/cn.dbrainx.desktop`（未配置时 `~/.local/share/cn.dbrainx.desktop`），Windows/macOS 使用对应的系统应用数据目录。程序升级不替换该目录。

Tauri 启动打包的 Node 运行时，等待 PocketBase 完成数据库迁移和身份初始化，再开放界面。退出时关闭 Node/PocketBase；异常退出导致 stdin 关闭时也清理 PocketBase。会话每 30 分钟刷新；后端连接断开时显示错误与重试入口。一个数据目录只允许一个运行实例。

仅绑定 `127.0.0.1`，端口动态分配。界面通过原生 command 取得每次启动生成的会话地址；文件网关与 WebSocket 握手均检查会话密钥和浏览器 Origin，tRPC 仍使用真实 PocketBase 用户令牌。文件网关只开放上传和文件读取，不开放 PocketBase 管理接口。内部 PocketBase 同样只绑定回环地址，并通过 Desktop 专用中间件要求内部密钥，防止绕过网关直接调用数据库。

附件保存到本地磁盘，节点保存相对 `/api/files/...` 路径，重启更换端口与会话密钥后仍可访问。HLS 播放列表经过网关补全当前会话路径，支持视频分段播放和 Range 请求。

开发阶段按要求不迁移旧版 IndexedDB；Desktop 不再调用旧的 `localLink` / `local-engine`。旧适配器保留在仓库但不参与当前 Desktop 运行。完整本地后端不包含云端同步；账号关联、增量同步、离线冲突处理仍是后续工作。

## 发布验收状态

最新修复与验证边界见 [CI/CD 流水线](../../docs/zh/ci-cd.md) 的验收门禁章节。本文件底部的旧安装包验证记录不代表新增 CSP、权限迁移和运行时配置已经完成原生平台验收。

## 开发与打包

构建机需要 Node 22+（建议 24）、pnpm、目标平台 PocketBase、FFmpeg/FFprobe、Rust 和 Tauri 系统依赖。Linux AppImage 媒体框架打包另需 `patchelf`、`gstreamer1.0-tools` 和上述 GStreamer 插件。先安装依赖：

```sh
pnpm install --frozen-lockfile
# 可执行文件必须与构建机的平台/架构一致
export DBRAINX_POCKETBASE_PATH=/path/to/pocketbase
export FFMPEG_PATH=/path/to/ffmpeg
export FFPROBE_PATH=/path/to/ffprobe
pnpm dev:desktop
pnpm build:desktop
```

不指定路径时，PocketBase 取仓库 `pb/pocketbase`（Windows 为 `.exe`），FFmpeg/FFprobe 从 PATH 查找。准备脚本先验证可执行文件，避免把其他架构的二进制装入安装包。后端资源在 `apps/desktop/src-tauri/runtime` 生成且不入库，随安装包分发；用户无需自行安装 Node、PocketBase 或 FFmpeg。桌面包暂不携带 yt-dlp：视频节点的「从视频网站添加」需要系统 PATH 中存在 `yt-dlp`，也可用 `YT_DLP_PATH` 指定其路径。

`pnpm --filter desktop runtime:prepare` 将 backend 打成独立 ESM 文件，并携带 PDF 字体/CMap 和 canvas 原生依赖。Linux 仅携带当前 libc 对应的 canvas 原生包，并收集 Node、FFmpeg、FFprobe、canvas 的共享库到 `runtime/lib`，运行时设置 `LD_LIBRARY_PATH`；glibc 与动态加载器使用目标系统版本。Linux 产物的最低 glibc 要求取决于构建机，跨发行版发布应在最低支持系统构建或采用适当的静态 FFmpeg，并在目标系统实测。RPM 使用 Zstd level 3 压缩。

`pnpm --filter desktop build` 只构建前端；浏览器直接打开前端会提示需要 Tauri 环境。实际本地后端由 Desktop 启动，不能将静态浏览器预览当作原生验证。

## 验证

在服务器或目标构建机运行：

```sh
pnpm --filter desktop typecheck
pnpm --filter server typecheck
pnpm --filter desktop lint
node --experimental-strip-types --test apps/server/src/desktop/security.test.ts
pnpm --filter desktop runtime:prepare
node apps/desktop/scripts/backend-smoke.mjs
# 在后端资源和前端 out 都已生成后验证原生管理器
(cd apps/desktop/src-tauri && cargo test --release --lib)
pnpm build:desktop
```

集成验证将已打包后端复制到仓库外，使用临时数据库，覆盖本地身份、会话/Origin 拒绝、工作空间、视图、语义、标签、全部十种节点、关系、实时事件、Dashboard 冲突、磁盘附件、PDF 封面、FFmpeg 重编码、HLS、退出清理和重启持久化。测试数据在验证结束后删除。

当前设备不执行编译；在 `ssh yuqi` 的 `~/workspace/projects/dBrainX/.scratch/desktop-backend-build-20261010` 验证。Next.js 使用 Webpack、4 GB 堆上限和两个预渲染 worker；Rust 编译使用 `CARGO_BUILD_JOBS=2`。

## 全平台前提

| 平台 | 构建环境与额外条件 |
| --- | --- |
| Linux x86_64 | 当前 yuqi Ubuntu x86_64；WebKitGTK 4.1、GTK 3、OpenSSL、librsvg、C/C++ 工具链；WebKit 媒体播放另需 GStreamer base/good/libav 组件，匹配平台的 PocketBase/FFmpeg/canvas；需要目标发行版安装实测 |
| Linux ARM64 | ARM64 构建机/CI及同架构运行依赖；交叉构建须完整 ARM64 sysroot、WebKitGTK/GTK 库，仅添加 Rust target 不够 |
| Windows x86_64 / ARM64 | Windows runner、Rust MSVC、Visual Studio C++ Build Tools、Windows SDK、WebView2；PocketBase、Node、FFmpeg和 canvas 必须有匹配架构版本；正式分发需签名 |
| macOS Intel / Apple Silicon | 对应架构 macOS runner、Xcode Command Line Tools；建议静态 FFmpeg，动态版须打包 dylib 并调整加载路径；所有运行时与原生插件需签名/公证；通用包需合并两套运行时，当前脚本不生成 universal 包 |

打包脚本按当前平台生成资源，不把 Linux 资源用于 Windows/macOS。尚未配置跨平台 CI、签名、公证和自动更新；各平台必须完成原生窗口、安装和卸载验证。

Linux 媒体播放使用 WebKit/GStreamer（后端转码仍使用内置 FFmpeg）。Ubuntu 可安装 `gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav`；其他发行版需对应的 H.264/AAC 解码组件。DEB/RPM 使用系统 WebView 媒体组件；AppImage 已开启 `bundleMediaFramework` 携带媒体框架。签名和各目标系统的媒体播放实测仍需在正式发布前完成。

Tauri 原生桥接与资源路径参考 [调用 Rust](https://v2.tauri.app/develop/calling-rust/) 和 [应用资源](https://v2.tauri.app/develop/resources/)。

## 当前验证结果（2026-10-10）

在 yuqi Ubuntu x86_64 完成最终前端导出、Desktop lint、Desktop/server 类型检查、3 项网关测试、原生管理器生命周期测试和打包后端集成验证。集成验证覆盖十种节点、实时事件、Dashboard 冲突、附件/PDF/视频及重启。

已生成 DEB、RPM、AppImage。三种包均在独立应用数据目录和 Xvfb 虚拟桌面中启动，验证前端通过原生桥接初始化本地身份/工作空间、后端事件实时显示新节点、父进程退出后后台清理。RPM 摘要检查通过。服务器已安装上述 GStreamer 播放前提，AppImage 携带媒体插件；Xvfb/WebKit 下仍出现外部插件扫描器告警，实际音视频播放暂未验收。音视频在各发行版/平台的实际播放、真实安装/卸载、签名和公证仍需目标环境验证。

本机产物与服务器 SHA256 一致，保存在 `.scratch/desktop-full-backend-artifacts`，其中包含安装包、校验值、验证报告和原生窗口截图。Windows/macOS/ARM64 尚未构建，前提见上表。云端同步仍未实现。
