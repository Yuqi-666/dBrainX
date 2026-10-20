# dBrain 文档（中文）

本目录是 [docs](../README.md) 手册的中文版本，面向开发者、部署维护者和使用者。

| 文档 | 内容 |
| --- | --- |
| [开发手册](development.md) | 环境、开发命令、桌面构建、检查与发行 |
| [运维手册](operations.md) | 源码与发行镜像部署、更新、访问配置、备份恢复 |
| [使用手册](usage.md) | 安装、更新与卸载 |
| [CI/CD 流水线](ci-cd.md) | PR 检查、版本、发行候选、发布和仓库策略 |
| [贡献指南](contributing.md) | 提议和检查改动的方法 |

## 文档维护

除章节明确要求其他目录外，命令都在仓库根目录执行。

把 `RUN_ID`、`ATTEMPT`、`SOURCE_COMMIT`、`VERSION` 替换为实际值。变量定义以仓库 `.env.example`、`deploy/.env.example` 和对应脚本为准。

当前 docs 树不保存旧版发布报告和验证日志。请从 Git 历史查询。


不要把凭据、个人数据或完整生产日志提交到文档。
