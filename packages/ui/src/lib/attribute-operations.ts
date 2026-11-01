// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The write half of the editor header and the descriptor-driven attribute
 * panel (§3.5.4.6).
 *
 * Every edit here is exactly one `operation.invoke` through the service layer
 * (`NodeService.invoke`): the caller names the operation and the input that
 * operation's schema declares, and nothing else is sent. A field whose
 * descriptor declares no operation is refused with `OPERATION_NOT_DECLARED`
 * instead of falling back to a whole-node patch — the refusal is the point,
 * because the panel used to merge `content` locally and would otherwise look
 * like it saved.
 *
 * A failure is returned, never thrown: `NodeService.invoke` writes the store
 * only from a successful reply, so a refused edit leaves the node as it was,
 * and the caller surfaces `code` to the user so the control shows the stored
 * value again.
 */
import { asOperationInvokeError } from "@workspace/api-client";
import type { NodeAttributeField } from "@workspace/plugin-sdk/ui";
import {
  NODE_OPERATIONS,
  NodeService,
  nodeTarget,
  type GraphInvokeOptions,
  type GraphOperationId,
} from "@workspace/services";

import { attributeFieldPatch } from "./node-attribute-fields.ts";

/** The code an edit gets when its field declares no operation at all. */
export const OPERATION_NOT_DECLARED = "OPERATION_NOT_DECLARED";

/**
 * The metadata operations the header and panel write.
 *
 * The title, abstract and semantic id come from the typed catalogue. The tag
 * pair is registered by the server (`plugins/builtin/server/operations.ts`) but
 * is not in that catalogue yet, so it is named here; todo 43 moves tag writes
 * onto these two ids and can then fold them into `NODE_OPERATIONS`.
 */
const METADATA_OPERATION_IDS = {
  title: NODE_OPERATIONS.setTitle,
  abstract: NODE_OPERATIONS.setAbstract,
  semanticId: NODE_OPERATIONS.setSemanticId,
  addTag: "node.addTag",
  removeTag: "node.removeTag",
} as const;

/** One edit, ready for `NodeService.invoke`. */
export interface AttributeOperationRequest {
  nodeId: string;
  /** Absent when the field's declaration names no operation for this edit. */
  operationId?: string;
  /** The input the operation's own schema declares; never a node snapshot. */
  input: Record<string, unknown>;
}

/** What an edit did, in a shape the caller can report and revert on. */
export type AttributeOperationOutcome =
  | { readonly ok: true; readonly operationId: string }
  | {
      readonly ok: false;
      readonly operationId?: string;
      readonly code: string;
      readonly message: string;
    };

/** One descriptor field edit: its declared operation and its dotted input. */
export function attributeFieldRequest(
  nodeId: string,
  field: NodeAttributeField,
  value: string,
): AttributeOperationRequest {
  return {
    nodeId,
    operationId: field.operationId,
    input: attributeFieldPatch(field.field, value),
  };
}

/** The header title input → `node.setTitle`. */
export function titleRequest(
  nodeId: string,
  title: string,
): AttributeOperationRequest {
  return {
    nodeId,
    operationId: METADATA_OPERATION_IDS.title,
    input: { title },
  };
}

/** The panel's abstract field → `node.setAbstract`. */
export function abstractRequest(
  nodeId: string,
  abstract: string,
): AttributeOperationRequest {
  return {
    nodeId,
    operationId: METADATA_OPERATION_IDS.abstract,
    input: { abstract },
  };
}

/** The panel's type selector → `node.setSemanticId`. */
export function semanticRequest(
  nodeId: string,
  semanticId: string,
): AttributeOperationRequest {
  return {
    nodeId,
    operationId: METADATA_OPERATION_IDS.semanticId,
    input: { semanticId },
  };
}

/**
 * One tag pill toggle → `node.addTag` / `node.removeTag`.
 *
 * The server takes the one tag being added or removed, so the client never
 * submits the whole `tags` array.
 */
export function tagRequest(
  nodeId: string,
  tagId: string,
  applied: boolean,
): AttributeOperationRequest {
  return {
    nodeId,
    operationId: applied
      ? METADATA_OPERATION_IDS.removeTag
      : METADATA_OPERATION_IDS.addTag,
    input: { tag: tagId },
  };
}

/** The stable code of a failed service call, for a toast and for a test. */
export function operationFailureCode(error: unknown): string {
  return asOperationInvokeError(error).code;
}

/**
 * Runs one edit through the service layer.
 *
 * `options.invoker` is the service's documented transport seam; a real caller
 * leaves it out and the tRPC route is used.
 */
export async function runAttributeOperation(
  request: AttributeOperationRequest,
  options?: GraphInvokeOptions,
): Promise<AttributeOperationOutcome> {
  const { operationId } = request;
  if (!operationId) {
    return {
      ok: false,
      code: OPERATION_NOT_DECLARED,
      message: `no operation is declared for this edit of node ${request.nodeId}`,
    };
  }

  try {
    // A plugin contributes its field's operation id at runtime (node types are
    // runtime data), so it is not in the client's compile-time catalogue; the
    // server is authoritative on which ids exist and answers
    // OPERATION_NOT_FOUND for one it does not register.
    await NodeService.invoke(
      operationId as GraphOperationId,
      nodeTarget(request.nodeId),
      request.input,
      options,
    );
    return { ok: true, operationId };
  } catch (error) {
    const failure = asOperationInvokeError(error);
    return {
      ok: false,
      operationId,
      code: failure.code,
      message: failure.message,
    };
  }
}
