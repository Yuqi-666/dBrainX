// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `website` node type: a bookmark to an external URL.
 *
 * Its content is the persisted payload and already matches the DTO's `content`.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

export type { WebsiteNodeData } from "@workspace/interfaces/models/node/nodes/single/website";

export interface WebsiteContent {
  url: string;
  faviconUrl?: string;
}

export const websiteSchema: JsonSchema = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string" },
    faviconUrl: { type: "string" },
  },
  additionalProperties: false,
};

/** A draft bookmark: no address and no favicon. */
export function createWebsiteContent(): WebsiteContent {
  return { url: "" };
}
