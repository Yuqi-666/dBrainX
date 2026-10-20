// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useMemo } from "react";
import type { NodeData } from "@workspace/interfaces";

import { TextNodeContent } from "./text-node-content";
import { ImageNodeContent } from "./image-node-content";
import { PdfNodeContent } from "./pdf-node-content";
import { VideoNodeContent } from "./video-node-content";
import { AudioNodeContent } from "./audio-node-content";
import { WebpageNodeContent } from "./webpage-node-content";
import { WebsiteNodeContent } from "./website-node-content";
import { RichTextNodeContent } from "./rich-text-node-content";
import { CollectionNodeContent } from "./collection-node-content";
import { DatabaseNodeContent } from "./database-node-content";

/** Props for the NodeContentEditor component */
interface NodeContentEditorProps {
  /** The node data to edit */
  node: NodeData;
  /** Optional CSS class name */
  className?: string;
}

/** Router component that switches between different node type content editors */
export function NodeContentEditor({ node, className }: NodeContentEditorProps) {
  const { t } = useI18n();

  const nodeType = node?.nodeType;

  const contentComponent = useMemo(() => {
    switch (nodeType) {
      case "text":
        return <TextNodeContent node={node} className={className} />;
      case "image":
        return <ImageNodeContent node={node} className={className} />;
      case "pdf":
        return <PdfNodeContent node={node} className={className} />;
      case "video":
        return <VideoNodeContent node={node} className={className} />;
      case "audio":
        return <AudioNodeContent node={node} className={className} />;
      case "webpage":
        return <WebpageNodeContent node={node} className={className} />;
      case "website":
        return <WebsiteNodeContent node={node} className={className} />;
      case "rich-text":
        return <RichTextNodeContent node={node} className={className} />;
      case "collection":
        return <CollectionNodeContent node={node} className={className} />;
      case "database":
        return <DatabaseNodeContent node={node} className={className} />;
      default:
        return (
          <div
            className={
              "p-4 text-muted-foreground" + (className ? ` ${className}` : "")
            }
          >
            {t("Unsupported node type:")} {nodeType}
          </div>
        );
    }
  }, [nodeType, node, className, t]);

  return <>{contentComponent}</>;
}
