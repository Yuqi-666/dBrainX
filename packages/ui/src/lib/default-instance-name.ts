// SPDX-License-Identifier: AGPL-3.0-only

import type { View, Workspace } from "@workspace/interfaces";
import {
  DEFAULT_VIEW_NAME,
  DEFAULT_WORKSPACE_NAME,
} from "@workspace/utils/workspace";

/** The translator returned by `useI18n()`. */
type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * The name to show for a workspace.
 *
 * The server stores the canonical Chinese name on the default workspace, so an
 * English interface would otherwise show 默认工作区. While the workspace is
 * still default and still carries its canonical name, use the translated
 * catalog entry; after a rename the stored custom name wins.
 */
export function workspaceDisplayName(
  workspace: Pick<Workspace, "name" | "isDefault">,
  t: Translate,
): string {
  return workspace.isDefault && workspace.name === DEFAULT_WORKSPACE_NAME
    ? t("默认工作区")
    : workspace.name;
}

/**
 * The name to show for a graph view.
 *
 * Mirrors {@link workspaceDisplayName}: the default global view keeps the
 * canonical name 全部 in storage, and the interface language decides whether it
 * reads 全部 or All. A renamed view shows its stored name.
 */
export function viewDisplayName(
  view: Pick<View, "name" | "isDefault">,
  t: Translate,
): string {
  return view.isDefault && view.name === DEFAULT_VIEW_NAME
    ? t("全部")
    : view.name;
}
