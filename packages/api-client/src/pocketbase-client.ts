// SPDX-License-Identifier: AGPL-3.0-only

import PocketBase, { BaseAuthStore } from "pocketbase";
import { readAuthSessionToken } from "./auth/session";

export interface PocketbaseClientConfig {
  url: string;
}

let instance: PocketBase | null = null;
class SessionAuthStore extends BaseAuthStore {}

export const createPocketbaseClient = (config: PocketbaseClientConfig): PocketBase => {
  const url = config.url.replace(/\/+$/, "");
  if (!instance || instance.baseUrl !== url) {
    instance?.cancelAllRequests();
    // Credentials belong to this backend/session, never SDK localStorage left
    // by another login or another desktop runtime.
    instance = new PocketBase(url, new SessionAuthStore());
    if (process.env.NEXT_PUBLIC_DBRAIN_PLATFORM !== "desktop") {
      instance.beforeSend = (url, options) => {
        const headers = new Headers(options.headers);
        headers.set("Authorization", readAuthSessionToken() ?? "");
        options.headers = Object.fromEntries(headers.entries());
        return { url, options };
      };
    }
  }
  return instance;
};

export const getPocketbaseClient = (): PocketBase => {
  if (!instance) {
    throw new Error(
      "PocketbaseClient not initialized. Call createPocketbaseClient first.",
    );
  }
  return instance;
};

export const resetPocketbaseClient = (): void => {
  instance?.cancelAllRequests();
  instance = null;
};
