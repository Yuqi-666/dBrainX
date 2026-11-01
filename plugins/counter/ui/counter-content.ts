// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counter fixture's editor and preview components.
 *
 * Plain `.ts` with `createElement` rather than JSX, like the builtin plugin's
 * descriptors: `node --test` runs the plugin's type-stripping tests without a
 * JSX transform, and these components are imported by one of them.
 *
 * The editor is read-only because a client-side write needs
 * `operation.invoke` (`counter.increment`), which the client wiring adds in a
 * later plan todo; until then it shows the same value the preview does instead
 * of pretending a button would work.
 */

import { createElement } from "react";
import type { ComponentType } from "react";
import type { NodeContentViewProps } from "@workspace/plugin-sdk/ui";

export function readCounterValue(node: NodeContentViewProps["node"]): number {
  const content = node.content as { value?: unknown } | undefined;
  return typeof content?.value === "number" ? content.value : 0;
}

export const CounterPreview: ComponentType<NodeContentViewProps> = ({
  node,
  className,
}) =>
  createElement(
    "div",
    {
      className,
      "data-counter-value": String(readCounterValue(node)),
    },
    `#${readCounterValue(node)}`,
  );

export const CounterEditor: ComponentType<NodeContentViewProps> = ({
  node,
  className,
}) => {
  const value = readCounterValue(node);
  return createElement(
    "div",
    { className, "data-counter-value": String(value) },
    createElement("span", { className: "text-3xl font-semibold" }, String(value)),
    createElement(
      "span",
      { className: "ml-2 text-sm opacity-60" },
      "counter",
    ),
  );
};
