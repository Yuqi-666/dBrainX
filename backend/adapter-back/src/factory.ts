// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dependency Injection Factory for Adapter-Back
 * Provides singleton instances of repositories and factory functions for DAOs.
 */

import {
  createPocketBaseClient,
  getPocketBaseClient,
  PocketBaseNodeRepository,
  PocketBaseEdgeRepository,
  PocketBaseViewRepository,
  PocketBaseNodeSemanticRepository,
  PocketBaseEdgeSemanticRepository,
  PocketBaseNodeTagRepository,
  PocketBaseUserRepository,
  PocketBaseWorkspaceRepository,
  PocketBaseDashboardRepository,
  PocketBaseWorkspaceMemberRepository,
  PdfDocumentAnalyzer,
  PocketBaseFileStore,
  PocketBaseStorageUsage,
  PocketBaseMediaAnalysis,
  FileUploadSessionStore,
  FfmpegAudioTranscoder,
  FfmpegVideoTranscoder,
  FileMediaImportJobStore,
  PocketBaseMediaSiteAuthRepository,
  StaticMediaSiteCatalog,
  SystemMediaBrowserDetector,
  YtDlpMediaDownloader,
  YtDlpMediaProbe,
} from "@workspace/infrastructure";

import type {
  INodeRepository,
  IEdgeRepository,
  IViewRepository,
  INodeSemanticRepository,
  IEdgeSemanticRepository,
  INodeTagRepository,
  IUserRepository,
  IWorkspaceRepository,
  IDashboardRepository,
  IWorkspaceMemberRepository,
  IDocumentAnalyzer,
  IFileStore,
  IStorageUsageReader,
  IMediaAnalysisStore,
  IUploadSessionStore,
  IAudioTranscoder,
  IMediaDownloader,
  IMediaImportJobStore,
  IMediaProbe,
  IMediaSiteAuthRepository,
  IMediaSiteCatalog,
  IMediaBrowserDetector,
  IVideoTranscoder,
} from "@workspace/domain";

import {
  NodeDao,
  EdgeDao,
  ViewDao,
  UserDao,
  NodeSemanticDao,
  EdgeSemanticDao,
  NodeTagDao,
} from "./dao";

let nodeRepository: INodeRepository | null = null;
let edgeRepository: IEdgeRepository | null = null;
let viewRepository: IViewRepository | null = null;
let nodeSemanticRepository: INodeSemanticRepository | null = null;
let edgeSemanticRepository: IEdgeSemanticRepository | null = null;
let nodeTagRepository: INodeTagRepository | null = null;
let userRepository: IUserRepository | null = null;
let workspaceRepository: IWorkspaceRepository | null = null;
let workspaceMemberRepository: IWorkspaceMemberRepository | null = null;

export const createNodeRepository = (): INodeRepository => {
  if (!nodeRepository) {
    const pb = getPocketBaseClient();
    nodeRepository = new PocketBaseNodeRepository(pb);
  }
  return nodeRepository;
};

export const createEdgeRepository = (): IEdgeRepository => {
  if (!edgeRepository) {
    edgeRepository = new PocketBaseEdgeRepository();
  }
  return edgeRepository;
};

export const createViewRepository = (): IViewRepository => {
  if (!viewRepository) {
    viewRepository = new PocketBaseViewRepository();
  }
  return viewRepository;
};

export const createNodeSemanticRepository = (): INodeSemanticRepository => {
  if (!nodeSemanticRepository) {
    const pb = getPocketBaseClient();
    nodeSemanticRepository = new PocketBaseNodeSemanticRepository(pb);
  }
  return nodeSemanticRepository;
};

export const createEdgeSemanticRepository = (): IEdgeSemanticRepository => {
  if (!edgeSemanticRepository) {
    edgeSemanticRepository = new PocketBaseEdgeSemanticRepository();
  }
  return edgeSemanticRepository;
};

export const createNodeTagRepository = (): INodeTagRepository => {
  if (!nodeTagRepository) {
    nodeTagRepository = new PocketBaseNodeTagRepository();
  }
  return nodeTagRepository;
};

export const createUserRepository = (): IUserRepository => {
  if (!userRepository) {
    const pb = getPocketBaseClient();
    userRepository = new PocketBaseUserRepository(pb);
  }
  return userRepository;
};

export const createWorkspaceRepository = (): IWorkspaceRepository => {
  if (!workspaceRepository) {
    workspaceRepository = new PocketBaseWorkspaceRepository();
  }
  return workspaceRepository;
};

export const createWorkspaceMemberRepository =
  (): IWorkspaceMemberRepository => {
    if (!workspaceMemberRepository) {
      workspaceMemberRepository = new PocketBaseWorkspaceMemberRepository();
    }
    return workspaceMemberRepository;
  };

export const createNodeDao = (): NodeDao => {
  return new NodeDao(createNodeRepository());
};

export const createEdgeDao = (): EdgeDao => {
  return new EdgeDao(createEdgeRepository());
};

export const createViewDao = (): ViewDao => {
  return new ViewDao(createViewRepository());
};

export const createUserDao = (): UserDao => {
  return new UserDao(createUserRepository());
};

export const createNodeSemanticDao = (): NodeSemanticDao => {
  return new NodeSemanticDao(createNodeSemanticRepository());
};

export const createEdgeSemanticDao = (): EdgeSemanticDao => {
  return new EdgeSemanticDao(createEdgeSemanticRepository());
};

export const createNodeTagDao = (): NodeTagDao => {
  return new NodeTagDao(createNodeTagRepository());
};

let documentAnalyzer: IDocumentAnalyzer | null = null;
let fileStore: IFileStore | null = null;

export const createDocumentAnalyzer = (): IDocumentAnalyzer => {
  if (!documentAnalyzer) {
    documentAnalyzer = new PdfDocumentAnalyzer();
  }
  return documentAnalyzer;
};

export const createFileStore = (): IFileStore => {
  if (!fileStore) {
    fileStore = new PocketBaseFileStore(getPocketBaseClient());
  }
  return fileStore;
};

let uploadSessionStore: IUploadSessionStore | null = null;

/**
 * Chunk spool for the resumable upload path. Unlike the other factories this one
 * takes its root directory from the caller, because the spool has to be able to
 * live somewhere other than the system temporary directory (a deployment may
 * mount a dedicated volume for it); `rootDir` therefore only applies to the
 * first call, and the remaining calls share the singleton the process resolved.
 */
export const createFileUploadSessionStore = (
  rootDir?: string,
): IUploadSessionStore => {
  if (!uploadSessionStore) {
    uploadSessionStore = new FileUploadSessionStore(rootDir);
  }
  return uploadSessionStore;
};

let storageUsageReader: IStorageUsageReader | null = null;

/**
 * Per-user byte total for the quota check. Reads the `files` collection through
 * the request-scoped PocketBase client, so it sees exactly the records the
 * current caller is allowed to write.
 */
export const createStorageUsageReader = (): IStorageUsageReader => {
  if (!storageUsageReader) {
    storageUsageReader = new PocketBaseStorageUsage(getPocketBaseClient());
  }
  return storageUsageReader;
};

let mediaAnalysisStore: IMediaAnalysisStore | null = null;

/**
 * The analysis cache on a resource record. Reads and writes go through the
 * request-scoped client, so the collection rules decide who may cache: the
 * owner stores, a workspace teammate only reads.
 */
export const createMediaAnalysisStore = (): IMediaAnalysisStore => {
  if (!mediaAnalysisStore) {
    mediaAnalysisStore = new PocketBaseMediaAnalysis(getPocketBaseClient());
  }
  return mediaAnalysisStore;
};

let videoTranscoder: IVideoTranscoder | null = null;

export const createVideoTranscoder = (): IVideoTranscoder => {
  if (!videoTranscoder) {
    videoTranscoder = new FfmpegVideoTranscoder();
  }
  return videoTranscoder;
};

let audioTranscoder: IAudioTranscoder | null = null;

/**
 * Container check for an imported audio file. An audio node plays the stored
 * file with a plain `<audio>` element and has no HLS fallback, so a container
 * the element cannot play is converted before it is stored.
 */
export const createAudioTranscoder = (): IAudioTranscoder => {
  if (!audioTranscoder) {
    audioTranscoder = new FfmpegAudioTranscoder();
  }
  return audioTranscoder;
};

let mediaDownloader: IMediaDownloader | null = null;

/**
 * Site-aware downloader for the "import a video or audio from a URL" path. Its
 * binary is resolved per process (`YT_DLP_PATH || "yt-dlp"`), and the instance
 * is reused because it holds no per-call state; the running downloads it tracks
 * for cancellation are keyed by work directory.
 */
export const createMediaDownloader = (): IMediaDownloader => {
  if (!mediaDownloader) {
    mediaDownloader = new YtDlpMediaDownloader();
  }
  return mediaDownloader;
};

let mediaProbe: IMediaProbe | null = null;

/**
 * Reads what a site offers before anything is downloaded, so the quality picker
 * shows real options and the chosen format id is validated server-side instead
 * of trusting a client-supplied yt-dlp argument.
 */
export const createMediaProbe = (): IMediaProbe => {
  if (!mediaProbe) {
    mediaProbe = new YtDlpMediaProbe();
  }
  return mediaProbe;
};

let mediaSiteCatalog: IMediaSiteCatalog | null = null;

/** The fixed list of sites the import UI shows capsules for. */
export const createMediaSiteCatalog = (): IMediaSiteCatalog => {
  if (!mediaSiteCatalog) {
    mediaSiteCatalog = new StaticMediaSiteCatalog();
  }
  return mediaSiteCatalog;
};

let mediaBrowserDetector: IMediaBrowserDetector | null = null;

/** Finds the browsers a local backend may read cookies from (desktop method A). */
export const createMediaBrowserDetector = (): IMediaBrowserDetector => {
  if (!mediaBrowserDetector) {
    mediaBrowserDetector = new SystemMediaBrowserDetector();
  }
  return mediaBrowserDetector;
};

let mediaImportJobStore: IMediaImportJobStore | null = null;

/**
 * Resumable import jobs. The store owns a directory tree (not a table) because a
 * job is partly downloaded bytes: the root comes from `DBRAIN_MEDIA_IMPORT_DIR`,
 * so a deployment can put it on a volume with room for one download in flight.
 */
export const createMediaImportJobStore = (): IMediaImportJobStore => {
  if (!mediaImportJobStore) {
    mediaImportJobStore = new FileMediaImportJobStore();
  }
  return mediaImportJobStore;
};

let mediaSiteAuthRepository: IMediaSiteAuthRepository | null = null;

/**
 * Saved site logins. The repository owns the encryption, so no caller ever sees
 * a ciphertext or a key; the request-scoped client enforces the owner rules.
 */
export const createMediaSiteAuthRepository = (): IMediaSiteAuthRepository => {
  if (!mediaSiteAuthRepository) {
    mediaSiteAuthRepository = new PocketBaseMediaSiteAuthRepository();
  }
  return mediaSiteAuthRepository;
};

export const createAll = () => ({
  nodeRepository: createNodeRepository(),
  edgeRepository: createEdgeRepository(),
  viewRepository: createViewRepository(),
  nodeSemanticRepository: createNodeSemanticRepository(),
  edgeSemanticRepository: createEdgeSemanticRepository(),
  nodeTagRepository: createNodeTagRepository(),
  workspaceRepository: createWorkspaceRepository(),
  workspaceMemberRepository: createWorkspaceMemberRepository(),
  nodeDao: createNodeDao(),
  edgeDao: createEdgeDao(),
  viewDao: createViewDao(),
  userDao: createUserDao(),
  nodeSemanticDao: createNodeSemanticDao(),
  edgeSemanticDao: createEdgeSemanticDao(),
  nodeTagDao: createNodeTagDao(),
  documentAnalyzer: createDocumentAnalyzer(),
  fileStore: createFileStore(),
  storageUsageReader: createStorageUsageReader(),
  mediaAnalysisStore: createMediaAnalysisStore(),
  videoTranscoder: createVideoTranscoder(),
  audioTranscoder: createAudioTranscoder(),
  mediaDownloader: createMediaDownloader(),
  mediaProbe: createMediaProbe(),
  mediaSiteCatalog: createMediaSiteCatalog(),
  mediaBrowserDetector: createMediaBrowserDetector(),
  mediaImportJobStore: createMediaImportJobStore(),
  mediaSiteAuthRepository: createMediaSiteAuthRepository(),
});

export {
  createPocketBaseClient,
  getPocketBaseClient,
} from "@workspace/infrastructure";

/** Dashboard persistence uses the verified request identity rather than global auth. */
export const createDashboardRepository = (
  token: string,
): IDashboardRepository =>
  new PocketBaseDashboardRepository(getPocketBaseClient(), token);
