# Usage manual

## Desktop or web

| Mode | Account and data |
| --- | --- |
| Desktop | The first start creates a local identity. The core content stays on this device. No cloud account is necessary. |
| Web | You register or log in with the service address. The service stores the content and the attachments. |

Both modes use the same workspace interface. They do not synchronize data automatically. A desktop identity is not a web account. Offline mode does not guarantee that an external website or a network link works without a network.

## Install the desktop app

Download a published release from the repository's GitHub Releases page. Drafts and candidate artifacts are for maintainers. Choose the package for your system and CPU. Unpack the platform ZIP and check the included `SHA256SUMS`. Do not mix installers of different architectures.

| Platform | Install format and steps |
| --- | --- |
| Linux x64 | Install the DEB or the RPM with the package manager of your distribution. Give the AppImage the execute permission, then run it. |
| Windows x64 | Run the EXE or the MSI. Follow the steps of the installer. |
| macOS Intel | Open the `darwin-x64` DMG. Copy the app to Applications. |
| macOS Apple Silicon | Open the `darwin-arm64` DMG. Copy the app to Applications. |

The installers contain Node, PocketBase, and the media runtime. The user does not install pnpm, Rust, or the other development dependencies. Linux still needs a WebView, system libraries, and media decoders for the target distribution. dBrain does not claim support for every Linux distribution.

Replace the file names in these examples with the downloaded files.

```bash
# Linux AppImage
chmod +x dBrain.AppImage
./dBrain.AppImage

# Debian / Ubuntu
sudo apt install ./dBrain.deb

# Fedora and other RPM systems
sudo dnf install ./dBrain.rpm
```

The current internal candidates have no formal signature or notarization. Windows can show an unknown publisher or a SmartScreen warning. macOS can ask for a confirmation in "System Settings → Privacy & Security" with "Open Anyway". Operate only on a package from a verified source. A device management policy can stop the installation. See the [Apple note](https://support.apple.com/en-lamr/102445) and the [Microsoft note](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## First start

The desktop app initializes the local data, the backend, and the identity at the start. Then it shows the workspace. Wait until the initialization completes. Use the retry entry in the interface after a connection error. Do not run more than one instance on the same data directory.

A web user opens the service address from the maintainer. The user creates an app user on the registration page and logs in. The PocketBase operator superuser is not an app login account. If a page loads without an end, contact the deployment maintainer first. The maintainer checks the service and the proxy configuration.

## Workspace and content

1. Select an existing space in the workspace selector, or create a space with the create entry.
2. Select a view in the graph. Right-click the empty canvas to open the add-node menu.
3. Select a node type for the content. Open the editor and write the content or upload an attachment.
4. Change the semantics and the connections with the node and relation menus. Use the view configuration and the filters to control the visible range.
5. Switch to the Dashboard and organize your work with the workspace components and the data views.

The node types are text, rich text, image, PDF, video, audio, web page, website, collection, and database. A relation connects two nodes. A tag and a semantic classify a node. A workspace is the scope of the content. A view is the way that the app shows the content.

The workspace selector is in the graph sidebar and in the left Dashboard sidebar. A workspace that you own shows a ⋯ menu with 编辑. A non-default workspace also shows 删除. Only the owner sees these entries. A user who is not the owner cannot edit or delete a shared workspace.

The browser remembers the last workspace that you opened. The app opens that workspace the next time you open the app. When the workspace no longer exists, the app opens the first workspace instead. The 最近打开 list in the graph sidebar is also stored in the browser, so it stays after a refresh. The list shows only the nodes that still exist in the open workspace.

编辑 changes the name and the icon. The dialog shows the current name and icon. The create entry offers the same icon picker. The app trims the name. The name must have 1 to 50 characters and cannot be blank. The icon picker offers an emoji or a Lucide graphic; a workspace without an icon shows a globe. An edit changes the workspace only. The nodes, the relations, and the views stay.

删除 deletes a non-default workspace. The confirmation shows the name. The delete removes the nodes, the relations, the views, the semantics, the tags, and the Dashboard pages of the workspace. It cannot be undone. Files in the resource library are not deleted. They stay in the library. When you delete the open workspace, the app opens another workspace.

Every user has a default workspace. The app creates it at the first login. The default workspace cannot be deleted. You can rename it and change its icon. Every workspace has a default view. It shows all content. The default view cannot be deleted. You can rename it and pin it. The default names use the interface language. In English they are "Default workspace" and "All". After a rename, the custom name shows.

A web page node stores its page as a file in the resource library. The node keeps the file's address and byte length, as a PDF node keeps its PDF. Choose 文件上传 to upload an HTML file, or 从资源库选择 to reference a web page that is already in the library. The 编辑器 entry starts an empty document; 保存 stores it as a new file. 预览 renders the stored page in a sandboxed frame, and 编辑 reads the source back and saves the change to the stored file. A web page file is capped by the storage policy's web page limit (16 MiB by default). Deleting the resource clears the node's address and returns it to the empty state.

### Import from a media site

A video node's empty area offers 本地上传, 「从视频网站添加」, and 「从资源库选择」. An audio node offers 本地上传, 「从音乐网站添加」, and 「从资源库选择」. Choose the site card and paste the address of a page.

The import runs yt-dlp on the server. The web and container formats include yt-dlp. The desktop installer does not. On the desktop app, put `yt-dlp` in PATH, or set `YT_DLP_PATH` to its path.

| Kind | Listed sites |
| --- | --- |
| Video | B 站, 抖音, 小红书, YouTube, TikTok |
| Audio | 网易云音乐, QQ 音乐, 喜马拉雅 |

The dialog shows one capsule for each listed site. A capsule lights up when the address belongs to its site. An address of another site that yt-dlp supports still imports, but that site has no capsule.

Select 解析 to read the page. The dialog shows the cover, the title, the artist or uploader, the duration, and the available qualities. Select one quality and select 导入.

- The video qualities are 最佳, 2160p, 1440p, 1080p, 720p, and 480p. The dialog shows the estimated size of each quality.
- The audio tiers are 无损, 极高, 较高, and 标准. The dialog shows only the tiers that the site offers.
- A quality that needs a login, or that would exceed the storage limit, is shown greyed out with the reason.

An import takes minutes for a long video or track. The dialog closes at 导入, and the empty area shows the phase and the percentage: 下载, then 保存, then 转码 for a video or 准备 for an audio track. Closing the node editor and opening it again keeps the progress, because the server continues the work. A page reload also recovers the progress from the server.

If the server restarts or the app closes during an import, the job is interrupted. Open the node again and select 继续 to continue from the partial download. The server keeps an interrupted job for 24 hours.

Select 取消 to stop an import. The server stops the download and deletes the partial files. A failed import also deletes the partial files, and the dialog opens again with the address and the reason. Select 导入 again to retry from the start.

An album or a playlist address imports only its first track. This version does not import a batch.

The imported file counts in the storage quota and against the category limit: 2 GiB for a video and 512 MiB for an audio file by default. The node records the original page address as its source (`source: online`, `sourceUrl`).

#### Site login

Some content needs a login: a high video quality, a high audio tier, member content, or age-restricted content. The login area sits inside the import dialog: open it with 站点登录 or select a site capsule. dBrain stores no account password.

- Method A, local backend only: select a browser that is installed on this machine. The server reads the cookies of that browser at download time and stores only the browser name, so the cookies never go stale. A remote deployment does not show this method.
- Method B, web and desktop: select or drop a `cookies.txt` file that a browser extension exported. The login area links to [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc), which writes this file in the browser. One file can contain the cookies of several sites, so a single export can light the capsules of several sites. dBrain keeps only the cookies of the listed sites and discards every other domain before it stores anything.

A capsule shows the login state. A login error turns the capsule to the expired state. Connect the site again in the login area, then select 解析 again. A public page still imports without a login.

#### Subtitles, lyrics, and cover

At each import, dBrain asks the site for one subtitle track or lyric track. It selects the track automatically: the interface language first, then the original language, then English, then the first manual track, then the first automatic track. The track enters the 字幕 tab of the media sidebar. Select a line there to jump to that point. While a video node plays, the current subtitle line is drawn over the picture as white text on a black plate; the subtitle button in the control bar turns it on and off, and hovering that button shows 显示字幕 or 隐藏字幕. A node without an imported track has a greyed-out button and no line to draw. dBrain stores no subtitle file, so the track does not count in the quota. A page without a subtitle imports without one. This version does not switch between languages and does not create a subtitle.

A site thumbnail becomes the cover of the node and of its preview card. The server stores the cover as a derived image of the resource. The library does not list it, and it counts in the quota. A video without a site thumbnail uses a frame of the video. An audio file without a cover shows no cover.

The media sidebar collapses. Select the button beside its tabs to hide the panel and give the picture the full width. A narrow strip beside the player brings it back. 加笔记 or a note tick on the progress bar expands it again, because both put something in the panel.

#### Import errors

| Message or situation | What to do |
| --- | --- |
| The dialog asks for a login, or the import reports a login error | Connect the site with method A or B, then select 解析 again. |
| The import reports a membership error | The site offers this content to a paid account only. Select another quality or another page. |
| The import reports a size or quota error | Select a lower quality, or delete resources in the library. |
| The import reports an unsupported address | Check the address. Use a single video or track page. An album or a playlist imports its first track. |
| The import reports a network error or a timeout | The server deleted the partial files. Select 导入 again. |
| The import reports that the server is busy | The server runs at most two imports for one user and four in total. Wait for one import to finish. |

In the rich-text editor, the first Ctrl+A (Command+A on macOS) selects the current block and the second selects the whole document. Copying writes Markdown to the plain-text clipboard. Nodes without a text form, such as images, stay out of the copied text.

A paste into the rich-text editor is read as Markdown and becomes rich text. A bold run that contains full-width punctuation stays separate from the text after it: `**（Decimal）**和**（Hexadecimal）**` gives two bold runs and a plain 和. A single `~` stays literal. Use `~~text~~` for a strikethrough.

Before you remove content, check whether the menu applies to a node, a relation, or the selected collection. Back up important data first.

The graph and the Dashboard use the data of the same workspace. Database content supports table, kanban, calendar, and chart data views. The available configuration follows the interface entry and the content type. The analysis, the cover, and the transcode of media take time. On a failure, keep the error and the file type for the maintainer.

The Dashboard keeps its chrome in two sidebars. The left sidebar holds the pages and the workspace. The right sidebar holds the component library. Move the pointer to a screen edge to float the matching sidebar. Use the two header buttons to pin a sidebar. The button inside the sidebar pins a floating sidebar and closes a pinned one. The header button is hidden while its sidebar is pinned. To add the open node to the component library, select the dashboard button in the node editor header.

### Attachment upload

The largest single attachment is 2 GiB. The app selects the upload method from the size. The user does not configure it.

- A file of 32 MiB or less uploads in one request.
- A file larger than 32 MiB uploads in 8 MiB chunks. The client sends only the missing chunks. After a network break, a page refresh, or a backend restart, select the same file again. The upload continues from the completed chunks.
- The server assembles the chunks on the local disk and stores the file in the file library. This step can take a long time. The page shows the progress. A page close during this step does not lose the file. The result is visible after the page opens again.
- If you cancel the upload, the chunks stay on the server. Upload the same file again to continue.

The server rejects a file larger than 2 GiB before the upload starts. An image in the editor keeps its own smaller limit (5 MiB). This limit is different from the node attachment limit.

A PDF larger than 256 MiB skips the analysis. The app stores the file only. You can still download and open it, but it has no page count and no cover. A video transcodes as a disk stream. The size does not affect the HLS generation.

The PDF viewer shows the stored cover of the first page immediately, then replaces it with the rendered page. The viewer reads only the parts it needs. It does not download the whole file first, and it locates a page through that page's entry in the document's page tree instead of reading every entry, so a large scan opens quickly even when its pages are stored far apart. The viewer reads the later pages when you scroll to them.

The app remembers the last page for each reader and each node. Reopen the node and the viewer continues from that page. The outline folds by level. Select a parent entry to open or close it. A long title wraps to the next line. The button at the far left of the toolbar opens the left sidebar. Its tabs switch between thumbnails and the outline. The sidebar opens on the outline.

## Resource library and references

Select 资源库 in the island to open the resource library. The page lists the files that you uploaded, in the category of the file: image, video, audio, PDF, web page, or other. The cover and the HLS parts the server derives from a file are not separate entries; they count in the storage panel and disappear with the resource. Search by name and filter by category. The storage panel shows the bytes in use against the total quota as one segmented bar, one color per category, with the byte count of each category in the legend below it. The maintainer sets the quota and the per-file limits (see the Operations and Development manuals). The built-in defaults give one user 10 GiB in total, 32 MiB per image, 16 MiB per web page, 512 MiB per audio file, 512 MiB per PDF, 2 GiB per video, and 256 MiB per other file.

The library can also upload a file, rename its label, copy its address, and delete it. A rename changes the label only; it does not change the stored bytes or the address. Deleting a resource deletes the stored bytes, its derived cover or HLS package, and frees all of that quota. The confirmation lists the nodes that reference the file. After the delete those nodes keep their content but lose the link, and their media area shows its empty state.

Deleting a node does **not** delete its file by default. When the node references an uploaded resource, the delete entry of the node menu and of the editor header asks whether to delete the node only or also the uploaded files that it references. Choose the node only to keep the files in the library; an orphaned file stays there until you delete it. The editor header menu also has 清空节点, which empties the node content and offers the same choice for the files it referenced; a collection node and a database node have no clear action. Check the storage panel when the quota looks full.

To reference a file that is already stored, open the node that accepts a media file and click its add area. Select 「从资源库选择」. Select a file in the dialog; the node stores a reference to that file instead of a copy. A node in a shared workspace can reference a teammate's resource; the selector marks such a file as 共享. The analysis is stored with the resource, so it runs once: the first time a PDF is parsed or a video is packaged, the page count, the cover, the playlist and the duration are saved on the resource, and every node that references it afterwards reuses them without parsing, transcoding or storing anything again. An image or an audio file is measured once the same way; only a resource without a stored measurement is read from the file.

A reference is not a copy. If you delete the resource later, every node that references it loses the link and shows its empty state; the node and its other content stay. Keep a resource that a node still uses.

An Excalidraw block stores its preview and its scene in one file. Every save updates that file in place, so repeated edits do not add a resource, and opening the block restores the scene from that file even when the node no longer holds the inline copy.

In the desktop app the library manages the files of the local workspace. The total quota is the built-in default; there is no deployment operator to change it.

## Data location and backup

The desktop app keeps the database, the attachments, the local identity, and the logs in the system application data directory. Locate it usually by the identifier `cn.dbrain.desktop`. The platform interface and the log give the real directory. On Linux, the common path is `$XDG_DATA_HOME/cn.dbrain.desktop`. Without that variable, the path is `~/.local/share/cn.dbrain.desktop`.

Exit the app completely before a backup. Check that the background process stopped. Copy the **complete application data directory** to a safe location. Do not copy the database file only. Keep the attachments and the local identity too.

Before a restore, keep a copy of the current directory. Then close the app and restore the complete data of the matching version.

The maintainer backs up the data of a web user. A browser cache is not a server backup. dBrain does not promise a general one-step migration between devices. A maintainer must check a migration requirement.

## Upgrade and uninstall

On each start, an installed desktop app checks the latest published release over HTTPS. If a newer signed update exists for its platform, the app downloads it, verifies the updater signature, installs it, and restarts. The app remains usable offline if the check fails. The first version built with this updater must be installed manually.

Tauri currently transfers a complete update bundle. This is a version update, not a byte-level delta patch. An upgrade does not replace the application data directory. The desktop runtime backs up the data before a version migration. It keeps the two newest migration snapshots in the `backups` directory and removes the older ones. That backup does not replace your external backup.

Uninstall and data removal are two different operations. Do not assume that the uninstaller removes the data. To remove the data, exit the app, inspect the application data directory, back it up, and remove it by hand. For a rollback, use the data backup of the old version. An old version cannot always open a migrated database.

## Report a problem

Give the product version, the OS and architecture, the install format, the reproduction steps, the expected result, and the actual result. Attach the error text or a screenshot without private data. For a media problem, state the file format and the operation. For an upgrade problem, state the old version and the backup state. Do not send a password, a local identity credential, or a complete private database.
