// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plugin management page's rendering rule (§4.4.3, plan item 50).
 *
 * `canManage` is the server's answer (`plugin.list` returns the caller's role),
 * and the acceptance criterion is that a non-owner sees no write control at
 * all: the case below renders the same plugin for both roles and asserts the
 * owner has `install` / `enable` / `grant` / `revoke` buttons while the viewer
 * has zero `data-plugin-action` elements and one read-only notice.
 *
 * The second half is that the viewer still reads the approved authority: the
 * grants table (capability, `scopeKey`, who granted it) is rendered for both
 * roles, because "普通成员只能查看已启用插件与授权范围".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PluginManagementView,
  type PluginView,
} from "./plugin-management-view.tsx";

const plugin: PluginView = {
  pluginId: "dbrainx.builtin",
  name: "Builtin",
  version: "1.0.0",
  status: "installed",
  nodeTypes: ["text", "pdf"],
  requested: [
    {
      capability: "node.read",
      scope: ["nodeType=text"],
      reason: "读取笔记",
      granted: true,
    },
    { capability: "node.write", scope: ["nodeType=text"], granted: false },
  ],
  grants: [
    {
      capability: "node.read",
      scope: ["nodeType=text"],
      scopeKey: "nodeType=text",
      grantedBy: "user:owner",
      grantedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
};

const available = [{ pluginId: "dbrainx.counter", kind: "trusted" }];

function countActions(html: string): number {
  return html.split("data-plugin-action=").length - 1;
}

test("the owner sees the install, enable, grant and revoke controls", () => {
  const html = renderToStaticMarkup(
    <PluginManagementView plugins={[plugin]} available={available} canManage />,
  );

  assert.match(html, /data-can-manage="true"/);
  assert.doesNotMatch(html, /data-plugin-readonly/);
  assert.match(html, /data-plugin-action="install"/);
  assert.match(html, /data-plugin-action="enable"/);
  assert.match(html, /data-plugin-action="grant"/);
  assert.match(html, /data-plugin-action="revoke"/);
  assert.equal(html.includes('data-plugin-package="dbrainx.counter"'), true);
});

test("a non-owner sees no write control but still sees status and grants", () => {
  const html = renderToStaticMarkup(
    <PluginManagementView
      plugins={[plugin]}
      available={available}
      canManage={false}
    />,
  );

  assert.match(html, /data-can-manage="false"/);
  assert.equal(countActions(html), 0);
  assert.match(html, /data-plugin-readonly=""/);
  assert.match(html, /data-plugin-status="installed"/);
  assert.match(html, /data-plugin-grant="node.read"/);
  assert.match(html, /nodeType=text/);
  assert.match(html, /user:owner/);
  assert.doesNotMatch(html, /data-plugin-available/);
});

test("an enabled plugin offers disable instead of enable", () => {
  const html = renderToStaticMarkup(
    <PluginManagementView
      plugins={[{ ...plugin, status: "enabled" }]}
      canManage
    />,
  );

  assert.match(html, /data-plugin-action="disable"/);
  assert.doesNotMatch(html, /data-plugin-action="enable"/);
});

test("a workspace with no grants says so instead of rendering an empty table", () => {
  const html = renderToStaticMarkup(
    <PluginManagementView
      plugins={[{ ...plugin, grants: [] }]}
      canManage={false}
    />,
  );

  assert.match(html, /data-plugin-grants-empty=""/);
  assert.doesNotMatch(html, /data-plugin-grants=""/);
});
