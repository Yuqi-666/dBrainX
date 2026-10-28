// SPDX-License-Identifier: AGPL-3.0-only

export * from "./ai-unavailable-notice";
export * from "./ai-menu-hooks";
export * from "./ai-menu-types";
export * from "./ai-menu-utils";

// The generation panel — `./ai-menu` (container) with `./ai-menu-input`,
// `./ai-menu-actions`, `./ai-menu-items` — is retained in this directory but
// deliberately neither exported nor referenced: the editor mounts
// `AiUnavailableNotice` instead, because AI has no backend in this release. A
// future backend wires the panel back in and mounts it here. See `lib/ai.ts`.
