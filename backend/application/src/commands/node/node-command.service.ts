// SPDX-License-Identifier: AGPL-3.0-only

import {
  TextContent,
  ImageContent,
  PdfContent,
  VideoContent,
  AudioContent,
  WebpageContent,
  WebsiteContent,
  CollectionContent,
  RichTextContent,
  DatabaseContent,
} from "@workspace/domain";
import {
  TextNode,
  ImageNode,
  PdfNode,
  VideoNode,
  AudioNode,
  WebpageNode,
  WebsiteNode,
  CollectionNode,
  RichTextNode,
  DatabaseNode,
  Node,
} from "@workspace/domain";
import { NodeId, Permission, FilterConfig } from "@workspace/domain";
import { toNodeDTO } from "../../dto/node-dto.mapper";
import type { NodeDTO } from "../../dto/node.dto";
import type {
  INodeRepository,
  IEdgeRepository,
  IEventBus,
} from "@workspace/domain";
import type {
  NodeCreated,
  NodeDeleted,
  NodeUpdated,
  EdgeDeleted,
} from "@workspace/domain";
import type { NodeStateData } from "@workspace/interfaces/models/node/base";
import type {
  CreateNodeCommand,
  UpdateNodeCommand,
  DeleteNodeCommand,
} from "./command";

export class NodeCommandService {
  constructor(
    private readonly nodeRepository: INodeRepository,
    private readonly edgeRepository: IEdgeRepository,
    private readonly eventBus: IEventBus,
  ) {}

  async createNode(cmd: CreateNodeCommand): Promise<NodeDTO> {
    if (!cmd.title || cmd.title.trim().length === 0) {
      throw new Error("Node title cannot be empty");
    }

    const id = new NodeId(cmd.id);
    const permission = cmd.permission
      ? new Permission(cmd.permission)
      : Permission.private();

    let node: Node;

    switch (cmd.nodeType) {
      case "text":
        node = TextNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          content: new TextContent(cmd.content.docs),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "image":
        node = ImageNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          width: cmd.width,
          height: cmd.height,
          fileSize: cmd.fileSize,
          location: cmd.location,
          shootingTime: cmd.shootingTime,
          content: new ImageContent(cmd.content.url),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "pdf":
        node = PdfNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          pageCount: cmd.pageCount,
          fileSize: cmd.fileSize,
          content: new PdfContent(cmd.content.url, cmd.content.coverUrl),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "video":
        node = VideoNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          duration: cmd.duration,
          source: cmd.source,
          sourceUrl: cmd.sourceUrl,
          fileSize: cmd.fileSize,
          location: cmd.location,
          shootingTime: cmd.shootingTime,
          content: new VideoContent(
            cmd.content.url,
            cmd.content.coverUrl,
            cmd.content.hlsUrl ?? "",
            // A node is created before it has any notes (the editor is what
            // writes those), but a transcript may already exist — a create that
            // dropped it would make the subtitle half of `timestamps`
            // write-only.
            cmd.content.timestamps,
          ),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "audio":
        node = AudioNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          duration: cmd.duration,
          source: cmd.source,
          sourceUrl: cmd.sourceUrl,
          fileSize: cmd.fileSize,
          content: new AudioContent(
            cmd.content.url,
            cmd.content.coverUrl,
            cmd.content.timestamps,
          ),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "webpage":
        node = WebpageNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          fileSize: cmd.fileSize ?? 0,
          content: new WebpageContent(cmd.content),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "website":
        node = WebsiteNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          content: new WebsiteContent(cmd.content.url, cmd.content.faviconUrl),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "collection":
        node = CollectionNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          content: new CollectionContent(
            FilterConfig.create({
              selectedNodes:
                cmd.content.filterConfig?.selectedNodes?.map(
                  (nodeId) => new NodeId(nodeId),
                ) ?? [],
              ruleGroup: cmd.content.filterConfig?.ruleGroup,
              collectionType: cmd.content.filterConfig?.collectionType,
            }),
            cmd.content.views ?? [],
          ),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "rich-text":
        node = RichTextNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          content: new RichTextContent(
            cmd.content.referencedNodes.map((n: string) => new NodeId(n)),
            cmd.content.docs,
          ),
          workspaceId: cmd.workspaceId,
        });
        break;
      case "database":
        node = DatabaseNode.create({
          id,
          title: cmd.title,
          abstract: cmd.abstract,
          permission,
          semanticId: cmd.semanticId,
          tags: cmd.tags ?? [],
          isPinned: cmd.isPinned ?? false,
          stateData: cmd.stateData,
          icon: cmd.icon,
          cover: cmd.cover,
          content: DatabaseContent.fromData(cmd.content),
          workspaceId: cmd.workspaceId,
        });
        break;
      default:
        throw new Error(`Unknown node type`);
    }

    const savedNode = await this.nodeRepository.save(node);

    const event: NodeCreated = {
      eventType: "NodeCreated",
      aggregateId: savedNode.id.value,
      metadata: {
        workspaceId: savedNode.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: savedNode.id.value,
      },
    };
    this.eventBus.publish(event);

    return toNodeDTO(savedNode);
  }

  async updateNode(cmd: UpdateNodeCommand): Promise<NodeDTO> {
    const id = new NodeId(cmd.id);
    const existingNode = await this.nodeRepository.findById(id);

    if (!existingNode) {
      throw new Error(`Node with id ${cmd.id} not found`);
    }

    let updatedNode: Node = existingNode;

    if (cmd.title !== undefined) {
      updatedNode = updatedNode.updateTitle(cmd.title);
    }
    if (cmd.abstract !== undefined) {
      updatedNode = updatedNode.updateAbstract(cmd.abstract);
    }
    if (cmd.tags !== undefined) {
      updatedNode = updatedNode.updateTags(cmd.tags as any);
    }
    if (cmd.permission !== undefined) {
      updatedNode = updatedNode.updatePermission(
        new Permission(cmd.permission),
      );
    }
    if (cmd.semanticId !== undefined) {
      updatedNode = updatedNode.updateSemanticId(cmd.semanticId);
    }
    if (cmd.isPinned !== undefined) {
      updatedNode = cmd.isPinned ? updatedNode.pin() : updatedNode.unpin();
    }
    // `null` is the write path's "clear" sentinel, `undefined` means "leave it
    // alone" — the same value judgement as `isPinned` above (R29-定). The
    // client sends a merged node, so the two cannot be told apart otherwise.
    if (cmd.icon !== undefined) {
      updatedNode =
        cmd.icon === null
          ? updatedNode.clearIcon()
          : updatedNode.updateIcon(cmd.icon);
    }
    if (cmd.cover !== undefined) {
      updatedNode =
        cmd.cover === null
          ? updatedNode.clearCover()
          : updatedNode.updateCover(cmd.cover);
    }
    if (cmd.content !== undefined) {
      updatedNode = this.updateNodeContent(updatedNode, cmd.content);
    }
    if (cmd.stateData !== undefined) {
      updatedNode = updatedNode.updateNodeStateData(cmd.stateData);
    }

    updatedNode = this.updateNodeFileMeta(updatedNode, cmd);

    const savedNode = await this.nodeRepository.save(updatedNode);

    const event: NodeUpdated = {
      eventType: "NodeUpdated",
      aggregateId: savedNode.id.value,
      metadata: {
        workspaceId: savedNode.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: savedNode.id.value,
      },
    };
    this.eventBus.publish(event);

    return toNodeDTO(savedNode);
  }

  /**
   * File metadata belongs to a single media node type each, so hand the command
   * to every candidate and let the node decide — same shape as
   * `updateNodeContent`.
   */
  private updateNodeFileMeta(node: Node, cmd: UpdateNodeCommand): Node {
    if (node instanceof ImageNode) {
      return node.updateFileMeta(cmd);
    }
    if (node instanceof PdfNode) {
      return node.updateFileMeta(cmd);
    }
    if (node instanceof VideoNode) {
      return node.updateFileMeta(cmd);
    }
    if (node instanceof AudioNode) {
      return node.updateFileMeta(cmd);
    }
    if (node instanceof WebpageNode) {
      return node.updateFileMeta(cmd);
    }
    return node;
  }

  private updateNodeContent(node: Node, content: any): Node {
    if (node instanceof TextNode && content.docs !== undefined) {
      return node.updateContent(new TextContent(content.docs));
    }
    if (
      node instanceof ImageNode &&
      (content.url !== undefined || content.annotations !== undefined)
    ) {
      // The url and the annotation layer are independent halves: saving a
      // batch of annotations must not require re-sending the url. A key the
      // patch omits keeps the value already stored — the same half-merge the
      // video branch below has always done.
      return node.updateContent(
        new ImageContent(
          content.url ?? node.content.url,
          content.annotations ?? node.content.annotations,
        ),
      );
    }
    if (
      node instanceof PdfNode &&
      ((content.url !== undefined && content.coverUrl !== undefined) ||
        content.annotations !== undefined)
    ) {
      // Same halves as image: `url` + `coverUrl` travel together on upload,
      // the annotation layer may be patched alone.
      return node.updateContent(
        new PdfContent(
          content.url ?? node.content.url,
          content.coverUrl ?? node.content.coverUrl,
          content.annotations ?? node.content.annotations,
        ),
      );
    }
    if (
      node instanceof VideoNode &&
      (content.url !== undefined ||
        content.hlsUrl !== undefined ||
        content.timestamps !== undefined)
    ) {
      // `hlsUrl` is patched in after the transcode finishes and the timestamp
      // list is saved on its own, so either may arrive alone; a patch that
      // omits a field keeps the value already stored.
      return node.updateContent(
        new VideoContent(
          content.url ?? node.content.url,
          content.coverUrl ?? node.content.coverUrl,
          content.hlsUrl ?? node.content.hlsUrl,
          content.timestamps ?? node.content.timestamps,
        ),
      );
    }
    if (
      node instanceof AudioNode &&
      (content.url !== undefined ||
        content.coverUrl !== undefined ||
        content.timestamps !== undefined)
    ) {
      // Same halves as video: a note may be added without re-sending the url,
      // and the cover is patched in by the import that saved it. An omitted
      // key keeps the value already stored.
      return node.updateContent(
        new AudioContent(
          content.url ?? node.content.url,
          content.coverUrl ?? node.content.coverUrl,
          content.timestamps ?? node.content.timestamps,
        ),
      );
    }
    if (node instanceof WebpageNode && content.url !== undefined) {
      // The node keeps only the address of the stored document, so there is one
      // half to patch. `fileSize` rides along in the same update
      // (`updateFileMeta`); an address written alone keeps the stored size.
      return node.updateContent(
        new WebpageContent({ url: content.url ?? node.content.url }),
      );
    }
    if (node instanceof WebsiteNode && content.url !== undefined) {
      return node.updateContent(
        new WebsiteContent(content.url, content.faviconUrl),
      );
    }
    if (node instanceof CollectionNode) {
      // `filterConfig` and `views` are independent halves of a collection's
      // content, and either may be patched alone (the filter editor writes one,
      // the data-view toolbar the other) — so an omitted key must leave its
      // half untouched instead of resetting it.
      let next = node;
      if (content.filterConfig !== undefined) {
        next = next.applyFilter(content.filterConfig);
      }
      if (content.views !== undefined) {
        next = next.applyViews(content.views);
      }
      return next;
    }
    if (
      node instanceof RichTextNode &&
      (content.referencedNodes !== undefined || content.docs !== undefined)
    ) {
      // `referencedNodes` and `docs` are two independent halves of the same
      // content — either may be patched alone (the editor body without the
      // reference list, and vice versa) — so an omitted half is carried over.
      return node.updateContent(
        new RichTextContent(
          content.referencedNodes !== undefined
            ? content.referencedNodes.map((n: string) => new NodeId(n))
            : node.content.referencedNodes,
          content.docs ?? node.content.docs,
        ),
      );
    }
    if (
      node instanceof DatabaseNode &&
      content.fields !== undefined &&
      content.rows !== undefined
    ) {
      // Column and row edits replace the whole table, so the incoming content
      // is always complete; `fromData` re-runs the structural validation.
      const table = DatabaseContent.fromData(content);
      // `views` is optional in a patch. When the caller did not mention it the
      // stored views stay (a column edit must not silently clear them).
      return node.updateContent(
        content.views === undefined
          ? table.withViews(node.content.views)
          : table,
      );
    }
    return node;
  }

  async deleteNode(cmd: DeleteNodeCommand): Promise<void> {
    const id = new NodeId(cmd.id);
    const existing = await this.nodeRepository.findById(id);
    if (!existing) throw new Error("Record not found");

    const associatedEdges = await this.edgeRepository.findByNodeId(id);
    if (associatedEdges.length > 0) {
      await this.edgeRepository.deleteMany(associatedEdges.map((e) => e.id));
      for (const edge of associatedEdges) {
        const event: EdgeDeleted = {
          eventType: "EdgeDeleted",
          aggregateId: edge.id.getValue(),
          metadata: {
            workspaceId: existing.workspaceId,
            occurredAt: new Date().toISOString(),
            eventVersion: 1,
            userId: cmd.userId,
            sourceId: cmd.sourceId,
          },
          data: { id: edge.id.getValue() },
        };
        this.eventBus.publish(event);
      }
    }

    await this.nodeRepository.delete(id);

    const event: NodeDeleted = {
      eventType: "NodeDeleted",
      aggregateId: cmd.id,
      metadata: {
        workspaceId: existing.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: { id: cmd.id },
    };
    this.eventBus.publish(event);
  }
}
