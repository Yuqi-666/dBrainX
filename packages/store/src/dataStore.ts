// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  NodeSemantic,
  NodeSemanticId,
  NodeTag,
  NodeTagId,
  NodeData,
  NodeId,
  EdgeSemantic,
  EdgeSemanticId,
  EdgeData,
  EdgeId,
  View,
  ViewId,
} from "@workspace/interfaces";

export interface EntityDiff<TData, TId> {
  added: TData[];
  updated: TData[];
  removed: TId[];
}

export interface Diff {
  nodes: EntityDiff<NodeData, NodeId>;
  edges: EntityDiff<EdgeData, EdgeId>;
  nodeSemantics: EntityDiff<NodeSemantic, NodeSemanticId>;
  nodeTags: EntityDiff<NodeTag, NodeTagId>;
  edgeSemantics: EntityDiff<EdgeSemantic, EdgeSemanticId>;
  views: EntityDiff<View, ViewId>;
}

const createEmptyDiff = (): Diff => ({
  nodes: { added: [], updated: [], removed: [] },
  edges: { added: [], updated: [], removed: [] },
  nodeSemantics: { added: [], updated: [], removed: [] },
  nodeTags: { added: [], updated: [], removed: [] },
  edgeSemantics: { added: [], updated: [], removed: [] },
  views: { added: [], updated: [], removed: [] },
});

/**
 * Unified Zustand store for managing all cognitive graph data
 */
export interface DataStore {
  // ==================== 核心状态 ====================
  nodeSemantics: Map<NodeSemanticId, NodeSemantic>;
  nodeTags: Map<NodeTagId, NodeTag>;
  edgeSemantics: Map<EdgeSemanticId, EdgeSemantic>;
  nodes: Map<NodeId, NodeData>;
  edges: Map<EdgeId, EdgeData>;
  views: Map<ViewId, View>;

  diff: Diff;
  clearDiff: () => void;

  // ==================== Lifecycle / bulk load ====================
  reset: () => void;
  loadWorkspaceData: (data: {
    nodes?: NodeData[];
    edges?: EdgeData[];
    views?: View[];
    nodeSemantics?: NodeSemantic[];
    nodeTags?: NodeTag[];
    edgeSemantics?: EdgeSemantic[];
  }) => void;

  // ==================== CRUD Actions (upsert/delete only) ====================
  // -- Node Semantic --
  upsertNodeSemantic: (semantic: NodeSemantic) => void;
  upsertNodeSemantics: (semantics: NodeSemantic[]) => void;
  deleteNodeSemantic: (id: NodeSemanticId) => void;

  // -- Node Tag --
  upsertNodeTag: (tag: NodeTag) => void;
  upsertNodeTags: (tags: NodeTag[]) => void;
  deleteNodeTag: (id: NodeTagId) => void;

  // -- Edge Semantic --
  upsertEdgeSemantic: (semantic: EdgeSemantic) => void;
  upsertEdgeSemantics: (semantics: EdgeSemantic[]) => void;
  deleteEdgeSemantic: (id: EdgeSemanticId) => void;

  // -- Nodes --
  upsertNode: (node: NodeData) => void;
  upsertNodes: (nodes: NodeData[]) => void;
  deleteNode: (id: NodeId) => void;

  // -- Edges --
  upsertEdge: (edge: EdgeData) => void;
  upsertEdges: (edges: EdgeData[]) => void;
  deleteEdge: (id: EdgeId) => void;

  // -- Views --
  upsertView: (view: View) => void;
  upsertViews: (views: View[]) => void;
  deleteView: (id: ViewId) => void;

  // ==================== Getters ====================
  getNodeSemantic: (id: NodeSemanticId) => NodeSemantic | undefined;
  getAllNodeSemantics: () => NodeSemantic[];
  getNodeTag: (id: NodeTagId) => NodeTag | undefined;
  getAllNodeTags: () => NodeTag[];
  getEdgeSemantic: (id: EdgeSemanticId) => EdgeSemantic | undefined;
  getAllEdgeSemantics: () => EdgeSemantic[];
  getNode: (id: NodeId) => NodeData | undefined;
  getEdge: (id: EdgeId) => EdgeData | undefined;
  getEdgesForNode: (nodeId: NodeId) => EdgeData[];
  getView: (id: ViewId) => View | undefined;
  isDiffEmpty: () => boolean;

}

export const useDataStore = create<DataStore>()(
  devtools(
    (set, get) => ({
      // ==================== 初始状态 ====================
      nodeSemantics: new Map(),
      nodeTags: new Map(),
      edgeSemantics: new Map(),
      nodes: new Map(),
      edges: new Map(),
      views: new Map(),
      diff: createEmptyDiff(),

      // 清空 Diff 的方法
      clearDiff: () => { set({ diff: createEmptyDiff() }) },

      // ==================== Lifecycle / bulk load ====================
      reset: () =>
        set({
          nodeSemantics: new Map(),
          nodeTags: new Map(),
          edgeSemantics: new Map(),
          nodes: new Map(),
          edges: new Map(),
          views: new Map(),
          diff: createEmptyDiff(),
        }),

      loadWorkspaceData: (data) =>
        set((state) => {
          const { nodes = [], edges = [], views = [], nodeSemantics = [], nodeTags = [], edgeSemantics = [] } = data;

          const newNodes = new Map(state.nodes);
          for (const n of nodes) newNodes.set(n.id, n);

          const newEdges = new Map(state.edges);
          for (const e of edges) newEdges.set(e.id, e);

          const newViews = new Map(state.views);
          for (const v of views) newViews.set(v.id, v);

          const newNodeSemantics = new Map(state.nodeSemantics);
          for (const s of nodeSemantics) newNodeSemantics.set(s.id, s);

          const newNodeTags = new Map(state.nodeTags);
          for (const t of nodeTags) newNodeTags.set(t.id, t);

          const newEdgeSemantics = new Map(state.edgeSemantics);
          for (const s of edgeSemantics) newEdgeSemantics.set(s.id, s);

          return {
            nodes: newNodes,
            edges: newEdges,
            views: newViews,
            nodeSemantics: newNodeSemantics,
            nodeTags: newNodeTags,
            edgeSemantics: newEdgeSemantics,
            diff: createEmptyDiff(),
          };
        }),

      // ==================== Node Semantic Actions ====================
      upsertNodeSemantic: (semantic) => {
        set((state) => {
          const existed = state.nodeSemantics.has(semantic.id);
          const newSemantics = new Map(state.nodeSemantics);
          newSemantics.set(semantic.id, semantic);

          const bucket: "added" | "updated" = existed ? "updated" : "added";
          const newDiff: Diff = {
            ...state.diff,
            nodeSemantics: {
              ...state.diff.nodeSemantics,
              [bucket]: [...state.diff.nodeSemantics[bucket], semantic],
            },
          };

          return { nodeSemantics: newSemantics, diff: newDiff };
        });
      },

      upsertNodeSemantics: (semantics) => {
        set((state) => {
          const newSemantics = new Map(state.nodeSemantics);
          const added: NodeSemantic[] = [];
          const updated: NodeSemantic[] = [];
          for (const s of semantics) {
            if (newSemantics.has(s.id)) {
              updated.push(s);
            } else {
              added.push(s);
            }
            newSemantics.set(s.id, s);
          }

          const newDiff: Diff = {
            ...state.diff,
            nodeSemantics: {
              ...state.diff.nodeSemantics,
              added: [...state.diff.nodeSemantics.added, ...added],
              updated: [...state.diff.nodeSemantics.updated, ...updated],
            },
          };

          return { nodeSemantics: newSemantics, diff: newDiff };
        });
      },

      deleteNodeSemantic: (id) => {
        set((state) => {
          if (!state.nodeSemantics.has(id)) {
            return state;
          }
          const newSemantics = new Map(state.nodeSemantics);
          newSemantics.delete(id);

          const newDiff: Diff = {
            ...state.diff,
            nodeSemantics: {
              ...state.diff.nodeSemantics,
              removed: [...state.diff.nodeSemantics.removed, id],
            },
          };

          return { nodeSemantics: newSemantics, diff: newDiff };
        });
      },

      // ==================== Node Tag Actions ====================
      upsertNodeTag: (tag) => {
        set((state) => {
          const existed = state.nodeTags.has(tag.id);
          const newTags = new Map(state.nodeTags);
          newTags.set(tag.id, tag);

          const bucket: "added" | "updated" = existed ? "updated" : "added";
          const newDiff: Diff = {
            ...state.diff,
            nodeTags: {
              ...state.diff.nodeTags,
              [bucket]: [...state.diff.nodeTags[bucket], tag],
            },
          };

          return { nodeTags: newTags, diff: newDiff };
        });
      },

      upsertNodeTags: (tags) => {
        set((state) => {
          const newTags = new Map(state.nodeTags);
          const added: NodeTag[] = [];
          const updated: NodeTag[] = [];
          for (const t of tags) {
            if (newTags.has(t.id)) {
              updated.push(t);
            } else {
              added.push(t);
            }
            newTags.set(t.id, t);
          }

          const newDiff: Diff = {
            ...state.diff,
            nodeTags: {
              ...state.diff.nodeTags,
              added: [...state.diff.nodeTags.added, ...added],
              updated: [...state.diff.nodeTags.updated, ...updated],
            },
          };

          return { nodeTags: newTags, diff: newDiff };
        });
      },

      deleteNodeTag: (id) => {
        set((state) => {
          if (!state.nodeTags.has(id)) {
            return state;
          }
          const newTags = new Map(state.nodeTags);
          newTags.delete(id);

          const newDiff: Diff = {
            ...state.diff,
            nodeTags: {
              ...state.diff.nodeTags,
              removed: [...state.diff.nodeTags.removed, id],
            },
          };

          return { nodeTags: newTags, diff: newDiff };
        });
      },

      // ==================== Edge Semantic Actions ====================
      upsertEdgeSemantic: (semantic) => {
        set((state) => {
          const existed = state.edgeSemantics.has(semantic.id);
          const newSemantics = new Map(state.edgeSemantics);
          newSemantics.set(semantic.id, semantic);

          const bucket: "added" | "updated" = existed ? "updated" : "added";
          const newDiff: Diff = {
            ...state.diff,
            edgeSemantics: {
              ...state.diff.edgeSemantics,
              [bucket]: [...state.diff.edgeSemantics[bucket], semantic],
            },
          };

          return { edgeSemantics: newSemantics, diff: newDiff };
        });
      },

      upsertEdgeSemantics: (semantics) => {
        set((state) => {
          const newSemantics = new Map(state.edgeSemantics);
          const added: EdgeSemantic[] = [];
          const updated: EdgeSemantic[] = [];
          for (const s of semantics) {
            if (newSemantics.has(s.id)) {
              updated.push(s);
            } else {
              added.push(s);
            }
            newSemantics.set(s.id, s);
          }

          const newDiff: Diff = {
            ...state.diff,
            edgeSemantics: {
              ...state.diff.edgeSemantics,
              added: [...state.diff.edgeSemantics.added, ...added],
              updated: [...state.diff.edgeSemantics.updated, ...updated],
            },
          };

          return { edgeSemantics: newSemantics, diff: newDiff };
        });
      },

      deleteEdgeSemantic: (id) => {
        set((state) => {
          if (!state.edgeSemantics.has(id)) {
            return state;
          }
          const newSemantics = new Map(state.edgeSemantics);
          newSemantics.delete(id);

          const newDiff: Diff = {
            ...state.diff,
            edgeSemantics: {
              ...state.diff.edgeSemantics,
              removed: [...state.diff.edgeSemantics.removed, id],
            },
          };

          return { edgeSemantics: newSemantics, diff: newDiff };
        });
      },

      // ==================== Node Actions ====================
      upsertNode: (node) => {
        set((state) => {
          const existed = state.nodes.has(node.id);
          const newNodes = new Map(state.nodes);
          newNodes.set(node.id, node);

          const bucket: "added" | "updated" = existed ? "updated" : "added";
          const newDiff: Diff = {
            ...state.diff,
            nodes: {
              ...state.diff.nodes,
              [bucket]: [...state.diff.nodes[bucket], node],
            },
          };

          return { nodes: newNodes, diff: newDiff };
        });
      },

      upsertNodes: (nodes) => {
        set((state) => {
          const newNodes = new Map(state.nodes);
          const added: NodeData[] = [];
          const updated: NodeData[] = [];
          for (const n of nodes) {
            if (newNodes.has(n.id)) {
              updated.push(n);
            } else {
              added.push(n);
            }
            newNodes.set(n.id, n);
          }

          const newDiff: Diff = {
            ...state.diff,
            nodes: {
              ...state.diff.nodes,
              added: [...state.diff.nodes.added, ...added],
              updated: [...state.diff.nodes.updated, ...updated],
            },
          };

          return { nodes: newNodes, diff: newDiff };
        });
      },

      deleteNode: (id) => {
        const associatedEdges: EdgeId[] = [];
        for (const [edgeId, edge] of get().edges) {
          if (edge.from === id || edge.to === id) {
            associatedEdges.push(edgeId);
          }
        }
        for (const edgeId of associatedEdges) {
          get().deleteEdge(edgeId);
        }

        set((state) => {
          if (!state.nodes.has(id)) {
            return state;
          }
          const newNodes = new Map(state.nodes);
          newNodes.delete(id);

          const newDiff: Diff = {
            ...state.diff,
            nodes: {
              ...state.diff.nodes,
              removed: [...state.diff.nodes.removed, id],
            },
          };

          return { nodes: newNodes, diff: newDiff };
        });
      },

      // ==================== Edge Actions ====================
      upsertEdge: (edge) => {
        set((state) => {
          const existed = state.edges.has(edge.id);
          const newEdges = new Map(state.edges);
          newEdges.set(edge.id, edge);

          const bucket: "added" | "updated" = existed ? "updated" : "added";
          const newDiff: Diff = {
            ...state.diff,
            edges: {
              ...state.diff.edges,
              [bucket]: [...state.diff.edges[bucket], edge],
            },
          };

          return { edges: newEdges, diff: newDiff };
        });
      },

      upsertEdges: (edges) => {
        set((state) => {
          const newEdges = new Map(state.edges);
          const added: EdgeData[] = [];
          const updated: EdgeData[] = [];
          for (const e of edges) {
            if (newEdges.has(e.id)) {
              updated.push(e);
            } else {
              added.push(e);
            }
            newEdges.set(e.id, e);
          }

          const newDiff: Diff = {
            ...state.diff,
            edges: {
              ...state.diff.edges,
              added: [...state.diff.edges.added, ...added],
              updated: [...state.diff.edges.updated, ...updated],
            },
          };

          return { edges: newEdges, diff: newDiff };
        });
      },

      deleteEdge: (id) => {
        set((state) => {
          if (!state.edges.has(id)) {
            return state;
          }
          const newEdges = new Map(state.edges);
          newEdges.delete(id);

          const newDiff: Diff = {
            ...state.diff,
            edges: {
              ...state.diff.edges,
              removed: [...state.diff.edges.removed, id],
            },
          };

          return { edges: newEdges, diff: newDiff };
        });
      },

      // ==================== View Actions ====================
      upsertView: (view) => {
        set((state) => {
          const existed = state.views.has(view.id);
          const newViews = new Map(state.views);
          newViews.set(view.id, view);

          const bucket: "added" | "updated" = existed ? "updated" : "added";
          const newDiff: Diff = {
            ...state.diff,
            views: {
              ...state.diff.views,
              [bucket]: [...state.diff.views[bucket], view],
            },
          };

          return { views: newViews, diff: newDiff };
        });
      },

      upsertViews: (views) => {
        set((state) => {
          const newViews = new Map(state.views);
          const added: View[] = [];
          const updated: View[] = [];
          for (const v of views) {
            if (newViews.has(v.id)) {
              updated.push(v);
            } else {
              added.push(v);
            }
            newViews.set(v.id, v);
          }

          const newDiff: Diff = {
            ...state.diff,
            views: {
              ...state.diff.views,
              added: [...state.diff.views.added, ...added],
              updated: [...state.diff.views.updated, ...updated],
            },
          };

          return { views: newViews, diff: newDiff };
        });
      },

      deleteView: (id) => {
        set((state) => {
          if (!state.views.has(id)) {
            return state;
          }
          const newViews = new Map(state.views);
          newViews.delete(id);

          const newDiff: Diff = {
            ...state.diff,
            views: {
              ...state.diff.views,
              removed: [...state.diff.views.removed, id],
            },
          };

          return { views: newViews, diff: newDiff };
        });
      },

      // ==================== Getters  ====================
      getNodeSemantic: (id) => get().nodeSemantics.get(id),
      getAllNodeSemantics: () => Array.from(get().nodeSemantics.values()),
      getNodeTag: (id) => get().nodeTags.get(id),
      getAllNodeTags: () => Array.from(get().nodeTags.values()),
      getEdgeSemantic: (id) => get().edgeSemantics.get(id),
      getAllEdgeSemantics: () => Array.from(get().edgeSemantics.values()),
      getNode: (id) => get().nodes.get(id),
      getEdge: (id) => get().edges.get(id),
      getEdgesForNode: (nodeId) => {
        const { edges } = get();
        return Array.from(edges.values()).filter(
          (e) => e.from === nodeId || e.to === nodeId,
        );
      },
      getView: (id) => get().views.get(id),
      isDiffEmpty: () => {
        const d = get().diff;
        for (const bucket of Object.values(d)) {
          if (bucket.added.length || bucket.updated.length || bucket.removed.length) {
            return false;
          }
        }
        return true;
      },

    }),
    { name: "graph-store" },
  ),
);
