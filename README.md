# dBrainX

dBrainX 是一个知识工作空间：用节点记录内容，用关系连接知识，用图谱和 Dashboard 组织工作。Web 端连接自托管服务，桌面端在设备上运行完整本地后端，支持离线使用。

当前源码版本见 [`release.json`](scripts/release/release.json)。项目以 AGPL-3.0-only 许可证开源，仍处于早期开发阶段。Linux 容器支持 amd64 / arm64；桌面发行平台以版本声明为准。

## 能做什么

- 在工作空间中管理文本、富文本、图片、PDF、音视频、网页、网站、集合和数据库节点。
- 用关系、语义和标签组织知识，在图谱中浏览和编辑。
- 在 Dashboard 和数据视图中整理内容。
- 桌面版携带 Node、PocketBase 和媒体处理运行时，用户无需安装开发工具。

桌面本地数据与 Web 服务端数据分别保存，当前没有云端同步。桌面更新取决于已发布的签名发行资产。

## 文档

| 我想做什么 | 阅读入口 |
| --- | --- |
| 安装、升级与卸载 | [使用手册](docs/zh/usage.md) |
| 配置开发环境、运行和检查代码 | [开发手册](docs/zh/development.md) |
| 部署容器、更新、备份和恢复 | [运维手册](docs/zh/operations.md) |
| 了解 CI/CD、四端构建、签名和发布门禁 | [CI/CD 流水线](docs/zh/ci-cd.md) |
| 报告问题或安全漏洞 | [贡献指南](docs/zh/contributing.md)、[安全策略](SECURITY.md) |

完整索引见 [docs](docs/README.md)（英文）与 [docs/zh](docs/zh/README.md)（中文）。项目由所有者独立开发，仅协作者可提交与创建 PR。版本标签触发可用平台的候选构建和发行草稿；正式发布由所有者手动确认。

## 开发快速开始

准备 `.node-version` 指定的 Node 与 pnpm 9.0.0，并确保开发机有 FFmpeg / FFprobe。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# 编辑 .env，填写 DBRAINX_ADMIN_EMAIL 和 DBRAINX_ADMIN_PASSWORD
pnpm dev
```

首次运行 `pnpm dev` 会自动下载固定版本的 PocketBase 和当前版本的 yt-dlp（后者缓存于 `.cache/yt-dlp/`）；也可以用 `YT_DLP_PATH` 指定已安装的 yt-dlp。打开 `http://localhost:3000`。端口在 `.env` 里配；远程域名开发用 `pnpm dev:remote`，见 [docs/zh/development.md](docs/zh/development.md)。运维管理员账号与应用用户账号用途不同：应用用户通过注册页创建，管理员用于 PocketBase 管理。

桌面开发还需要 Rust 和对应平台原生依赖，然后运行 `pnpm dev:desktop`。详细前提见开发手册。

## 技术结构

Web 使用 Next.js / React，桌面使用 Tauri 2；两端共享界面、领域模型和应用服务。后端使用 Node 与 PocketBase，附件和数据库存放于服务端数据卷或桌面应用数据目录。

```text
apps/web、apps/desktop → packages（界面、状态、客户端）
                      → apps/server → backend → PocketBase
```

## 授权

本项目采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0-only）。修改后的版本通过网络向用户提供服务时，必须向这些用户提供对应源码。仓库内源码文件均带 `SPDX-License-Identifier: AGPL-3.0-only` 头，生成文件除外。第三方组件遵循各自许可证，其声明及所需源码材料应随发行提供。
