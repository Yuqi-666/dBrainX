// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dependency Injection Container for adapter-front
 *
 * Provides singleton instances of:
 * - PocketBase client (initialized once at startup)
 * - Repositories (via adapter-back factory)
 * - Application services (command + query services)
 * - InMemoryEventBus for domain event handling
 *
 * Usage:
 * ```typescript
 * // Initialize once at app startup
 * await AppContainer.initialize('http://127.0.0.1:8090');
 *
 * // Get the singleton instance anywhere in the app
 * const container = AppContainer.getInstance();
 * const nodeService = container.nodeCommandService;
 * ```
 */

import {
  createPocketBaseClient,
  getPocketBaseClient,
  InMemoryEventBus,
} from "@workspace/infrastructure";
import {
  createNodeDao,
  createEdgeDao,
  createViewDao,
  createUserDao,
  createNodeSemanticDao,
  createEdgeSemanticDao,
  createNodeTagDao,
  createDocumentAnalyzer,
  createFileStore,
  createMediaAnalysisStore,
  createFileUploadSessionStore,
  createStorageUsageReader,
  createVideoTranscoder,
  createAudioTranscoder,
  createMediaDownloader,
  createMediaProbe,
  createMediaSiteCatalog,
  createMediaBrowserDetector,
  createMediaImportJobStore,
  createMediaSiteAuthRepository,
  createWorkspaceRepository,
  createDashboardRepository,
  createWorkspaceMemberRepository,
} from "@workspace/adapter-back/factory";
import {
  NodeCommandService,
  NodeQueryService,
  EdgeCommandService,
  EdgeQueryService,
  ViewCommandService,
  ViewQueryService,
  SemanticCommandService,
  SemanticQueryService,
  WorkspaceCommandService,
  DashboardCommandService,
  DashboardQueryService,
  WorkspaceQueryService,
  FileCommandService,
  UploadCommandService,
  MediaImportService,
  MediaAuthService,
} from "@workspace/application";
import type { IWorkspaceMemberRepository } from "@workspace/domain";
import {
  MAX_UPLOAD_BYTES,
  PDF_ANALYZE_MAX_BYTES,
  UPLOAD_CHUNK_BYTES,
} from "@workspace/utils/upload";
import {
  resolveStorageLimits,
  type StorageLimits,
} from "@workspace/utils/storage-limits";
import { initializeEventBridge } from "./event-bridge";

export class AppContainer {
  private static _instance: AppContainer | null = null;

  // PocketBase client (singleton via infrastructure)
  readonly pb = getPocketBaseClient();

  // Event Bus (singleton instance)
  readonly eventBus: InMemoryEventBus;

  // DAOs (singletons via adapter-back factory)
  readonly nodeDao = createNodeDao();
  readonly edgeDao = createEdgeDao();
  readonly viewDao = createViewDao();
  readonly userDao = createUserDao();
  readonly nodeSemanticDao = createNodeSemanticDao();
  readonly edgeSemanticDao = createEdgeSemanticDao();
  readonly nodeTagDao = createNodeTagDao();

  /**
   * Storage policy resolved once, at startup: the per-user quota and the
   * per-category single-file ceilings come from the operator's `.env`, and the
   * same values are exposed to the clients through `storage.limits` so the
   * management page displays the policy that is actually enforced.
   */
  readonly storageLimits: StorageLimits;

  // Application Command Services (require repository + eventBus)
  readonly nodeCommandService: NodeCommandService;
  readonly edgeCommandService: EdgeCommandService;
  readonly viewCommandService: ViewCommandService;
  readonly semanticCommandService: SemanticCommandService;
  readonly workspaceCommandService: WorkspaceCommandService;
  /** Server-side file analysis (PDF parsing, cover rendering). */
  readonly fileCommandService: FileCommandService;
  /** Resumable (chunked) upload state machine, driven by the HTTP upload routes. */
  readonly uploadCommandService: UploadCommandService;
  /** Downloads a video/audio from a site URL, stores it and post-processes it. */
  readonly mediaImportService: MediaImportService;
  /** Listed site capsules, saved logins (method A/B), verification. */
  readonly mediaAuthService: MediaAuthService;

  // Application Query Services (require repository only)
  readonly nodeQueryService: NodeQueryService;
  readonly edgeQueryService: EdgeQueryService;
  readonly viewQueryService: ViewQueryService;
  readonly semanticQueryService: SemanticQueryService;
  readonly workspaceQueryService: WorkspaceQueryService;

  // Workspace repositories (singletons via adapter-back factory)
  readonly workspaceMemberRepository: IWorkspaceMemberRepository;

  private constructor() {
    this.eventBus = new InMemoryEventBus();
    this.storageLimits = resolveStorageLimits(process.env);

    this.nodeCommandService = new NodeCommandService(
      this.nodeDao,
      this.edgeDao,
      this.eventBus,
    );
    this.edgeCommandService = new EdgeCommandService(
      this.edgeDao,
      this.eventBus,
    );
    this.viewCommandService = new ViewCommandService(
      this.viewDao,
      this.eventBus,
    );
    this.semanticCommandService = new SemanticCommandService(
      this.nodeSemanticDao,
      this.edgeSemanticDao,
      this.nodeTagDao,
      this.eventBus,
    );

    this.fileCommandService = new FileCommandService(
      createDocumentAnalyzer(),
      createFileStore(),
      createVideoTranscoder(),
      // Parsing and packaging are cached on the resource record, so every node
      // that references the same file reuses one analysis and one HLS package.
      createMediaAnalysisStore(),
      PDF_ANALYZE_MAX_BYTES,
      createStorageUsageReader(),
      this.storageLimits,
    );

    // The transport limits come from the shared upload contract and the storage
    // policy from the shared storage contract, so the client's direct/chunked
    // decision, the server's early guards and the PocketBase hook cannot drift
    // apart.
    this.uploadCommandService = new UploadCommandService(
      createFileUploadSessionStore(),
      createFileStore(),
      {
        maxUploadBytes: MAX_UPLOAD_BYTES,
        chunkSize: UPLOAD_CHUNK_BYTES,
        maxFileBytes: this.storageLimits.maxFileBytes,
        userQuotaBytes: this.storageLimits.userQuotaBytes,
      },
      createStorageUsageReader(),
    );

    // Importing a media node from a site URL shares one layer between video and
    // audio: the same site catalog, saved logins, job store and progress
    // subscription, with a per-kind strategy (HLS packaging for video, container
    // compatibility for audio). The two services are long lived because both the
    // probe cache and the running-download registry live in them.
    this.mediaImportService = new MediaImportService(
      createMediaDownloader(),
      createMediaProbe(),
      createVideoTranscoder(),
      createAudioTranscoder(),
      createFileStore(),
      createMediaAnalysisStore(),
      createMediaImportJobStore(),
      createMediaSiteCatalog(),
      createMediaSiteAuthRepository(),
      createStorageUsageReader(),
      this.storageLimits,
    );
    this.mediaAuthService = new MediaAuthService(
      createMediaSiteCatalog(),
      createMediaSiteAuthRepository(),
      createMediaProbe(),
      createMediaBrowserDetector(),
      // Method A reads the browser the server itself runs on, so it is only
      // offered by a local backend: the desktop app, a local dev server, or an
      // operator who sets DBRAINX_LOCAL_MODE. A remote deployment hides it,
      // because reading the server's browsers would be useless there.
      { browserLoginEnabled: isLocalBackend() },
    );

    this.nodeQueryService = new NodeQueryService(this.nodeDao);
    this.edgeQueryService = new EdgeQueryService(this.edgeDao);
    this.viewQueryService = new ViewQueryService(this.viewDao);
    this.semanticQueryService = new SemanticQueryService(
      this.nodeSemanticDao,
      this.edgeSemanticDao,
      this.nodeTagDao,
    );

    this.workspaceCommandService = new WorkspaceCommandService(
      createWorkspaceRepository(),
      createWorkspaceMemberRepository(),
      this.nodeDao,
      this.edgeDao,
      this.viewDao,
      this.nodeSemanticDao,
      this.edgeSemanticDao,
      this.nodeTagDao,
      this.eventBus,
    );
    this.workspaceQueryService = new WorkspaceQueryService(
      createWorkspaceRepository(),
      createWorkspaceMemberRepository(),
    );
    this.workspaceMemberRepository = createWorkspaceMemberRepository();
  }

  /**
   * Sweeps the media-import job directories: a job that was `running` when the
   * previous process died becomes `interrupted` (resumable for a day), and stale
   * `interrupted` / confirmed `completed` jobs are removed. The sweep is best
   * effort and never blocks startup: an unwritable directory only logs.
   */
  private startMediaImportHousekeeping(): void {
    const run = () => {
      void this.mediaImportService.sweep().catch((error: unknown) => {
        console.warn("[AppContainer] media import sweep failed", error);
      });
    };
    run();
    try {
      setInterval(run, MEDIA_IMPORT_SWEEP_INTERVAL_MS).unref();
    } catch {
      // A runtime without unref (a test double) simply skips the timer.
    }
  }

  dashboardServices(token: string) {
    const repository = createDashboardRepository(token);
    const workspaces = createWorkspaceRepository();
    const members = createWorkspaceMemberRepository();
    return {
      command: new DashboardCommandService(
        repository,
        workspaces,
        members,
        this.nodeDao,
        this.eventBus,
      ),
      query: new DashboardQueryService(repository, workspaces, members),
    };
  }

  /**
   * Get the singleton instance
   * @throws Error if not initialized
   */
  static getInstance(): AppContainer {
    if (!AppContainer._instance) {
      throw new Error(
        "AppContainer not initialized. Call AppContainer.initialize(pbUrl) first.",
      );
    }
    return AppContainer._instance;
  }

  /**
   * Initialize the container with PocketBase URL
   * Must be called once at application startup before any other operations
   *
   * @param pbUrl - PocketBase server URL (e.g., 'http://127.0.0.1:8090')
   * @returns The initialized AppContainer singleton
   */
  static async initialize(pbUrl: string): Promise<AppContainer> {
    if (AppContainer._instance) {
      console.warn(
        "AppContainer already initialized. Returning existing instance.",
      );
      return AppContainer._instance;
    }

    createPocketBaseClient({ url: pbUrl });
    AppContainer._instance = new AppContainer();
    initializeEventBridge();
    AppContainer._instance.startMediaImportHousekeeping();

    return AppContainer._instance;
  }

  /**
   * Check if container has been initialized
   */
  static isInitialized(): boolean {
    return AppContainer._instance !== null;
  }

  /**
   * Reset container (for testing purposes only)
   */
  static reset(): void {
    AppContainer._instance = null;
  }
}

// Export singleton accessor for convenience
export const container = AppContainer.getInstance;

/** One hour between two sweeps of the media-import job directories. */
const MEDIA_IMPORT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * True when this server runs on the user's own machine.
 *
 * The desktop app launches its backend with `DBRAINX_DESKTOP=1`; a local
 * development server and an operator who opts in with `DBRAINX_LOCAL_MODE` are
 * local as well. A remote deployment says none of these, so the "use my browser"
 * login method is hidden there: reading the server's browsers would sign the
 * server in, not the user.
 */
function isLocalBackend(): boolean {
  const localMode = process.env.DBRAINX_LOCAL_MODE?.trim().toLowerCase();
  if (localMode === "1" || localMode === "true") return true;
  if (process.env.DBRAINX_DESKTOP === "1") return true;
  return process.env.NODE_ENV !== "production";
}
