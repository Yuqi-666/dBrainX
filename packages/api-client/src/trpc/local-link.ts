// SPDX-License-Identifier: AGPL-3.0-only

import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@workspace/adapter-front";
import { localRequest, LocalProcedureError } from "@workspace/adapter-tauri";

/** Keep the existing typed client/service contract, replacing only the IO boundary. */
export const localLink: TRPCLink<AppRouter> =
  () =>
  ({ op }) =>
    observable((observer) => {
      // Single-window local writes already update the optimistic stores. Cloud
      // subscriptions will be supplied by the sync adapter once an account is linked.
      if (op.type === "subscription") {
        observer.next({ result: { type: "started" } });
        return () => {};
      }
      let active = true;
      void localRequest(op.path, op.input, op.type === "mutation")
        .then((data) => {
          if (!active) return;
          observer.next({ result: { type: "data", data } });
          observer.complete();
        })
        .catch((error) => {
          if (!active) return;
          const clientError =
            error instanceof LocalProcedureError
              ? TRPCClientError.from<AppRouter>({
                  error: {
                    message: error.message,
                    code: -32000,
                    data: {
                      code: error.code,
                      httpStatus: error.code === "CONFLICT" ? 409 : 400,
                      path: op.path,
                    },
                  },
                })
              : TRPCClientError.from<AppRouter>(
                  error instanceof Error ? error : new Error(String(error)),
                );
          observer.error(clientError);
        });
      return () => {
        active = false;
      };
    });
