// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { ulid } from "ulid";

export interface SourceIdStore {
  sourceId: string;
  getSourceId: () => string;
}

export const useSourceIdStore = create<SourceIdStore>()((set, get) => ({
  sourceId: ulid(),
  getSourceId: () => get().sourceId,
}));
