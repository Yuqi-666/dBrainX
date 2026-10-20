// SPDX-License-Identifier: AGPL-3.0-only

import {
  emptyState,
  executeLocal,
  type LocalState,
  type PendingChange,
} from "./local-engine";

const DATABASE_NAME = "dbrain-desktop-v1";
let opening: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          opening = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("请关闭其他 Desktop 窗口后重试。"));
    }).catch((error) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

/** Serialize through IndexedDB's read/write lock, including other tabs/windows.
 * Entity changes and their sync outbox are committed in the SAME transaction.
 * Results resolve only after commit; quota/IO errors trigger service rollback.
 */
async function transaction<T>(
  write: boolean,
  apply: (state: LocalState) => T,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction("state", write ? "readwrite" : "readonly");
    const store = tx.objectStore("state");
    const read = store.get("current");
    let result: T;
    let failure: unknown;
    read.onsuccess = () => {
      try {
        const state: LocalState = read.result ?? emptyState();
        if (state.version !== 1)
          throw new Error("Unsupported local database version");
        result = apply(state);
        if (write) store.put(state, "current");
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error("Local transaction aborted"));
  });
}
export function localRequest(
  path: string,
  input: unknown,
  mutation: boolean,
): Promise<unknown> {
  return transaction(mutation, (state) => executeLocal(state, path, input));
}
export function readPendingChanges(): Promise<PendingChange[]> {
  return transaction(false, (state) => state.outbox);
}
/** Acknowledge only after a future sync server has durably accepted these sequence IDs. */
export function acknowledgeChanges(sequences: number[]): Promise<void> {
  const confirmed = new Set(sequences);
  return transaction(true, (state) => {
    state.outbox = state.outbox.filter(
      (change) => !confirmed.has(change.sequence),
    );
  });
}
export function exportLocalSnapshot(): Promise<LocalState> {
  return transaction(false, (state) => state);
}
