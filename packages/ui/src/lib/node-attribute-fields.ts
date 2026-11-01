// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The read half of the descriptor-driven attribute panel (§3.5.4.6).
 *
 * The panel used to decide which URL field a node shows with two `switch`
 * statements over `node.nodeType`. It now asks this module, which reads the
 * `attributes` contribution the type's plugin registered. A type nobody
 * registered resolves to no fields and no throw, so the panel degrades to an
 * empty state instead of blanking a page.
 *
 * The write half is deliberately still a stub: every field is a call site with
 * a `TODO(engine: wire in 39)` marker, and no path here merges a whole node.
 */
import type {
  NodeAttributeField,
  NodeAttributesContribution,
} from "@workspace/plugin-sdk/ui";

import { getNodeContentDescriptor } from "../components/node-content/registry.ts";

/** Reserved keys a dotted field path may not descend through. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A descriptor's `attributes` is either a field list or a plugin-authored
 * component. Only the field list is declarative, so anything else (a component,
 * a missing contribution, a malformed one) resolves to no fields.
 */
function asContribution(attributes: unknown): NodeAttributesContribution | undefined {
  if (!attributes || typeof attributes !== "object") return undefined;
  const fields = (attributes as { fields?: unknown }).fields;
  return Array.isArray(fields)
    ? (attributes as NodeAttributesContribution)
    : undefined;
}

/** The fields `attributes` contributes; `[]` when it contributes none. */
export function attributeFieldsOf(
  attributes: unknown,
): readonly NodeAttributeField[] {
  return asContribution(attributes)?.fields ?? [];
}

/** The fields the type's plugin contributes, in declaration order. */
export function resolveAttributeFields(
  type: string,
): readonly NodeAttributeField[] {
  return attributeFieldsOf(getNodeContentDescriptor(type)?.attributes);
}

/** True when a plugin contributed `type`, so an empty field list is expected. */
export function isNodeTypeRegistered(type: string): boolean {
  return getNodeContentDescriptor(type) !== undefined;
}

/** Read a dotted path out of a node's `content` without throwing on a non-object half. */
export function readAttributeValue(content: unknown, field: string): unknown {
  let current: unknown = content;
  for (const segment of field.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * The nested patch for one field, e.g. `filterConfig.collectionType` becomes
 * `{ filterConfig: { collectionType } }`. The panel never builds a `content`
 * object from this render's snapshot; the operation input is the only shape it
 * produces.
 */
export function attributeFieldPatch(
  field: string,
  value: string,
): Record<string, unknown> {
  const segments = field.split(".");
  const root: Record<string, unknown> = {};
  let cursor = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    const next: Record<string, unknown> = {};
    cursor[segment] = next;
    cursor = next;
  });
  return root;
}

/** How many timeline entries a `timeline` field currently holds. */
export function attributeTimelineCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** One metadata edit the panel raises; the operation that writes it is resolved in 39. */
export interface AttributeOperationIntent {
  nodeId: string;
  /** Absent when the catalog has no operation for the field yet. */
  operationId?: string;
  field: string;
  value: string;
}

/** Where a raised intent goes. Todo 39 installs the `NodeService.invoke` adapter. */
export type AttributeOperationSink = (intent: AttributeOperationIntent) => void;

/**
 * TODO(engine: wire in 39): replace the default sink with
 * `NodeService.invoke(operationId, { kind: "node", nodeId }, input)`.
 *
 * Until then the sink is a no-op and the panel keeps the draft locally. That is
 * the point of this step: the panel must not fall back to merging a whole node.
 */
let operationSink: AttributeOperationSink = () => {};

/** Install the sink that receives the panel's metadata edits. */
export function setAttributeOperationSink(next: AttributeOperationSink): void {
  operationSink = next;
}

/** Restore the default no-op sink. */
export function resetAttributeOperationSink(): void {
  operationSink = () => {};
}

/** Raise one metadata edit to the sink. */
export function emitAttributeOperation(intent: AttributeOperationIntent): void {
  operationSink(intent);
}
