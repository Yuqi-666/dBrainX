// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState, type ReactNode } from "react";
import {
  initializeDesktopBackend,
  getDesktopBackend,
  refreshDesktopSession,
  reconnectTRPCClient,
  TRPCReactProvider,
  useGraphSubscriptions,
} from "@workspace/api-client";

function Subscriptions() {
  useI18n();

  useGraphSubscriptions();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    initializeDesktopBackend(attempt > 0)
      .then(() => {
        if (active) {
          reconnectTRPCClient();
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : translate("本地后端启动失败"),
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const fail = () => {
      if (active) {
        setReady(false);
        setError(
          translate("本地后端连接中断，请重试启动。数据库保存在应用数据目录。"),
        );
      }
    };
    const health = window.setInterval(() => {
      void fetch(`${getDesktopBackend().pocketbase}/health`, {
        signal: AbortSignal.timeout(3000),
      })
        .then((response) => {
          if (!response.ok) fail();
        })
        .catch(fail);
    }, 15_000);
    const refresh = window.setInterval(() => {
      void refreshDesktopSession()
        .then(() => reconnectTRPCClient())
        .catch(fail);
    }, 30 * 60_000);
    return () => {
      active = false;
      clearInterval(health);
      clearInterval(refresh);
    };
  }, [ready]);

  if (!ready)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-8">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              onClick={() => {
                setError(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              {t("重试启动")}
            </button>
          </>
        ) : (
          <p role="status">{t("正在启动本地工作空间…")}</p>
        )}
      </div>
    );
  return (
    <TRPCReactProvider>
      <Subscriptions />
      {children}
    </TRPCReactProvider>
  );
}
