// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback } from "react";
import type {
  NodeId,
  EdgeId,
  NodeData,
  NodeDataType,
  TextNodeData,
  ImageNodeData,
  PdfNodeData,
  VideoNodeData,
  AudioNodeData,
  WebpageNodeData,
  WebsiteNodeData,
  CollectionNodeData,
  RichTextNodeData,
  DatabaseNodeData,
  EdgeDirection,
  EdgeData,
  NodeTag,
  NodeTagId,
  NodeStateData,
} from "@workspace/interfaces";
import { useUIStore, useDataStore } from "@workspace/store";
import { NodeService, EdgeService, NodeTagService } from "@workspace/services";

export function useGraph() {
  const setCurrentEditingNodeId = useUIStore(
    (state) => state.setCurrentEditingNodeId,
  );

  const onEditNode = useCallback(
    (nodeId: NodeId) => {
      setCurrentEditingNodeId(nodeId);
    },
    [setCurrentEditingNodeId],
  );

  const onDeleteNode = useCallback(async (nodeId: NodeId) => {
    try {
      await NodeService.delete(nodeId);
    } catch (error) {
      console.error("Failed to delete node:", error);
    }
  }, []);

  const onAddNode = useCallback(
    async (nodeType: NodeDataType, semanticId: string, simX?: number, simY?: number, viewId?: string) => {
      const now = new Date().toISOString();

      const baseNode: {
        id: NodeId;
        title: string;
        nodeType: NodeDataType;
        permission: "private";
        semanticId: string;
        createdAt: string;
        updatedAt: string;
        stateData?: NodeStateData;
      } = {
        id: "tmp_",
        title: "New Node",
        nodeType,
        permission: "private",
        semanticId,
        createdAt: now,
        updatedAt: now,
      };

      if (simX !== undefined && simY !== undefined && viewId) {
        baseNode.stateData = {
          client: { position: [{ viewId, x: simX, y: simY, mode: "force" }] },
          server: {},
        };
      }

      let newNode: NodeData;

      switch (nodeType) {
        case "text": {
          const textNode: TextNodeData = {
            ...baseNode,
            nodeType: "text",
            content: { docs: {} },
          };
          newNode = textNode;
          break;
        }
        case "image": {
          const imageNode: ImageNodeData = {
            ...baseNode,
            nodeType: "image",
            width: 0,
            height: 0,
            fileSize: 0,
            content: { url: "" },
          };
          newNode = imageNode;
          break;
        }
        case "pdf": {
          const pdfNode: PdfNodeData = {
            ...baseNode,
            nodeType: "pdf",
            pageCount: 0,
            fileSize: 0,
            content: { url: "", coverUrl: "" },
          };
          newNode = pdfNode;
          break;
        }
        case "video": {
          const videoNode: VideoNodeData = {
            ...baseNode,
            nodeType: "video",
            duration: 0,
            source: "local",
            fileSize: 0,
            content: { url: "", coverUrl: "" },
          };
          newNode = videoNode;
          break;
        }
        case "audio": {
          const audioNode: AudioNodeData = {
            ...baseNode,
            nodeType: "audio",
            duration: 0,
            fileSize: 0,
            content: { url: "" },
          };
          newNode = audioNode;
          break;
        }
        case "webpage": {
          // A webpage node references a stored document, so a fresh one starts
          // empty on its import surface (no address, no bytes).
          const webpageNode: WebpageNodeData = {
            ...baseNode,
            nodeType: "webpage",
            fileSize: 0,
            content: { url: "" },
          };
          newNode = webpageNode;
          break;
        }
        case "website": {
          const websiteNode: WebsiteNodeData = {
            ...baseNode,
            nodeType: "website",
            content: { url: "" },
          };
          newNode = websiteNode;
          break;
        }
        case "collection": {
          const collectionNode: CollectionNodeData = {
            ...baseNode,
            nodeType: "collection",
            content: { filterConfig: {} },
          };
          newNode = collectionNode;
          break;
        }
        case "database": {
          const databaseNode: DatabaseNodeData = {
            ...baseNode,
            nodeType: "database",
            content: { fields: [], rows: [] },
          };
          newNode = databaseNode;
          break;
        }
        case "rich-text":
        default: {
          const richTextNode: RichTextNodeData = {
            ...baseNode,
            nodeType: "rich-text",
            content: { docs: {}, referencedNodes: [] },
          };
          newNode = richTextNode;
          break;
        }
      }

      try {
        const result = await NodeService.upsert(newNode) as NodeData;
        setCurrentEditingNodeId(result.id as NodeId);
      } catch (error) {
        console.error("Failed to add node:", error);
      }
    },
    [setCurrentEditingNodeId],
  );

  const onCreateEdge = useCallback(
    async (sourceIds: string[], targetId: string | null, x: number, y: number, setContextMenu: (menu: any) => any): Promise<EdgeId | null> => {
      if (targetId === null) {
        setContextMenu({
          x,
          y,
          type: "add-edge",
          context: { sourceIds, targetId },
          visible: true,
        })
        return null;
      };

      const now = new Date().toISOString();
      let firstEdgeId: EdgeId | null = null;

      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue;

        const edgeData: EdgeData = {
          id: "tmp_",
          from: sourceId as NodeId,
          to: targetId as NodeId,
          direction: "forward",
          semanticId: "",
          createdAt: now,
          updatedAt: now,
        };

        try {
          const newEdge = await EdgeService.upsert(edgeData) as EdgeData;
          if (firstEdgeId === null) {
            firstEdgeId = newEdge.id;
          }
        } catch (error) {
          console.error("Failed to add edge:", error);
        }
      }

      if (firstEdgeId !== null) {
        setContextMenu({ x, y, type: "edge", context: { edgeId: firstEdgeId }, visible: true });
      }
      return firstEdgeId;
    },
    [],
  );

  const onDeleteEdge = useCallback(async (edgeId: EdgeId) => {
    try {
      await EdgeService.delete(edgeId);
    } catch (error) {
      console.error("Failed to delete edge:", error);
    }
  }, []);

  const onDeleteTag = useCallback(async (tagId: NodeTagId) => {
    try {
      console.log(tagId)
      await NodeTagService.delete(tagId);
    } catch (error) {
      console.error("Failed to delete tag:", error);
    }
  }, []);

  const getEdge = useCallback((edgeId: EdgeId) => {
    return useDataStore.getState().edges.get(edgeId);
  }, []);

  const onChangeEdgeDirection = useCallback(
    async (edgeId: EdgeId, direction: EdgeDirection) => {
      try {
        await EdgeService.upsert(
          edgeId,
          { direction },
          { debounce: true },
        );
      } catch (error) {
        console.error("Failed to change edge direction:", error);
      }
    },
    [],
  );

  const onChangeEdgeSemantic = useCallback(
    async (edgeId: EdgeId, semanticId: string) => {
      try {
        await EdgeService.upsert(
          edgeId,
          { semanticId },
          { debounce: true },
        );
      } catch (error) {
        console.error("Failed to change edge semantic:", error);
      }
    },
    [],
  );

  const onChangeNodeSemantic = useCallback(
    async (nodeId: NodeId, semanticId: string) => {
      try {
        await NodeService.upsert(
          nodeId,
          { semanticId },
          { debounce: true },
        );
      } catch (error) {
        console.error("Failed to change node semantic:", error);
      }
    },
    [],
  );

  const onCreateTag = useCallback(async (tagName: string) => {
    const tagId = `tmp_${tagName.toLowerCase().replace(/\s+/g, "-")}`;
    const colors = [
      "#3B82F6",
      "#10B981",
      "#8B5CF6",
      "#F59E0B",
      "#EF4444",
      "#EC4899",
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newTag = {
      id: tagId,
      name: tagName,
      color: randomColor,
    };
    try {
      const result = await NodeTagService.upsert(newTag);
      return result as NodeTag | null;
    } catch (error) {
      console.error("Failed to create tag:", error);
      return null;
    }
  }, []);

  const onDeleteSelected = useCallback(
    async (nodeIds: string[], edgeIds: string[]) => {
      for (const id of edgeIds) {
        try {
          await EdgeService.delete(id as EdgeId);
        } catch (error) {
          console.error("Failed to delete edge:", id, error);
        }
      }
      for (const id of nodeIds) {
        try {
          await NodeService.delete(id as NodeId);
        } catch (error) {
          console.error("Failed to delete node:", id, error);
        }
      }
    },
    [],
  );

  return {
    onEditNode,
    onDeleteNode,
    onAddNode,
    onCreateEdge,
    onDeleteEdge,
    onDeleteTag,
    onDeleteSelected,
    getEdge,
    onChangeEdgeDirection,
    onChangeEdgeSemantic,
    onChangeNodeSemantic,
    onCreateTag,
  };
}
