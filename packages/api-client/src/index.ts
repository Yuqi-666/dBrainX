// SPDX-License-Identifier: AGPL-3.0-only

export { trpcClient, createClient } from "./trpc/client";
export { TRPCReactProvider, trpc } from "./trpc/provider";
export * from "./trpc/hooks/useGraph";
export { useGraphSubscriptions } from "./trpc/subscriptions";
export * from "./handler/graph-handler";
export {
  DIRECT_UPLOAD_MAX_BYTES,
  FILES_COLLECTION,
  FILES_FIELD,
  MAX_UPLOAD_BYTES,
  PDF_ANALYZE_MAX_BYTES,
  buildUploadUrl,
  matchesAccept,
  replaceAttachment,
  resolveFileUrl,
  uploadAttachment,
  uploadFile,
  useFileUpload,
} from "./upload";
export type { FileItem, UploadOptions } from "./upload";
export {
  MediaImportRequestError,
  analyzePdf,
  cancelMediaImport,
  confirmMediaImport,
  connectMediaSiteWithBrowser,
  disconnectMediaSite,
  importMedia,
  importMediaCookies,
  mediaImportJob,
  mediaSites,
  probeMediaSource,
  transcodeVideo,
  verifyMediaSite,
} from "./file-analysis";
export {
  STORAGE_CATEGORIES,
  cacheResourceMeasurements,
  checkResourceLimit,
  currentResourceOwnerId,
  deleteResource,
  listNodesReferencingResource,
  listResources,
  listResourcesByIds,
  prettyStoredFileName,
  renameResource,
  resourceDisplayName,
  resourceIdFromStoredUrl,
  storageUsageOf,
  uploadResource,
  useResources,
  useStorageLimits,
} from "./resources";
export type {
  ListResourceOptions,
  NodeFileReference,
  ResourceLimitViolation,
  ResourceRecord,
  ResourceScope,
  StorageCategory,
  StorageLimits,
  StorageUsage,
  UseResourcesResult,
} from "./resources";
export type {
  ImportedMedia,
  MediaCookieImport,
  MediaImportJob,
  MediaProbe,
  MediaSite,
  MediaSites,
  PdfAnalysis,
  VideoTranscode,
} from "./file-analysis";
export {
  createPocketbaseClient,
  getPocketbaseClient,
  resetPocketbaseClient,
} from "./pocketbase-client";
export { resolveBackendUrls } from "./backend-urls";
export type { BackendUrls } from "./backend-urls";
export * from "./auth";

export {
  initializeDesktopBackend,
  getDesktopBackend,
  refreshDesktopSession,
} from "./desktop-backend";
export type { DesktopBackend } from "./desktop-backend";
