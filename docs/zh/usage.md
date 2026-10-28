# 使用手册

本手册只介绍 dBrainX 的安装、更新与卸载。
产品功能请在应用内使用。

## 安装桌面版

从仓库的 GitHub Releases 页面下载已发布版本。
草稿和候选产物供维护者使用。
选择系统与 CPU 对应的包。
解压平台 ZIP 后检查 `SHA256SUMS`。
不要混用不同架构的安装器。

| 平台 | 安装包 |
| --- | --- |
| Linux x64 | DEB、RPM 或 AppImage |
| Windows x64 | EXE 或 MSI |
| macOS Intel | `darwin-x64` DMG |
| macOS Apple Silicon | `darwin-arm64` DMG |

以下示例中的文件名应替换为实际下载的文件。

```bash
# Linux AppImage
chmod +x dBrainX.AppImage
./dBrainX.AppImage

# Debian 与 Ubuntu
sudo apt install ./dBrainX.deb

# Fedora 等 RPM 系统
sudo dnf install ./dBrainX.rpm
```

安装包携带运行时。
使用者无需安装 pnpm、Rust 或其他开发依赖。
Linux 仍需满足目标发行版的 WebView、系统库与媒体解码要求。

当前候选没有正式签名与公证。
Windows 可能显示未知发布者或 SmartScreen 提示。
macOS 可能要求在“系统设置 → 隐私与安全性”中确认。
只安装来源已验证的包。
参考 [Apple 说明](https://support.apple.com/en-lamr/102445)和 [Microsoft 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

首次启动创建本地身份和本地数据，然后显示工作空间。
等待初始化完成。
同一数据目录不要同时运行多个实例。

## 安装 Web 版

打开维护者提供的服务地址。
在注册页创建账号并登录。
PocketBase 运维超级管理员不是应用登录账号。
内容和附件保存在该服务端。浏览器不保留副本。

## 更新

已安装的桌面应用每次启动时检查最新已发布版本。
对应平台存在更新的签名版本时，应用会下载、验证、安装并重启。
应用数据目录不会被替换。
检查失败时仍可离线使用。
首个接入更新器的版本需要手动安装。

Web 用户无需操作。
服务由维护者更新。

版本变更前自行备份。
应用会保留数据，但只有备份不会被失败的更新破坏。

## 卸载

1. 完全退出应用。确认后台进程已停止。
2. 移除程序。DEB 或 RPM 用发行版包管理器。EXE 或 MSI 用 Windows 卸载程序。macOS 把应用移到废纸篓。
3. 决定是否移除数据。卸载程序不会移除它。

数据位于 `cn.dbrainx.desktop` 的应用数据目录。
Linux 路径为 `$XDG_DATA_HOME/cn.dbrainx.desktop`，未设置该变量时为 `~/.local/share/cn.dbrainx.desktop`。
Windows 与 macOS 请打开平台提供的应用数据文件夹。

要移除数据，先备份，再手动移除整个目录。
移除后无法恢复。
旧版本不一定能直接打开已迁移的数据库。回滚时使用旧版本的数据备份。
