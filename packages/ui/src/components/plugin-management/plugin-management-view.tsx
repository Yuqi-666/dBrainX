// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The plugin management surface (§4.4.3, plan item 50).
 *
 * Presentation only: it renders the plugins, their requested permissions and
 * the grants a workspace holds, and it emits one `PluginManagementAction` per
 * click. It never decides authority — `canManage` is a server fact
 * (`plugin.list` returns the caller's role), and with it `false` no write
 * control is rendered at all, so a non-owner cannot even see the install,
 * enable or grant entry.
 *
 * Every write control carries `data-plugin-action`, and the grants table is
 * always rendered: a member who may not change anything can still read what the
 * workspace has approved, which is the "普通成员只能查看已启用插件与授权范围"
 * half of the rule.
 */
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { cn } from "@workspace/ui/lib/utils";

export type PluginStatusView =
  | "installed"
  | "enabled"
  | "disabled"
  | "upgrading"
  | "failed";

export interface PluginPermissionView {
  readonly capability: string;
  readonly scope: readonly string[];
  readonly reason?: string;
  /** Whether the workspace holds a grant that covers exactly this request. */
  readonly granted: boolean;
}

export interface PluginGrantView {
  readonly capability: string;
  readonly scope: readonly string[];
  readonly scopeKey: string;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

export interface PluginView {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly status: PluginStatusView;
  readonly publisher?: string;
  readonly nodeTypes: readonly string[];
  readonly requested: readonly PluginPermissionView[];
  readonly grants: readonly PluginGrantView[];
}

export interface PluginPackageView {
  readonly pluginId: string;
  readonly kind: string;
}

export type PluginManagementAction =
  | { readonly kind: "install"; readonly pluginId: string }
  | { readonly kind: "enable"; readonly pluginId: string }
  | { readonly kind: "disable"; readonly pluginId: string }
  | {
      readonly kind: "grant";
      readonly pluginId: string;
      readonly capability: string;
      readonly scope: readonly string[];
    }
  | {
      readonly kind: "revoke";
      readonly pluginId: string;
      readonly capability: string;
      readonly scope: readonly string[];
    };

export interface PluginManagementViewProps {
  readonly plugins: readonly PluginView[];
  readonly available?: readonly PluginPackageView[];
  /** The server's answer to "may this caller administer plugins here". */
  readonly canManage: boolean;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onAction?: (action: PluginManagementAction) => void;
  readonly className?: string;
}

const STATUS_LABEL: { readonly [S in PluginStatusView]: string } = {
  installed: "已安装",
  enabled: "已启用",
  disabled: "已禁用",
  upgrading: "升级中",
  failed: "失败",
};

const STATUS_CLASS: { readonly [S in PluginStatusView]: string } = {
  installed: "bg-muted text-muted-foreground",
  enabled: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  disabled: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  upgrading: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  failed: "bg-destructive/15 text-destructive",
};

function scopeText(scope: readonly string[]): string {
  return scope.length === 0 ? translate("（无）") : scope.join("、");
}

export function PluginManagementView({
  plugins,
  available = [],
  canManage,
  busy = false,
  error,
  onAction,
  className,
}: PluginManagementViewProps) {
  const emit = onAction ?? (() => undefined);

  return (
    <section
      data-plugin-management=""
      data-can-manage={canManage ? "true" : "false"}
      className={cn("flex flex-col gap-6", className)}
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{translate("插件")}</h1>
        <p className="text-sm text-muted-foreground">
          {translate("已安装插件的状态与授权范围。")}
        </p>
      </header>

      {canManage ? null : (
        <p
          data-plugin-readonly=""
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          {translate("只有工作空间所有者可以安装、启用、禁用或授权插件。")}
        </p>
      )}

      {error === undefined ? null : (
        <p
          role="alert"
          data-plugin-error=""
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {canManage && available.length > 0 ? (
        <div
          data-plugin-available=""
          className="flex flex-col gap-2 rounded-lg border border-border p-4"
        >
          <h2 className="text-sm font-medium">{translate("可安装的插件包")}</h2>
          <ul className="flex flex-col gap-2">
            {available.map((entry) => (
              <li
                key={entry.pluginId}
                className="flex items-center justify-between gap-3"
              >
                <span className="font-mono text-xs">{entry.pluginId}</span>
                <button
                  type="button"
                  data-plugin-action="install"
                  data-plugin-package={entry.pluginId}
                  disabled={busy}
                  onClick={() =>
                    emit({ kind: "install", pluginId: entry.pluginId })
                  }
                  className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {translate("安装")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plugins.length === 0 ? (
        <p data-plugin-empty="" className="text-sm text-muted-foreground">
          {translate("还没有安装任何插件。")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {plugins.map((plugin) => (
            <li
              key={plugin.pluginId}
              data-plugin-id={plugin.pluginId}
              className="flex flex-col gap-4 rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">{plugin.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {plugin.pluginId} · v{plugin.version}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    data-plugin-status={plugin.status}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      STATUS_CLASS[plugin.status],
                    )}
                  >
                    {translate(STATUS_LABEL[plugin.status])}
                  </span>
                  {canManage ? (
                    plugin.status === "enabled" ? (
                      <button
                        type="button"
                        data-plugin-action="disable"
                        data-plugin-id={plugin.pluginId}
                        disabled={busy}
                        onClick={() =>
                          emit({ kind: "disable", pluginId: plugin.pluginId })
                        }
                        className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        {translate("禁用")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-plugin-action="enable"
                        data-plugin-id={plugin.pluginId}
                        disabled={busy}
                        onClick={() =>
                          emit({ kind: "enable", pluginId: plugin.pluginId })
                        }
                        className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        {translate("启用")}
                      </button>
                    )
                  ) : null}
                </div>
              </div>

              {plugin.nodeTypes.length === 0 ? null : (
                <p className="text-xs text-muted-foreground">
                  {translate("节点类型")}：
                  <span className="font-mono">
                    {plugin.nodeTypes.join("、")}
                  </span>
                </p>
              )}

              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">
                  {translate("清单申请的权限")}
                </h2>
                <ul data-plugin-permissions="" className="flex flex-col gap-1">
                  {plugin.requested.map((permission) => (
                    <li
                      key={`${permission.capability}:${permission.scope.join(",")}`}
                      data-plugin-permission={permission.capability}
                      data-plugin-granted={
                        permission.granted ? "true" : "false"
                      }
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span className="flex flex-col">
                        <span className="font-mono">
                          {permission.capability}
                        </span>
                        <span className="text-muted-foreground">
                          {scopeText(permission.scope)}
                          {permission.reason === undefined
                            ? null
                            : ` · ${permission.reason}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {permission.granted
                            ? translate("已授权")
                            : translate("未授权")}
                        </span>
                        {canManage ? (
                          <button
                            type="button"
                            data-plugin-action={
                              permission.granted ? "revoke" : "grant"
                            }
                            data-plugin-id={plugin.pluginId}
                            data-plugin-capability={permission.capability}
                            disabled={busy}
                            onClick={() =>
                              emit({
                                kind: permission.granted ? "revoke" : "grant",
                                pluginId: plugin.pluginId,
                                capability: permission.capability,
                                scope: permission.scope,
                              })
                            }
                            className="rounded-md border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
                          >
                            {permission.granted
                              ? translate("撤销")
                              : translate("授权")}
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">
                  {translate("本工作区已授出的权限")}
                </h2>
                {plugin.grants.length === 0 ? (
                  <p
                    data-plugin-grants-empty=""
                    className="text-xs text-muted-foreground"
                  >
                    {translate("尚未授出任何权限。")}
                  </p>
                ) : (
                  <ul data-plugin-grants="" className="flex flex-col gap-1">
                    {plugin.grants.map((grant) => (
                      <li
                        key={`${grant.capability}:${grant.scopeKey}`}
                        data-plugin-grant={grant.capability}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs"
                      >
                        <span className="font-mono">{grant.capability}</span>
                        <span className="text-muted-foreground">
                          {grant.scopeKey}
                        </span>
                        <span className="text-muted-foreground">
                          {grant.grantedBy} · {grant.grantedAt}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
