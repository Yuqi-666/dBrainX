# Usage manual

This manual covers the installation, the update, and the removal of dBrain.
For the product functions, see the app.

## Install the desktop app

Download a published release from the GitHub Releases page of the repository.
Drafts and candidate artifacts are for maintainers.
Choose the package for your system and CPU.
Unpack the platform ZIP and check `SHA256SUMS`.
Do not mix installers of different architectures.

| Platform | Package |
| --- | --- |
| Linux x64 | DEB, RPM, or AppImage |
| Windows x64 | EXE or MSI |
| macOS Intel | `darwin-x64` DMG |
| macOS Apple Silicon | `darwin-arm64` DMG |

Replace the file names in these examples with the downloaded files.

```bash
# Linux AppImage
chmod +x dBrain.AppImage
./dBrain.AppImage

# Debian and Ubuntu
sudo apt install ./dBrain.deb

# Fedora and other RPM systems
sudo dnf install ./dBrain.rpm
```

The installer contains the runtime.
You do not install pnpm, Rust, or the other development dependencies.
Linux still needs a WebView, the system libraries, and the media decoders of the distribution.

The candidates have no formal signature or notarization.
Windows can show an unknown publisher or a SmartScreen warning.
macOS can ask for a confirmation in "System Settings → Privacy & Security".
Install only a package from a verified source.
See the [Apple note](https://support.apple.com/en-lamr/102445) and the [Microsoft note](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

The first start creates the local identity and the local data, then shows the workspace.
Wait until the initialization completes.
Do not run more than one instance on the same data directory.

## Install the web version

Open the service address from the maintainer.
Create an account on the registration page and log in.
The PocketBase operator superuser is not an app login account.
The service stores the content and the attachments. The browser keeps no copy.

## Update

An installed desktop app checks the latest published release on each start.
The app downloads a newer signed update for its platform, verifies its signature, installs it, and restarts.
The update does not replace the application data directory.
A failed check keeps the app usable offline.
The first version built with the updater must be installed manually.

A web user needs no action.
The maintainer updates the service.

Make your own backup before a version change.
The app keeps the data, but a backup is the only copy that a failed update cannot damage.

## Uninstall

1. Exit the app completely. Check that the background process stopped.
2. Remove the program. Use the package manager for a DEB or an RPM. Use the Windows uninstaller for an EXE or an MSI. On macOS, move the app to the Trash.
3. Decide about the data. The uninstaller does not remove it.

The data is in the application data directory of the identifier `cn.dbrain.desktop`.
On Linux the path is `$XDG_DATA_HOME/cn.dbrain.desktop`, or `~/.local/share/cn.dbrain.desktop` without that variable.
On Windows and macOS, open the application data folder of the platform.

To remove the data, back it up first, then remove the complete directory by hand.
You cannot undo the removal.
An old version cannot always open a migrated database. Keep the data backup of the old version for a rollback.
