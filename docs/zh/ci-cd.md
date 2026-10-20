# CI/CD 与版本发布

## 控制权与分支

仓库源码公开。开发和发布决策由所有者做出。只有协作者可以推送到本仓库或创建 PR。协作者由所有者决定，目前只有所有者一人。仓库把 PR 创建权限限制为协作者。漏洞按 [SECURITY.md](../../SECURITY.md) 私下报告。依赖更新由所有者选择并提交。Dependabot 版本更新 PR 保持关闭。

`develop` 是日常开发分支。所有者可以直接提交，也可以把仓库内的 `feature/*` 或 `fix/*` 分支合并进来。`develop` ruleset 要求其他有写权限的人开 PR。提交遵循 Conventional Commits。每次推送到 `develop` 或 `main`，以及针对这两个分支的 PR，都会运行 CI。`main` 保存晋升后的发行历史。CI 通过后，用仓库内部 PR 和**合并提交**把 `develop` 晋升到 `main`。squash 或 rebase 会使打标签的提交不再属于 `main` 历史。所有者可以在晋升前给 `develop` 上的提交打发行标签。紧急修复使用 `hotfix/*` 分支，流程见[补丁发行](#补丁发行hotfix)。

首次使用前，先把这些工作流文件合入 `main`，再推送新版本标签。GitHub 从默认分支读取 `workflow_run` 工作流文件。

## 检查

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) 中的 `checks` 作业是唯一的检查流水线。仓库不再保留第二套本地 gate。该作业从锁文件安装依赖，并使用只读令牌。然后它运行 `release:check`、类型检查、lint 基线、发行测试、Web 与 Server 构建、Server smoke 测试和 actionlint。推送 `develop` 或 `main` 本身不会创建发行。

推送前请在本地运行同样的命令。smoke 测试需要已构建的 Server，因此先执行构建。它使用隔离数据库，绝不指向线上服务。

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm build
pnpm smoke:server
bash scripts/release/check-workflows.sh
```

## 版本与候选

使用语义化版本。`fix` 通常增加 PATCH，兼容的 `feat` 增加 MINOR，破坏性改动增加 MAJOR。`0.x` 阶段的破坏性改动也可增加 MINOR，但必须在发行说明中写明。在 `develop` 上运行 `pnpm release:version VERSION`。它会同步 `scripts/release/release.json`、桌面包元数据、Tauri 配置与锁文件、`docker-compose.yml` 以及 `deploy/.env.example`。在 `release.json` 中声明所有目标桌面平台与容器平台。启用要发行的产品。运行 `pnpm release:check` 和相关测试。

版本提交进入 `develop` 后，所有者亲自为该提交创建并推送 `vVERSION`。请使用附注标签。先确认版本高于所有现有版本标签。标签推送启动 `release-candidate.yml`。该工作流检查标签位于 `develop` 历史中。它构建所有声明的容器平台。它还构建干净 runner 上签名密钥齐全的桌面目标。然后它组装 `candidate-RUN_ID-ATTEMPT`。仍可从**标签 ref** 手动启动工作流做指定目标的重试。重试不会自动创建草稿。标签 ruleset 禁止移动标签和删除标签。

标签触发的候选成功后，`release.yml` 通过 `workflow_run` 自动运行。它检查已完成的候选运行、标签、版本、资产、签名和镜像摘要。然后它创建 GitHub Release **草稿**。草稿尚未公开，已有发行不会被覆盖。容器镜像在正式发布前使用摘要引用。

通过仓库内部 PR 以合并提交把 `develop` 晋升到 `main`。标签提交必须仍是 `main` 的祖先。检查草稿并验收产品。产品就绪后，在 `main` 手动运行 `release.yml`，输入候选 run ID、标签以及 `publish=true`。受保护的 `release` 环境把所有者设为审查者，因此由所有者决定何时发布。发布步骤晋升容器标签，并公开草稿。只有标签推送和分支合并不会公开发行。

```bash
pnpm release:version VERSION
pnpm release:check
node scripts/release/assert-next-version.mjs
git add -A && git commit -m "chore(release): vVERSION"
git push origin develop
git tag -a vVERSION -m "dBrain vVERSION"
git push origin vVERSION
# 候选成功后，用合并提交把 develop 合入 main。
gh run list --workflow release-candidate.yml
gh workflow run release.yml --ref main -f candidate_run_id=RUN_ID -f tag=vVERSION -f publish=true
```

## 补丁发行（hotfix）

补丁发行把一处紧急修复叠加在当前 `main` 之上。它是唯一不从 `develop` 出发的流程。它也是唯一在第一次合并**之后**才由所有者打标签的流程。

1. 从最新的 `main` 拉出分支。
2. 做最小的修复。同时也要让它进入 `develop`，否则下次晋升会丢掉它。
3. 用 `pnpm release:version VERSION` 把版本推进一个 PATCH。hotfix 沿用 `main` 的平台声明。不要重新声明平台。
4. 运行上面完整的检查清单。
5. 提交、推送，并同时向 `main` 和 `develop` 开 PR。
6. 打标签**之前**先合并 `develop` 的 PR。`release-candidate.yml` 会拒绝不在 `develop` 历史中的标签。
7. 打标签，然后合并 `main` 的 PR。候选需要标签在 `develop`。正式发布需要标签在 `main`。

```bash
git fetch origin
git checkout -b hotfix/NAME origin/main
# 完成修复后推进版本。
pnpm release:version VERSION
pnpm release:check && pnpm check-types && pnpm lint:gate && pnpm test:release && pnpm build && pnpm smoke:server
git add -A && git commit -m "fix(scope): what changed"
git push --set-upstream origin hotfix/NAME
gh pr create --base develop --head hotfix/NAME --title "fix(scope): what changed" --body "What changed and how it was checked."
gh pr create --base main --head hotfix/NAME --title "fix(scope): what changed" --body "What changed and how it was checked."
# 先合并 develop 的 PR。标签必须位于 develop 历史中。
gh pr merge --merge
node scripts/release/assert-next-version.mjs
git tag -a vVERSION -m "dBrain vVERSION"
git push origin vVERSION
# 候选成功后，合并 main 的 PR 并正式发布。
gh workflow run release.yml --ref main -f candidate_run_id=RUN_ID -f tag=vVERSION -f publish=true
```

可选的部署更新器在启用后关注成功的标签候选。它可能在 `main` 晋升前部署候选。只应在接受此时序的测试主机上启用。

## 仓库策略

`pnpm policy --repo Yuqi-666/dBrain` 打印计划。这些工作流合入 `main` 且 GitHub 上出现 `checks` 后，所有者运行 `pnpm policy --apply --repo Yuqi-666/dBrain`。

脚本执行以下规则。

- 只允许合并提交。
- PR 合并后删除分支。
- 保留长期使用的 `develop` 分支。
- 启用 Issues。
- 保持 Discussions 关闭。
- 把默认 `GITHUB_TOKEN` 权限设为只读。
- 禁止 Actions 批准 PR。
- 把所有者设为 `release` 环境的审查者。
- `develop` ruleset 允许所有者直接推送，要求其他有写权限的人开 PR。它禁止强推和删除。
- `main` ruleset 要求内部 PR、最新 `checks` 和讨论已解决。它禁止强推和删除。
- `v*` 标签 ruleset 禁止重写标签和删除标签。

把签名密钥放在无需审查的 `candidate` 环境，使标签构建能自动启动。`release` 环境只控制正式发布。私下漏洞报告、Dependabot 安全提醒和安全修复保持启用。

若要包含所有桌面目标，在 `candidate` 环境配置 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`WINDOWS_CERTIFICATE`、`WINDOWS_CERTIFICATE_PASSWORD`、`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_API_PRIVATE_KEY`、`APPLE_API_KEY` 和 `APPLE_API_ISSUER` 密钥。某桌面目标缺少所需签名密钥时，构建会跳过该目标，作业摘要会列出它。其他桌面目标和容器构建继续。若没有任何产品可构建，候选会给出明确错误。当前仓库没有签名密钥，因此标签候选目前只有容器。`release.json` 中 `desktopEnabled` 保持 `true`，以便密钥就绪当天声明的目标即可用。

GitHub ruleset 无法对公开仓库表达“仅接受该所有者的 PR”。所有者控制哪些 PR 可以合并，并关闭未经邀请的 PR。旧 ruleset 的要求可能仍然生效。规则会叠加。

## 安全与可复现性

Actions 固定到提交。候选与发布作业分别获得所需写权限。Server smoke 测试使用隔离数据。除非任务要求发行，或所有者直接要求，否则不要启动正式发布或签名构建。部署见[运维手册](operations.md)，桌面检查见[开发手册](development.md)。
