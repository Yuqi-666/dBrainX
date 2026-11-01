// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counter fixture's browser UI entry (§5.4.11).
 *
 * The generated plugin map (`apps/web/lib/plugin-ui.generated.ts`) imports this
 * module for its namespace and the client bootstrap registers
 * `nodeContentDescriptors` before the first render, so the counter renders from
 * its descriptor alone — no host branch, no `packages/ui` import.
 */

import { createElement, lazy } from "react";
import type { ComponentType } from "react";
import type { NodeContentDescriptor } from "@workspace/plugin-sdk/ui";

import { counterPluginId } from "../plugin-id.ts";
import { CounterEditor, CounterPreview } from "./counter-content.ts";

export { counterPluginId };

const CounterIcon: ComponentType<{ className?: string }> = ({ className }) =>
  createElement("span", { className, "aria-hidden": true }, "#");

export const nodeContentDescriptors: readonly NodeContentDescriptor[] = [
  {
    type: "counter",
    pluginId: counterPluginId,
    label: "Counter",
    icon: CounterIcon,
    editor: lazy(async () => ({ default: CounterEditor })),
    preview: lazy(async () => ({ default: CounterPreview })),
  },
];
