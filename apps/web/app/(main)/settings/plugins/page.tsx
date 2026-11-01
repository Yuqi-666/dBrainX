// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * `/settings/plugins` — the plugin management page (§4.4.3, plan item 50).
 *
 * The page is the transport adapter for `PluginManagementView`: it reads
 * `plugin.list`, `run.list` and `automation.list` for the open workspace and
 * turns one click into one management mutation. It holds no rule of its own —
 * whether the write controls exist is `plugin.list`'s `canManage`, and whether
 * a click succeeds is the gateway's answer, which is why an error is displayed
 * as the server's code instead of being re-derived here.
 *
 * The workspace comes from the workspace store when the visitor arrived
 * through the shell, and from `workspace.listByUser` otherwise: this route can
 * be opened directly, and the shell does not run for it.
 */
import { useMemo, useState, type ReactNode } from "react";

import { trpc } from "@workspace/api-client";
import { useWorkspaceStore } from "@workspace/store";
import {
  PluginManagementView,
  type PluginManagementAction,
  type PluginView,
} from "@workspace/ui/components/plugin-management/plugin-management-view";

const RUN_PAGE_SIZE = 20;

const DECISION_LABEL: { readonly [D in "allowed" | "denied"]: string } = {
  allowed: "允许",
  denied: "拒绝",
};

function errorText(
  error: { readonly message: string } | null,
): string | undefined {
  if (error === null) return undefined;
  const code = /^([A-Z][A-Z0-9_]*):/.exec(error.message)?.[1];
  return code === undefined ? error.message : code;
}

export default function PluginsSettingsPage(): ReactNode {
  const storedWorkspaceId = useWorkspaceStore(
    (state) => state.currentWorkspaceId,
  );
  const setCurrentWorkspaceId = useWorkspaceStore(
    (state) => state.setCurrentWorkspaceId,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );

  const workspaces = trpc.workspace.listByUser.useQuery({});
  const workspaceId =
    selectedWorkspaceId ?? storedWorkspaceId ?? workspaces.data?.[0]?.id ?? "";

  const utils = trpc.useUtils();
  const enabled = workspaceId !== "";

  const plugins = trpc.plugin.list.useQuery({ workspaceId }, { enabled });
  const runs = trpc.run.list.useQuery(
    { workspaceId, limit: RUN_PAGE_SIZE },
    { enabled },
  );
  const automations = trpc.automation.list.useQuery(
    { workspaceId },
    { enabled },
  );

  const refresh = async (): Promise<void> => {
    await Promise.all([
      utils.plugin.list.invalidate(),
      utils.run.list.invalidate(),
      utils.automation.list.invalidate(),
    ]);
  };

  const grant = trpc.plugin.grant.useMutation({ onSuccess: refresh });
  const revoke = trpc.plugin.revoke.useMutation({ onSuccess: refresh });
  const enable = trpc.plugin.enable.useMutation({ onSuccess: refresh });
  const disable = trpc.plugin.disable.useMutation({ onSuccess: refresh });
  const install = trpc.plugin.install.useMutation({ onSuccess: refresh });

  const busy =
    grant.isPending ||
    revoke.isPending ||
    enable.isPending ||
    disable.isPending ||
    install.isPending;

  const mutationError =
    grant.error ??
    revoke.error ??
    enable.error ??
    disable.error ??
    install.error;

  const pluginViews: readonly PluginView[] = useMemo(
    () =>
      (plugins.data?.plugins ?? []).map((plugin) => ({
        pluginId: plugin.pluginId,
        name: plugin.name,
        version: plugin.version,
        status: plugin.status,
        ...(plugin.publisher === undefined
          ? {}
          : { publisher: plugin.publisher }),
        nodeTypes: plugin.nodeTypes,
        requested: plugin.requested,
        grants: plugin.grants,
      })),
    [plugins.data],
  );

  const onAction = (action: PluginManagementAction): void => {
    const base = { workspaceId, pluginId: action.pluginId };
    switch (action.kind) {
      case "install":
        install.mutate({ workspaceId, pluginId: action.pluginId });
        return;
      case "enable":
        enable.mutate(base);
        return;
      case "disable":
        disable.mutate(base);
        return;
      case "grant":
        grant.mutate({
          ...base,
          capability: action.capability,
          scope: [...action.scope],
        });
        return;
      case "revoke":
        revoke.mutate({
          ...base,
          capability: action.capability,
          scope: [...action.scope],
        });
        return;
    }
  };

  return (
    <div className="min-h-dvh bg-background px-6 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">插件</h1>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">工作空间</span>
            <select
              value={workspaceId}
              onChange={(event) => {
                setSelectedWorkspaceId(event.target.value);
                setCurrentWorkspaceId(event.target.value as never);
              }}
              className="rounded-md border border-border bg-background px-2 py-1"
            >
              {(workspaces.data ?? []).map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {enabled ? null : (
          <p className="text-sm text-muted-foreground">
            还没有可管理的工作空间。
          </p>
        )}

        <PluginManagementView
          plugins={pluginViews}
          available={[...(plugins.data?.available ?? [])]}
          canManage={plugins.data?.canManage ?? false}
          busy={busy}
          error={errorText(mutationError) ?? errorText(plugins.error)}
          onAction={onAction}
        />

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">运行记录</h2>
          <p className="text-sm text-muted-foreground">
            每条记录都显示决策与失败代码；被拒绝的调用只有代码，理由文本不外传。
          </p>
          {runs.data?.runs.length ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">时间</th>
                    <th className="px-3 py-2">操作</th>
                    <th className="px-3 py-2">决策</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">代码</th>
                    <th className="px-3 py-2">发起者</th>
                    <th className="px-3 py-2">目标</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.runs.map((run) => (
                    <tr
                      key={run.id}
                      data-run-id={run.id}
                      className="border-t border-border"
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {run.startedAt}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {run.operationId}
                      </td>
                      <td
                        className="px-3 py-2"
                        data-run-decision={run.decision}
                      >
                        {DECISION_LABEL[run.decision]}
                      </td>
                      <td className="px-3 py-2">{run.status}</td>
                      <td
                        className="px-3 py-2 font-mono text-xs"
                        data-run-code={run.code ?? ""}
                      >
                        {run.code ?? ""}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {run.actorKind}:{run.actorId}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {run.targetType}:{run.targetId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">还没有运行记录。</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">自动化</h2>
          {automations.data?.available === false ? (
            <p className="text-sm text-muted-foreground">
              此版本未装配自动化仓储。
            </p>
          ) : (automations.data?.automations.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">还没有自动化。</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {automations.data?.automations.map((automation) => (
                <li
                  key={automation.id}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{automation.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {automation.enabled ? "已启用" : "已禁用"} · 入口{" "}
                    {automation.entryNodeIds.length}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
