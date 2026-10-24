# Dashboard

Web route: `/dashboard`. Open it from **Dynamic Island**. The dashboard has its
own left sidebar (title, workspace and page tabs) and right sidebar (the node
component library); both follow the graph sidebar's open/close pattern. The
content header holds the left-sidebar button, the page title and the
right-sidebar button.

1. In the node editor's header, choose **添加到 Dashboard 备选** — the dashboard
   icon in the right-hand button bar.
2. Create a page, then choose **添加组件** or the right-sidebar button to open
   the library and enter layout editing. Drag candidates onto the grid, or use
   the add buttons. On narrow screens the library appears above the content.
3. Choose **编辑布局** to move widgets by their title bars and resize at the bottom-right corner.
   **自动布局** packs widgets while retaining their sizes.
4. **完成布局** hides layout controls and closes the library. Pages initially open
   in browsing mode. Node content remains interactive; **打开节点** in each widget
   opens its node editor. Page navigation lives in the top bar, with rename/delete
   next to the page heading. Switching workspaces resets transient editing state.

Widgets render the live `NodeContentEditor`; content changes use existing node
services. Removing candidates/widgets/pages never deletes nodes. A node may
appear on several pages, once per page. Deleted nodes have removable placeholders.
The canonical layout is twelve columns; mobile stacking never overwrites it.

## Persistence and synchronization

Configuration is personal to the authenticated user and workspace. The complete
chain is `useDashboard` → `DashboardService` → tRPC `dashboard.get/save/onUpdated`
→ application command/query → `Dashboard` aggregate → request-authenticated
PocketBase repository → `dashboard_configs`.

Apply `pb/pb_migrations/1700000000_initial_schema.js` through the normal
PocketBase migration/startup workflow before using the feature. The collection stores pages,
candidates, active page and widget positions/sizes together. Saves append an
immutable revision; the unique `(ownerId, workspaceId, revision)` index prevents
concurrent saves from silently overwriting each other. Revision history is
retained, and workspace/user deletion cascades to these records.

The server verifies workspace ownership/membership, new node references and grid
constraints. Reads and realtime notifications are user/workspace scoped; generic
graph subscriptions never broadcast private Dashboard events. Membership is
rechecked before delivering notifications. Repository calls carry the verified
request token without modifying the shared PocketBase authentication store.

The Zustand store is an optimistic cache. Saves are serialized per scope; failures
roll back unsaved edits, conflicts load the latest server version, and the page
shows an error with **重新加载**. Reconnects refresh server state after pending
saves. Existing `dbrainx-dashboards-v1` browser layouts import on first load when
the server has no saved revision; failed imports preserve the local copy.

## Validation

Backend, services and store typechecks pass. An isolated PocketBase integration
check covered verified JWTs, persistence, owner/member access, personal isolation,
membership revocation, invalid node/grid references, concurrent-save conflicts,
private event delivery, locked record updates/deletes and workspace deletion
cascade. Browser checks cover page creation, adding widgets and refresh recovery.
The UI-wide check is affected by existing editor/LaTeX type errors.
