// SPDX-License-Identifier: AGPL-3.0-only

// Infrastructure layer - repositories, external APIs, data access

// PocketBase client
export * from "./database/pocketbase-client";
export {
  verifyToken,
  refreshToken,
  denylistToken,
  getTokenExp,
} from "./database/token-verifier";

// Event bus
export * from "./event-bus/in-memory-event-bus";

// Parsers / storage / transcoding adapters (implement the domain ports)
export * from "./parsers/pdf-document-analyzer";
export * from "./storage/pocketbase-file-store";
export * from "./storage/pocketbase-storage-usage";
export * from "./storage/pocketbase-media-analysis";
export * from "./storage/media-import-jobs";
export * from "./storage/media-cookie-cipher";
export * from "./storage/file-upload-sessions";
export * from "./transcoders/ffmpeg-video-transcoder";
export * from "./transcoders/ffmpeg-audio-transcoder";
export * from "./downloaders/media-sites";
export * from "./downloaders/media-quality";
export * from "./downloaders/vtt-parser";
export * from "./downloaders/media-browser-detector";
export * from "./downloaders/yt-dlp-media-downloader";
export * from "./downloaders/yt-dlp-media-probe";

// Mappers
export * from "./database/mappers/node.mapper";
export * from "./database/mappers/edge.mapper";
export * from "./database/mappers/view.mapper";
export * from "./database/mappers/filter-config.mapper";
export * from "./database/mappers/node-semantic.mapper";
export * from "./database/mappers/edge-semantic.mapper";
export * from "./database/mappers/node-tag.mapper";
export * from "./database/mappers/user.mapper";
export * from "./database/mappers/workspace.mapper";
export * from "./database/mappers/workspace-member.mapper";

// Repositories
export * from "./repositories/pocketbase-node.repository";
export * from "./repositories/pocketbase-edge.repository";
export * from "./repositories/pocketbase-view.repository";
export * from "./repositories/pocketbase-node-semantic.repository";
export * from "./repositories/pocketbase-edge-semantic.repository";
export * from "./repositories/pocketbase-node-tag.repository";
export * from "./repositories/pocketbase-user.repository";
export * from "./repositories/pocketbase-workspace.repository";
export * from "./repositories/pocketbase-workspace-member.repository";

export * from "./repositories/pocketbase-dashboard.repository";
export * from "./repositories/pocketbase-media-site-auth.repository";
export * from "./database/mappers/dashboard.mapper";
export * from "./database/mappers/media-site-auth.mapper";

export {
  runWithToken,
  requestToken,
  runWithFileWorkspace,
  fileWorkspace,
} from "./database/request-scope";
