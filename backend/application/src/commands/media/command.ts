// SPDX-License-Identifier: AGPL-3.0-only

import type {
  MediaKind,
  MediaQualityOption,
  MediaSiteAuthMethod,
  MediaSiteAuthStatus,
  MediaSubtitleTrack,
} from "@workspace/domain";
import type { MediaImportProgress } from "@workspace/interfaces";

/**
 * Commands and DTOs of the shared video/audio import layer.
 *
 * Video and audio share one application service because a site import is one
 * pipeline: match the site, read its offer, download, store, then post-process
 * differently per kind. Only the last step differs — HLS packaging for video,
 * container compatibility for audio — so the two strategies live behind one
 * command shape and one result shape.
 */

/** One listed site, together with the caller's saved login state for it. */
export interface MediaSiteDTO {
  /** Stable key, e.g. `bilibili`. */
  key: string;
  /** Display name, e.g. 「B 站」. */
  name: string;
  /** Kinds this site can provide. */
  kinds: MediaKind[];
  /** Host suffixes matched against a pasted address. */
  hosts: string[];
  /** One line explaining what a login unlocks. */
  loginHint: string;
  /** True when this owner has a saved login for the site. */
  loggedIn: boolean;
  /** How the saved login was produced, `null` when there is none. */
  authMethod: MediaSiteAuthMethod | null;
  /** Browser name for a `browser` login, `""` otherwise. */
  browserName: string;
  /** Account name the last verification reported, `""` when unknown. */
  accountLabel: string;
  /** Result of the last verification, `"saved"` when never checked. */
  status: MediaSiteAuthStatus;
  /** ISO timestamp of the last verification, `""` when never checked. */
  lastCheckedAt: string;
}

/** One browser the local backend can read cookies from. */
export interface MediaBrowserDTO {
  /** Name yt-dlp accepts, e.g. `chrome`. */
  name: string;
  /** Label to show, e.g. `Chrome`. */
  label: string;
}

/** Everything the login panel needs: the sites, method A's browsers, and its gate. */
export interface MediaSitesDTO {
  sites: MediaSiteDTO[];
  browsers: MediaBrowserDTO[];
  /** False on a deployment where reading the server's browsers makes no sense. */
  browserLoginEnabled: boolean;
}

/** Outcome of importing one exported `cookies.txt`. */
export interface MediaCookieImportDTO {
  /** Sites whose saved login was created (and, usually, verified). */
  connected: MediaSiteDTO[];
  /** Sites whose login was created but whose verification probe failed. */
  failed: { siteKey: string; message: string }[];
  /** Cookie domains outside the listed sites, dropped before anything was stored. */
  ignoredDomains: string[];
}

/** What one address offers, as the picker shows it. */
export interface MediaProbeDTO {
  /** Handle the import sends back so the server can validate its `formatId`. */
  probeId: string;
  /** What was asked for. */
  kind: MediaKind;
  /** Listed site key, or `null` for an unlisted site. */
  siteKey: string | null;
  /** Title reported by the site. */
  title: string;
  /** Artist / uploader / anchor, `""` when unknown. */
  artist: string;
  /** Album, `""` when unknown. */
  album: string;
  /** Duration in seconds, `0` when unknown. */
  duration: number;
  /** Thumbnail as a data URL, `null` when the site wrote none. */
  thumbnailDataUrl: string | null;
  /** True when the site wants a login before it answers. */
  requiresLogin: boolean;
  /** True when the owner already has a saved login for the matched site. */
  loggedIn: boolean;
  /** Subtitle / lyric tracks the site offers. */
  subtitleLanguages: { language: string; label: string; automatic: boolean }[];
  /** Quality options, best first. */
  qualities: MediaQualityOption[];
}

/** Asks what one address offers, without downloading anything. */
export interface ProbeMediaCommand {
  /** Page URL the user pasted. */
  url: string;
  /** Whether a video or an audio answer is expected. */
  kind: MediaKind;
}

/** Asks the backend to download one address, store it, and post-process it. */
export interface ImportMediaCommand {
  /** Verified owner the storage quota is charged against. */
  ownerId: string;
  /** Workspace the stored resource belongs to. */
  workspaceId: string;
  /** Node the result belongs to; one node runs at most one import at a time. */
  nodeId: string;
  /** What is being imported. */
  kind: MediaKind;
  /** Page URL the user pasted. */
  url: string;
  /** Handle from a recent {@link ProbeMediaDTO}; required with `formatId`. */
  probeId?: string;
  /** Chosen quality, copied from the probe's `qualities`; omitted means best. */
  formatId?: string;
  /** Client-generated id so the progress subscription exists before the call. */
  jobId?: string;
}

/** What a completed import hands back, ready to write onto a node. */
export interface ImportedMediaDTO {
  /** Job id the client confirms once the result is on its node. */
  jobId: string;
  /** Name the stored source file was saved under. */
  fileName: string;
  /** Root-relative address of the stored source file. */
  url: string;
  /** Address of the stored cover / poster, `""` when there is none. */
  coverUrl: string;
  /** Address of the stored HLS playlist, `""` for audio and unpackaged video. */
  hlsUrl: string;
  /** Duration in seconds, `0` when unknown. */
  duration: number;
  /** Byte length of the stored source file. */
  fileSize: number;
  /** Title reported by the site. */
  title: string;
  /** Artist / uploader, `""` when unknown. */
  artist: string;
  /** Album, `""` when unknown. */
  album: string;
  /** Canonical page the media came from. */
  sourceUrl: string;
  /** yt-dlp extractor that answered. */
  extractorKey: string;
  /** Width in pixels of a video, `0` for audio. */
  width: number;
  /** Height in pixels of a video, `0` for audio. */
  height: number;
  /** Subtitle / lyric track to write into `content.timestamps`. */
  subtitle: MediaSubtitleTrack | null;
}

/** One import job, as the client sees it for resume / recovery. */
export interface MediaImportJobDTO {
  /** Random id, also the progress channel key. */
  jobId: string;
  /** Node the result belongs to. */
  nodeId: string;
  /** What is being imported. */
  kind: MediaKind;
  /** Page URL the user pasted. */
  url: string;
  /** Chosen format id, `""` for "best available". */
  formatId: string;
  /** Current lifecycle state. */
  state: "running" | "completed" | "interrupted";
  /** Phase the server was last working on. */
  stage: string;
  /** Last reported overall completion, `0`–`99` while running. */
  percent: number;
  /** Result once `state` is `completed`. */
  result: ImportedMediaDTO | null;
  /** Stable failure code, `""` while the job has not failed. */
  errorCode: string;
  /** Failure message, `""` while the job has not failed. */
  errorMessage: string;
}

/** Receives one progress update of an import. */
export type MediaImportProgressListener = (
  progress: MediaImportProgress,
) => void;
