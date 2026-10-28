// SPDX-License-Identifier: AGPL-3.0-only

import { requestToken } from "./request-scope";
import PocketBase, { ClientResponseError } from 'pocketbase';

export interface PocketBaseClientConfig {
  url: string;
}

export class PocketBaseClient {
  private pb: PocketBase;
  private base: string;

  constructor(config: PocketBaseClientConfig) {
    this.base = config.url;
    this.pb = new PocketBase(config.url);
    /**
     * Auto-cancellation stays OFF for the server-side client.
     *
     * The SDK keys in-flight requests by `requestKey` (the repositories pass the
     * entity id, so two updates of the *same* record share it) and aborts the
     * previous request. That is a browser-side convenience for a client that
     * owns the requests; here one instance is shared by every concurrent API
     * request, so it silently turns a legitimate second write into
     * `ClientResponseError: The request was aborted (most likely autocancelled
     * ...)` and loses the first one. `cancelAllRequests()` still works.
     */
    this.pb.autoCancellation(false);
    this.pb.beforeSend = (url, options) => {
      const headers = new Headers(options.headers);
      // Never inherit another login's token from the singleton authStore.
      headers.set("Authorization", requestToken() || headers.get("Authorization") || "");
      options.headers = Object.fromEntries(headers.entries());
      return { url, options };
    };
  }

  get baseUrl(): string {
    return this.base;
  }

  get client(): PocketBase {
    return this.pb;
  }

  get authStore() {
    return this.pb.authStore;
  }

  collection<T = Record<string, unknown>>(name: string) {
    return this.pb.collection<T>(name);
  }

  isClientResponseError(error: unknown): error is ClientResponseError {
    return error instanceof ClientResponseError;
  }

  cancelAllRequests(): void {
    this.pb.cancelAllRequests();
  }

  buildUrl(path: string): string {
    return this.pb.buildUrl(path);
  }
}

let instance: PocketBaseClient | null = null;

export const createPocketBaseClient = (config: PocketBaseClientConfig): PocketBaseClient => {
  if (!instance) {
    instance = new PocketBaseClient(config);
  }
  return instance;
};

export const getPocketBaseClient = (): PocketBaseClient => {
  if (!instance) {
    throw new Error('PocketBaseClient not initialized. Call createPocketBaseClient first.');
  }
  return instance;
};

export const resetPocketBaseClient = (): void => {
  instance = null;
};