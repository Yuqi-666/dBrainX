// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * `/settings/engine` — the local engine switch (plan item 65).
 *
 * Turning it off stops the worker from claiming scheduled jobs and event
 * deliveries. The request path is untouched, so reading, writing, the graph and
 * the editor keep working; an operation that needs a sandbox is answered
 * `SANDBOX_UNAVAILABLE`, because the runtime it would call belongs to the
 * engine this switch stopped.
 *
 * The page holds no policy: whether the switch can be used is
 * `run.engineStatus`'s `available`, and a refused click is shown as the
 * server's code.
 */
import type { ReactNode } from "react";

import { trpc } from "@workspace/api-client";

function errorText(error: { readonly message: string } | null): string | undefined {
  if (error === null) return undefined;
  const code = /^([A-Z][A-Z0-9_]*):/.exec(error.message)?.[1];
  return code ?? error.message;
}

export default function EngineSettingsPage(): ReactNode {
  const status = trpc.run.engineStatus.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const setEnabled = trpc.run.setEngineEnabled.useMutation({
    onSuccess: () => {
      void status.refetch();
    },
  });
  const data = status.data;
  const busy = setEnabled.isPending || status.isLoading;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">执行引擎</h1>
        <p className="text-sm text-muted-foreground">
          关闭后不再领取定时任务与事件投递。读写、图谱与编辑器不受影响；
          需要沙箱的操作会返回 SANDBOX_UNAVAILABLE。
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
        <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-muted-foreground">可用</dt>
          <dd>{data === undefined ? "读取中…" : data.available ? "是" : "否（本进程没有 PocketBase 运维凭据）"}</dd>
          <dt className="text-muted-foreground">开关</dt>
          <dd>{data?.enabled === true ? "已启用" : "已关闭"}</dd>
          <dt className="text-muted-foreground">运行中</dt>
          <dd>{data?.running === true ? "正在领取任务" : "未在领取"}</dd>
          <dt className="text-muted-foreground">空转次数</dt>
          <dd>{data?.idleTicks ?? 0}</dd>
          <dt className="text-muted-foreground">在途</dt>
          <dd>{data?.pending ?? 0}</dd>
        </dl>

        <button
          type="button"
          role="switch"
          aria-checked={data?.enabled === true}
          disabled={busy || data?.available !== true}
          onClick={() => setEnabled.mutate({ enabled: data?.enabled !== true })}
          className="w-fit rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          {data?.enabled === true ? "关闭引擎" : "启用引擎"}
        </button>

        {data !== undefined && data.backoffMs.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            空闲退避（毫秒）：{data.backoffMs.join(" → ")}
          </p>
        ) : null}
        {setEnabled.error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(setEnabled.error)}
          </p>
        ) : null}
      </section>
    </div>
  );
}
