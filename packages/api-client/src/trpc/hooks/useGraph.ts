// SPDX-License-Identifier: AGPL-3.0-only

import { trpc } from "../provider";

export const useAddNode = () => trpc.node.add.useMutation();
export const useUpdateNode = () => trpc.node.update.useMutation();
export const useDeleteNode = () => trpc.node.delete.useMutation();

export const useAddEdge = () => trpc.edge.add.useMutation();
export const useUpdateEdge = () => trpc.edge.update.useMutation();
export const useDeleteEdge = () => trpc.edge.delete.useMutation();

export const useAddNodeSemantic = () => trpc.nodeSemantic.add.useMutation();
export const useUpdateNodeSemantic = () => trpc.nodeSemantic.update.useMutation();
export const useDeleteNodeSemantic = () => trpc.nodeSemantic.delete.useMutation();

export const useAddEdgeSemantic = () => trpc.edgeSemantic.add.useMutation();
export const useUpdateEdgeSemantic = () => trpc.edgeSemantic.update.useMutation();
export const useDeleteEdgeSemantic = () => trpc.edgeSemantic.delete.useMutation();

export const useAddView = () => trpc.view.add.useMutation();
export const useUpdateView = () => trpc.view.update.useMutation();
export const useDeleteView = () => trpc.view.delete.useMutation();

export const useAddNodeTag = () => trpc.nodeTag.add.useMutation();
export const useUpdateNodeTag = () => trpc.nodeTag.update.useMutation();
export const useDeleteNodeTag = () => trpc.nodeTag.delete.useMutation();