// SPDX-License-Identifier: AGPL-3.0-only

import { trpc } from "../provider";

/**
 * The management-face mutations.
 *
 * Node, edge and view writes are `operation.invoke` calls through
 * `@workspace/services` and have no hook here: the nine `useAdd*` / `useUpdate*`
 * / `useDelete*` mutation hooks were removed with the legacy endpoints (plan
 * items 43/44). Tags and the two semantic dictionaries keep their own endpoints,
 * because `OperationTarget` has no kind for them.
 */
export const useAddNodeSemantic = () => trpc.nodeSemantic.add.useMutation();
export const useUpdateNodeSemantic = () => trpc.nodeSemantic.update.useMutation();
export const useDeleteNodeSemantic = () => trpc.nodeSemantic.delete.useMutation();

export const useAddEdgeSemantic = () => trpc.edgeSemantic.add.useMutation();
export const useUpdateEdgeSemantic = () => trpc.edgeSemantic.update.useMutation();
export const useDeleteEdgeSemantic = () => trpc.edgeSemantic.delete.useMutation();

export const useAddNodeTag = () => trpc.nodeTag.add.useMutation();
export const useUpdateNodeTag = () => trpc.nodeTag.update.useMutation();
export const useDeleteNodeTag = () => trpc.nodeTag.delete.useMutation();
