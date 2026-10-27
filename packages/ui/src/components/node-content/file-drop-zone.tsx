// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useId, useRef, useState } from "react";
import {
  ClipboardPasteIcon,
  Code2Icon,
  FileCode2Icon,
  FileTextIcon,
  ImageIcon,
  ImagePlusIcon,
  LibraryIcon,
  LinkIcon,
  MusicIcon,
  SmileIcon,
  UploadIcon,
  VideoIcon,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Input } from "@workspace/ui/components/ui/input";
import { ResourceSelectorDialog } from "@workspace/ui/components/selector/resource-selector";
import { Progress } from "@workspace/ui/components/ui/progress";
import { toast } from "@workspace/ui/components/ui/toast";
import {
  MAX_UPLOAD_BYTES,
  PDF_ANALYZE_MAX_BYTES,
  cacheResourceMeasurements,
  matchesAccept,
  useFileUpload,
  useStorageLimits,
  uploadFile,
  analyzePdf,
  cancelMediaImport,
  confirmMediaImport,
  importMedia,
  mediaImportJob,
  transcodeVideo,
} from "@workspace/api-client";
import type { ImportedMedia, MediaImportJob } from "@workspace/api-client";
import { maxFileBytesFor } from "@workspace/utils/storage-limits";
import type { ResourceRecord } from "@workspace/api-client";
import { NodeService } from "@workspace/services";
import { useDataStore } from "@workspace/store";
import type {
  AudioContent,
  ImageContent,
  MediaImportProgress,
  MediaKind,
  NodeData,
  PdfContent,
  TimestampData,
  VideoContent,
} from "@workspace/interfaces";
import { notesOf } from "../media-player/types";
import { MediaImportProgressView } from "./media-import-progress-view";
import {
  MediaUrlImportDialog,
  type MediaImportRequest,
} from "./media-url-import-dialog";
import { useNodeContentWriter } from "./use-node-content-writer";
import {
  clearMediaUrlImportResumable,
  completeMediaUrlImport,
  consumeMediaUrlImportFailure,
  failMediaUrlImport,
  getMediaUrlImport,
  mediaImportFailure,
  reportMediaUrlImportProgress,
  setMediaUrlImportResumable,
  startMediaUrlImport,
  useMediaUrlImport,
} from "./use-media-url-import";

/** Variants that store an uploaded blob. */
type UploadVariant = "audio" | "video" | "image" | "pdf";
/**
 * `webpage` stores a document in the object store as well, but its upload is
 * HTTP-only and its method list starts with the source editor, so it has its
 * own zone ({@link WebpageDropZone}) instead of the media one.
 */
type Variant = UploadVariant | "webpage" | DisplayVariant;

/**
 * Display-field variants (R4): the uploaded blob becomes the node's **top-level**
 * `icon` / `cover` (`{ icon: { kind: "image", value } }` /
 * `{ cover: { kind: "image", url } }`) rather than its `content`. Routing them
 * through the `image` branch would replace the node's content with the new
 * picture — the one way this component can corrupt data (sel §6.1).
 *
 * Shapes frozen by the main agent (`docs/plan/node-content-ui.md` §0-2);
 * **W1-B owns the branches** in `buildNodeUpdates`.
 */
type DisplayVariant = "icon" | "cover";

/**
 * Variants whose metadata is read in the browser. PDFs and videos are excluded:
 * both are measured by the backend, which is the only side that can parse a PDF
 * or decode a codec the browser cannot play.
 */
type LocalVariant = Exclude<UploadVariant, "pdf" | "video">;

interface FileDropZoneProps {
  nodeId: string;
  accept: string;
  variant: Variant;
  onUploadStart?: () => void;
  /** Fired after a successful upload / source read, so hosts can react. */
  onUploaded?: () => void;
  onUploadError?: (error: Error) => void;
  /**
   * The 「编辑器」 method of the webpage zone: the host opens its code
   * editor instead of importing a file. Other variants ignore it.
   */
  onEditSource?: () => void;
  className?: string;
}

/** Row shape of {@link VARIANT_CONFIG}. */
interface VariantConfig {
  icon: LucideIcon;
  label: string;
  minHeight: string;
  /**
   * Text colour of the resource-type logo. Each variant gets its own colour so
   * the empty zone says which kind of file it accepts before the label is read.
   */
  tone: string;
}

const VARIANT_CONFIG = {
  audio: {
    icon: MusicIcon,
    get label() {
      return translate("音频");
    },
    minHeight: "min-h-[100px]",
    tone: "text-emerald-500",
  },
  video: {
    icon: VideoIcon,
    get label() {
      return translate("视频");
    },
    minHeight: "min-h-[100px]",
    tone: "text-violet-500",
  },
  image: {
    icon: ImageIcon,
    get label() {
      return translate("图片");
    },
    minHeight: "min-h-[100px]",
    tone: "text-sky-500",
  },
  pdf: {
    icon: FileTextIcon,
    label: "PDF",
    minHeight: "min-h-[400px]",
    tone: "text-rose-500",
  },
  webpage: {
    icon: FileCode2Icon,
    get label() {
      return translate("HTML / 代码文件");
    },
    minHeight: "min-h-[300px]",
    tone: "text-amber-500",
  },
  icon: {
    icon: SmileIcon,
    get label() {
      return translate("图标");
    },
    minHeight: "min-h-[100px]",
    tone: "text-amber-500",
  },
  cover: {
    icon: ImagePlusIcon,
    get label() {
      return translate("封面");
    },
    minHeight: "min-h-[160px]",
    tone: "text-sky-500",
  },
} as const satisfies Record<Variant, VariantConfig>;

/** Metadata read off the picked file. */
interface FilePreview {
  duration?: number;
  width?: number;
  height?: number;
}

/** Creates an object URL for `file`, runs `consume`, and always revokes it again. */
async function withObjectUrl<T>(
  file: File,
  consume: (url: string) => Promise<T>,
): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    return await consume(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Intrinsic size of the image at `src`.
 *
 * No `crossOrigin` is set: only the natural width / height are read here (never
 * the pixels through a canvas), and demanding CORS would make a perfectly
 * displayable stored image fail to measure on a deployment that does not send
 * the headers.
 */
function readImageSize(src: string): Promise<FilePreview> {
  return new Promise<FilePreview>((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

/** Duration of the audio at `src`, read from metadata only. */
function readAudioDuration(src: string): Promise<FilePreview> {
  return new Promise<FilePreview>((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = src;
    audio.onloadedmetadata = () =>
      resolve({
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    audio.onerror = () => reject(new Error("Audio load failed"));
  });
}

/**
 * Best-effort metadata extraction from an address. Never rejects: a missing
 * preview only means the node falls back to its placeholder rendering.
 *
 * Shared by the upload path (an object URL of the picked file) and the
 * reference path (the resource's stored URL): both end up as a `src` the browser
 * can measure directly.
 *
 * Video is absent on purpose. Its cover used to be grabbed here from a canvas,
 * which only works for a codec the browser can decode — precisely what an upload
 * cannot be relied on to be. The backend now measures the video and renders its
 * cover while packaging it (`FileCommandService.transcodeVideo`).
 */
async function generatePreviewFromUrl(
  src: string,
  variant: LocalVariant,
): Promise<FilePreview> {
  try {
    switch (variant) {
      case "audio":
        return await readAudioDuration(src);
      case "image":
        return await readImageSize(src);
    }
  } catch (error) {
    console.warn(
      `[FileDropZone] preview generation failed (${variant})`,
      error,
    );
    return {};
  }
}

/** The preview of a freshly picked file: it has no address yet, so give it one. */
function generatePreview(
  file: File,
  variant: LocalVariant,
): Promise<FilePreview> {
  return withObjectUrl(file, (src) => generatePreviewFromUrl(src, variant));
}

/**
 * One upload's contribution to its node: the **half** of `content` the variant
 * owns, plus the top-level fields written beside it.
 *
 * `content` here is the client's DTO object (`NodeData.content`), never the
 * PocketBase `nodes.content` column: the same column holds a `docs` object for
 * a text node but a bare url **string** for image / pdf / video / audio
 * (`backend/infrastructure/src/database/mappers/node.mapper.ts`), so a
 * column-shaped patch would stuff an object into a string column
 * (`docs/plan/node-content-ui.md` §M2.2-6).
 */
interface ContentPatch<C extends object> {
  contentHalf: Partial<C>;
  meta: Partial<NodeData>;
}

/** Base for the shared writer when the store has no live node to read. */
const NO_LIVE_CONTENT: Record<string, unknown> = {};

/**
 * Merges one upload's content half onto the node's **live** content and writes
 * it together with its sibling top-level fields.
 *
 * `NodeService.upsert` merges top-level keys only — `content` is replaced
 * wholesale — so the base must be read back from the store at write time
 * instead of taken from this render: a snapshot captured before another
 * writer's patch would silently drop the half that writer owns (PDF / image
 * `annotations`, a video's `timestamps`; plan §M2.2-6).
 */
async function writeContentPatch<C extends object>(
  nodeId: string,
  live: Record<string, unknown>,
  { contentHalf, meta }: ContentPatch<C>,
): Promise<void> {
  await NodeService.upsert(nodeId, {
    ...meta,
    content: { ...live, ...contentHalf },
  } as unknown as Partial<NodeData>);
}

/**
 * Maps the stored file onto the node fields the matching node type expects.
 *
 * `source` only carries the byte length: an upload passes its `File`, a resource
 * passes `{ size: resource.fileSize }`, and neither path has to know the other's
 * shape.
 */
function buildNodeUpdates(
  variant: LocalVariant,
  url: string,
  source: { size: number },
  preview: FilePreview,
): ContentPatch<ImageContent | AudioContent> {
  switch (variant) {
    case "image":
      return {
        contentHalf: { url },
        meta: {
          fileSize: source.size,
          width: preview.width ?? 0,
          height: preview.height ?? 0,
        },
      };
    case "audio":
      return {
        contentHalf: { url },
        meta: { fileSize: source.size, duration: preview.duration ?? 0 },
      };
  }
}

/**
 * Tells the user the blob and the node write both succeeded.
 *
 * Reached from the upload promise's closure, so it also runs when the dialog
 * that started the upload has already closed. A referenced resource passes its
 * record (`{ name }`) where an upload passes its `File` — both name the blob the
 * same way.
 */
function showUploadSuccessToast(upload: { name: string }): void {
  toast({
    title: translate("上传成功"),
    description: upload.name,
  });
}

/** The import kind of a media variant, or `null` for a variant with no site flow. */
function mediaImportKindFor(variant: UploadVariant): MediaKind | null {
  return variant === "video" || variant === "audio" ? variant : null;
}

/**
 * The node's timeline after an import: the user's existing notes first, then the
 * subtitle / lyric cues the server returned.
 *
 * The cues are plain text with millisecond anchors, which is exactly
 * `TimestampSubtitleData`; a note keeps its rich-text body and identity. Merging
 * after `notesOf` is the rule the media sidebar documents: a re-import must
 * never drop a note the user already wrote on the same node.
 *
 * `endMs` is omitted rather than written as `undefined`: the backend's schema
 * accepts a missing span, and an explicitly-undefined key does not survive the
 * JSON round trip predictably.
 */
function timestampsAfterImport(
  content: unknown,
  subtitle: ImportedMedia["subtitle"],
): TimestampData[] {
  const existing =
    content && typeof content === "object"
      ? ((content as { timestamps?: TimestampData[] }).timestamps ?? [])
      : [];
  const notes = notesOf(existing);
  const cues: TimestampData[] = (subtitle?.cues ?? []).map((cue) => ({
    type: "subtitle",
    timeMs: cue.timeMs,
    ...(cue.endMs === undefined ? {} : { endMs: cue.endMs }),
    content: cue.content,
  }));
  return [...notes, ...cues];
}

/**
 * Turns a re-attached server job into the progress shape the bar draws.
 *
 * A job read back after a reload carries only its phase and overall percentage;
 * the byte totals and the speed of the original progress events are gone. The
 * bar therefore shows what is known and leaves the byte line empty instead of
 * inventing a rate — the phase and the percentage are the honest part.
 */
function progressFromJob(
  job: NonNullable<MediaImportJob>,
): MediaImportProgress {
  return {
    jobId: job.jobId,
    nodeId: job.nodeId,
    kind: job.kind,
    stage: job.stage as MediaImportProgress["stage"],
    percent: job.percent,
    downloadedBytes: 0,
    totalBytes: 0,
    speedBytesPerSecond: 0,
    etaSeconds: 0,
  };
}

/**
 * Parses an uploaded (or referenced) PDF on the backend and returns the content
 * half the node should end up with.
 *
 * Best-effort on purpose: the blob is already stored, so a document the backend
 * cannot parse (password protected, corrupt) must still leave the node pointing
 * at its file — it just keeps `pageCount: 0` and no cover, which is what the
 * node renders before any metadata arrives.
 *
 * A reference only reaches this fallback when the resource record carries no
 * cached analysis: `pageCount` / `storedCoverUrl` are written to the node
 * straight from the record otherwise. A record that was never parsed still
 * needs this call, and the backend caches the answer on the record, so only the
 * first reference pays for the parse.
 *
 * A document past the analysis cap is skipped without asking: the server would
 * have to stream the whole file to disk only to refuse it, and the node is
 * perfectly usable with the blob alone.
 */
async function analyzePdfUpload(
  url: string,
  source: { size: number },
): Promise<ContentPatch<PdfContent>> {
  let coverUrl = "";
  let pageCount = 0;
  let fileSize = source.size;

  if (source.size > PDF_ANALYZE_MAX_BYTES) {
    console.warn(
      "[FileDropZone] PDF is larger than the analysis cap; keeping the file without parsing it",
      source.size,
    );
  } else {
    try {
      const analysis = await analyzePdf(url);
      coverUrl = analysis.coverUrl;
      pageCount = analysis.pageCount;
      fileSize = analysis.fileSize;
    } catch (error) {
      console.warn("[FileDropZone] PDF analysis failed", error);
    }
  }

  return {
    contentHalf: { url, coverUrl },
    meta: { fileSize, pageCount },
  };
}

/**
 * Packages an uploaded (or referenced) video as HLS and returns the content half
 * the node should end up with.
 *
 * A reference only reaches this fallback when the resource has no cached
 * playlist (`storedHlsUrl === ""`): a packaged record is written to the node
 * directly. The backend caches a freshly built package on the record, so only
 * the first reference pays for the transcode.
 *
 * A transcode that fails must not lose the upload: the node then simply keeps
 * the original blob as its only representation — what every upload did before
 * the backend packaged videos — and the player reports the codec it cannot
 * decode instead of pretending to play it.
 */
async function packageVideoUpload(
  url: string,
  source: { size: number },
): Promise<ContentPatch<VideoContent>> {
  try {
    const transcoded = await transcodeVideo(url);

    return {
      contentHalf: {
        url,
        coverUrl: transcoded.coverUrl,
        hlsUrl: transcoded.hlsUrl,
      },
      meta: {
        fileSize: source.size,
        duration: transcoded.duration,
        source: "local",
      },
    };
  } catch (error) {
    console.warn(
      "[FileDropZone] HLS packaging failed, keeping the original upload",
      error,
    );

    return {
      contentHalf: { url, coverUrl: "", hlsUrl: "" },
      meta: { fileSize: source.size, duration: 0, source: "local" },
    };
  }
}

/**
 * Colour of each add method's logo. Local picks are blue, clipboard amber, and
 * the resource library green — the same family the menu used. Importing from a
 * video site is rose: a distinct fifth colour, so the card that leaves the
 * browser for a remote page is recognisable at a glance among the local ones.
 */
const METHOD_TONES = {
  edit: "text-violet-500",
  local: "text-sky-500",
  paste: "text-amber-500",
  library: "text-emerald-500",
  site: "text-rose-500",
} as const;

/**
 * One add method inside the drop zone, styled after the reference design: a
 * bordered rounded card with the resource-type logo on the left, and the title
 * with its one-line explanation on the right.
 *
 * The 「本地上传」 card is a `<label>`, not a button with a scripted
 * `input.click()`: WebKit ignores a programmatic click on a file input that is
 * not rendered, so the picker would never open there. The input stays rendered
 * (see the zones below) and every engine routes a label activation to it.
 */
interface AddMethodCardProps {
  icon: LucideIcon;
  /** Text colour of the resource-type logo. */
  tone: string;
  title: string;
  description: string;
  /** Renders a label bound to this file input instead of a button. */
  htmlFor?: string;
  /** Opens the hidden file input from the keyboard; a label has no native key action. */
  onActivate?: () => void;
  onSelect?: () => void;
}

const addMethodCardClassName = cn(
  "group/upload-method flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-background px-4 py-3 text-left outline-hidden select-none transition-colors",
  "hover:border-border hover:bg-muted/40",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
);

function AddMethodCard({
  icon: Icon,
  tone,
  title,
  description,
  htmlFor,
  onActivate,
  onSelect,
}: AddMethodCardProps) {
  const body = (
    <>
      <Icon className={cn("size-6 shrink-0", tone)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </>
  );

  if (htmlFor) {
    return (
      <label
        htmlFor={htmlFor}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onActivate?.();
        }}
        className={addMethodCardClassName}
      >
        {body}
      </label>
    );
  }

  return (
    <button type="button" onClick={onSelect} className={addMethodCardClassName}>
      {body}
    </button>
  );
}

/**
 * The empty state shared by every upload zone.
 *
 * The dashed border is the drag-and-drop affordance: the whole surface is a
 * drop target, and dropping a file goes through the same path as a picked one,
 * so validation and error reporting stay in one place per variant. The layout
 * follows the reference design: the resource-type logo centred at the top, then
 * the add-method cards stacked below it.
 */
interface DropZoneSurfaceProps {
  config: VariantConfig;
  /** The add-method cards, in display order. */
  children: React.ReactNode;
  /** Third line under the cards, e.g. what a source import does. */
  hint?: string;
  /** Inline rejection text; replaces the hint when present. */
  error?: string | null;
  /** A file dropped on the zone; the host validates it like a picked one. */
  onDropFiles: (files: File[]) => void;
  className?: string;
}

function DropZoneSurface({
  config,
  children,
  hint,
  error,
  onDropFiles,
  className,
}: DropZoneSurfaceProps) {
  const { t } = useI18n();
  const Icon = config.icon;

  /**
   * Drag enter/leave also fire for every child element, so they are counted:
   * leaving a card for the surface must not clear the highlight.
   */
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const carriesFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const resetDrag = () => {
    dragDepth.current = 0;
    setDragActive(false);
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return;
    // Without this the browser opens the dropped file instead of uploading it.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    resetDrag();

    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onDropFiles(files);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group/dropzone relative flex h-full w-full items-center justify-center overflow-y-auto rounded-2xl border border-dashed bg-background/60 p-4 transition-colors",
        "hover:border-muted-foreground/40",
        dragActive && "border-primary/70 bg-primary/5",
        config.minHeight,
        className,
      )}
    >
      <div className="my-auto flex w-full max-w-md flex-col items-center gap-5">
        {/* Resource-type logo: the colour names the file kind the zone accepts. */}
        <div
          className={cn(
            "flex size-16 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/30 shadow-xs transition-transform duration-150",
            config.tone,
            dragActive && "scale-105",
          )}
        >
          <Icon className="size-6" aria-hidden="true" />
        </div>

        {/* The cards swallow the click, as the old zone did: choosing a file
            must not also select or open the node behind it. */}
        <div
          className="flex w-full flex-col gap-2.5"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>

        {error ? (
          <p role="alert" className="text-center text-xs text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p className="text-center text-xs text-muted-foreground/80">{hint}</p>
        ) : null}
      </div>

      {dragActive && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-primary/5 text-sm font-medium text-primary">
          {t("松开即可上传")}
        </span>
      )}
    </div>
  );
}

/**
 * Reads the first image out of the clipboard.
 *
 * Throws when the browser has no async clipboard; returns `null` when the
 * clipboard simply holds no picture. The caller turns both into interface copy.
 */
async function readClipboardImage(): Promise<File | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    throw new Error("clipboard-unavailable");
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find(
      (candidate) => candidate === "image/png" || candidate === "image/jpeg",
    );
    if (!type) continue;

    const blob = await item.getType(type);
    const extension = type === "image/jpeg" ? "jpg" : "png";
    return new File([blob], `pasted-image-${Date.now()}.${extension}`, {
      type,
    });
  }

  return null;
}

/**
 * Picks a file and uploads it to PocketBase. Used by every media variant, all
 * of which store the blob they uploaded.
 */
function UploadDropZone({
  nodeId,
  accept,
  variant,
  onUploadStart,
  onUploaded,
  onUploadError,
  className,
}: FileDropZoneProps & { variant: UploadVariant }) {
  const { t } = useI18n();

  /** Rejection / clipboard error shown under the method cards. */
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  /** Set while the backend is packaging an uploaded video as HLS. */
  const [packaging, setPackaging] = useState(false);
  /** Name of the library resource being referenced, shown while it is applied. */
  const [referencing, setReferencing] = useState<string | null>(null);
  /** Set while the 「从资源库选择」 dialog is open. */
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  /**
   * The site import, read from module-level state rather than component state:
   * closing the node dialog unmounts this zone while the backend keeps working,
   * and reopening it must show the bar that is still advancing
   * (`use-media-url-import.ts`). An upload survives the same way.
   */
  const mediaImport = useMediaUrlImport(nodeId);
  /** `video` / `audio` when this variant can import from a site, else `null`. */
  const importKind = mediaImportKindFor(variant);
  /** Set while the shared media URL dialog is open. */
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  /** Address and reason of the last failed import, prefilled into the dialog. */
  const [importDraft, setImportDraft] = useState<{
    url: string;
    error: string | null;
  }>({ url: "", error: null });
  /**
   * Writes a re-attached job's result; a ref because the mount effect below
   * must not re-run on every render while it still uses the freshest closure.
   */
  const writeImportResultRef = useRef<
    (imported: ImportedMedia) => Promise<void>
  >(async () => {});

  /**
   * A failure that happened while this zone was not mounted (or that the
   * previous instance recorded) is shown once here: the zone's inline line and
   * the retry dialog, prefilled with the address, exactly as if the failure had
   * arrived in the foreground.
   */
  useEffect(() => {
    const failure = mediaImport.failure;
    if (!failure) return;

    setActionError(failure.message);
    setImportDraft({ url: failure.url, error: failure.message });
    setImportDialogOpen(true);
    // Mark it shown, so reopening the editor later starts from a clean surface.
    consumeMediaUrlImportFailure(nodeId);
  }, [nodeId, mediaImport.failure]);

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  /**
   * The node's freshest `content`, read when a write is built. The write itself
   * stays an awaited `NodeService.upsert` (not the writer's `patchContent`)
   * because every media path below reports `onUploaded` / drops its `packaging`
   * note only once the node is really written, and because a failed write has
   * to reach `onUploadError`.
   */
  const { liveContent } = useNodeContentWriter<Record<string, unknown>>(
    nodeId,
    variant,
    NO_LIVE_CONTENT,
  );

  /**
   * Writes one finished import onto the node.
   *
   * The result carries everything an upload would have produced — stored
   * address, cover, HLS playlist for a video, subtitle / lyric cues — plus the
   * page it came from. The cues are merged after the user's existing notes
   * ({@link timestampsAfterImport}), and the content half merges over the live
   * content, so a concurrent writer's half survives exactly as in the upload
   * path. `source: "online"` is what tells the player and the resource panel
   * that this is not a local file; `sourceUrl` is the canonical page.
   *
   * The title is a fallback, never a replacement: it is adopted with a second
   * top-level write only when the node has no title yet, because the user's own
   * title always wins.
   */
  const writeImportedMedia = async (imported: ImportedMedia) => {
    const kind = importKind ?? "video";
    await writeContentPatch(nodeId, liveContent(), {
      contentHalf: {
        url: imported.url,
        coverUrl: imported.coverUrl,
        timestamps: timestampsAfterImport(liveContent(), imported.subtitle),
        // Only a video has an HLS rendition; writing `hlsUrl` onto an audio node
        // would add a field its content type does not declare.
        ...(kind === "video" ? { hlsUrl: imported.hlsUrl } : {}),
      },
      meta: {
        fileSize: imported.fileSize,
        duration: imported.duration,
        source: "online",
        sourceUrl: imported.sourceUrl,
      },
    });

    const liveTitle = useDataStore.getState().nodes.get(nodeId)?.title ?? "";
    const title = (imported.title || imported.fileName).trim();
    if (title !== "" && liveTitle.trim() === "") {
      await NodeService.upsert(nodeId, { title });
    }

    // Report first, then drop the progress view: `onUploaded` may swap the
    // host's empty state for the player, and these updates batch into one
    // render, so the zone never flashes back to its cards. The toast is global,
    // so it also appears when the node dialog was closed during the import and
    // this component is no longer mounted.
    toast({
      title: t("导入完成"),
      description: title !== "" ? title : imported.fileName,
    });
    onUploaded?.();
  };
  // The mount effect re-attaches to a server job without re-subscribing on each
  // render; the ref is how it still calls the latest closure.
  writeImportResultRef.current = writeImportedMedia;

  /**
   * Re-attaches to a job the server still knows about.
   *
   * The progress promise started by an import belongs to the component (and the
   * page) that started it. Closing the node dialog does not lose it — the store
   * is module-level — but a reload does, while the server keeps downloading.
   * On mount this asks `mediaImportJob(nodeId)` what is left:
   *
   * - `running` → adopt the job and poll it. The deltas of the lost subscription
   *   are gone, but the job's stage and over-all percentage are enough for an
   *   honest bar, and polling is also how the completion is noticed.
   * - `completed` → write the cached result and confirm it, which deletes it.
   * - `interrupted` → show 「继续」 and keep the job; resuming reuses its id, so
   *   the partial download is not thrown away.
   *
   * A promise started by this same session is already reporting, so the query is
   * skipped then — two sources would double every update.
   */
  useEffect(() => {
    if (!importKind) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const finishFromJob = async (job: NonNullable<MediaImportJob>) => {
      stopPolling();
      if (job.state === "interrupted") {
        completeMediaUrlImport(nodeId);
        setMediaUrlImportResumable(nodeId, {
          jobId: job.jobId,
          kind: job.kind,
          url: job.url,
          formatId: job.formatId,
          state: "interrupted",
        });
        return;
      }
      if (job.state === "completed" && job.result) {
        try {
          await writeImportResultRef.current(job.result);
          await confirmMediaImport(nodeId, job.jobId);
          clearMediaUrlImportResumable(nodeId);
        } catch (cause) {
          const failure = mediaImportFailure(cause);
          failMediaUrlImport(nodeId, {
            kind: job.kind,
            url: job.url,
            code: failure.code,
            message: failure.message,
          });
        } finally {
          completeMediaUrlImport(nodeId);
        }
        return;
      }
      // No result to write (or the job vanished): clear the bar, never spin.
      completeMediaUrlImport(nodeId);
    };

    const reattach = async () => {
      if (getMediaUrlImport(nodeId).active) return;
      let job: MediaImportJob | null;
      try {
        job = await mediaImportJob(nodeId);
      } catch {
        return;
      }
      if (cancelled || !job) return;

      if (job.state !== "running") {
        await finishFromJob(job);
        return;
      }

      startMediaUrlImport(nodeId, {
        kind: job.kind,
        url: job.url,
        jobId: job.jobId,
      });
      timer = setInterval(() => {
        void (async () => {
          let latest: MediaImportJob | null;
          try {
            latest = await mediaImportJob(nodeId);
          } catch {
            return;
          }
          if (cancelled) return;
          if (!latest) {
            stopPolling();
            completeMediaUrlImport(nodeId);
            return;
          }
          if (latest.state === "running") {
            reportMediaUrlImportProgress(nodeId, progressFromJob(latest));
            return;
          }
          await finishFromJob(latest);
        })();
      }, 1500);
    };

    void reattach();
    return () => {
      cancelled = true;
      // A re-attached job is watched only by this effect's timer. If the zone
      // unmounts, drop the adopted bar so the next mount queries the job again
      // instead of showing a frozen one; an import this session started keeps
      // its module-level entry, because its own promise still reports to it.
      const wasPolling = timer !== null;
      stopPolling();
      if (wasPolling) completeMediaUrlImport(nodeId);
    };
  }, [importKind, nodeId]);

  const { fileItems, uploadFiles, removeFileItem } = useFileUpload({
    // The pipeline's own ceiling, not a UI preference: above it the server
    // rejects the file, and below it the client would refuse a file the
    // resumable path could have delivered.
    maxSize: MAX_UPLOAD_BYTES,
    limit: 1,
    accept: accept,
    // Outlives this dialog: the key lets a reopened zone subscribe to the
    // upload that started before it unmounted.
    key: `${nodeId}:${variant}`,
    upload: uploadFile,
    // `file` comes straight from the uploader — reading `fileItems[0]` here
    // would see the pre-upload state and silently skip post-processing.
    onSuccess: async (url: string, file: File) => {
      try {
        if (variant === "pdf") {
          // Parsing happens on the server: it takes a PDF parser and a
          // rasterizer, neither of which belongs in the client bundle. The
          // blob is already stored, so only its address is sent over.
          const patch = await analyzePdfUpload(url, file);
          await writeContentPatch(nodeId, liveContent(), patch);
          onUploaded?.();
          showUploadSuccessToast(file);
          return;
        }

        if (variant === "video") {
          // Packaging happens on the server as well, and for a stronger reason
          // than for a PDF: the codec the file arrived in may be one this
          // browser cannot decode at all. The node only learns it can play the
          // video once the playlist is back, so the drop zone stays up with a
          // "packaging" note until then.
          setPackaging(true);
          try {
            const patch = await packageVideoUpload(url, file);
            await writeContentPatch(nodeId, liveContent(), patch);
          } finally {
            setPackaging(false);
          }
          onUploaded?.();
          showUploadSuccessToast(file);
          return;
        }

        const preview = await generatePreview(file, variant);
        // Cache what the browser just measured, so a later reference reads it
        // off the resource record instead of loading the blob to measure it
        // again. Best effort: the helper never throws.
        await cacheResourceMeasurements(url, preview);

        const patch = buildNodeUpdates(variant, url, file, preview);
        await writeContentPatch(nodeId, liveContent(), patch);
        onUploaded?.();
        showUploadSuccessToast(file);
      } catch (error) {
        onUploadError?.(
          error instanceof Error ? error : new Error("Upload failed"),
        );
      }
    },
    onError: (error) => {
      onUploadError?.(error);
    },
  });

  const handleFilesSelected = (files: File[]) => {
    onUploadStart?.();
    uploadFiles(files);
  };

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) handleFilesSelected(files);
    // Let the same file be picked twice in a row.
    event.target.value = "";
  };

  const handlePasteImage = async () => {
    setActionError(null);
    try {
      const file = await readClipboardImage();
      if (!file) {
        setActionError(t("剪贴板中没有图片"));
        return;
      }
      handleFilesSelected([file]);
    } catch (cause) {
      const unavailable =
        cause instanceof Error && cause.message === "clipboard-unavailable";
      const message = unavailable
        ? t("当前浏览器不支持读取剪贴板，请改用「本地上传」")
        : t("粘贴图片失败（剪贴板权限被拒绝？）");
      setActionError(message);
      onUploadError?.(cause instanceof Error ? cause : new Error(message));
    }
  };

  /**
   * Writes a referenced library resource onto this node, variant by variant.
   *
   * It must leave the node in exactly the state an upload would, but it reuses
   * the analysis cached on the resource record instead of deriving it again: a
   * PDF record with a page count or cover, a video with an HLS playlist, and an
   * image or audio file with its measurements are written straight from the
   * record. Only a record that carries none falls back to parsing, packaging or
   * measuring, and what the browser measures is written back (best effort) so
   * the next reference is cheap. The node stores the resource's `storedUrl`,
   * never its bytes. `liveContent()` is read at write time so a concurrent
   * writer's content half survives, exactly as in the upload path.
   */
  const handleResourceSelected = async (resource: ResourceRecord) => {
    onUploadStart?.();
    setReferencing(resource.name);

    try {
      if (variant === "pdf") {
        if (resource.pageCount > 0 || resource.storedCoverUrl !== "") {
          // The record already carries what a parse would return, so the node
          // is written from it without asking the backend to open the file.
          await writeContentPatch(nodeId, liveContent(), {
            contentHalf: {
              url: resource.storedUrl,
              coverUrl: resource.storedCoverUrl,
            },
            meta: {
              fileSize: resource.fileSize,
              pageCount: resource.pageCount,
            },
          });
        } else {
          // Parsing happens on the server (PDF parser + rasterizer): hand the
          // stored address over and keep whatever comes back.
          const patch = await analyzePdfUpload(resource.storedUrl, {
            size: resource.fileSize,
          });
          await writeContentPatch(nodeId, liveContent(), patch);
        }
      } else if (variant === "video") {
        if (resource.storedHlsUrl !== "") {
          // A packaged resource plays as stored: the playlist and cover are
          // what a transcode would have returned.
          await writeContentPatch(nodeId, liveContent(), {
            contentHalf: {
              url: resource.storedUrl,
              coverUrl: resource.storedCoverUrl,
              hlsUrl: resource.storedHlsUrl,
            },
            meta: {
              fileSize: resource.fileSize,
              duration: resource.duration,
              source: "local",
            },
          });
        } else {
          // Same as the upload path: the drop zone stays up with a packaging
          // note until the backend has built the playlist and cover.
          setPackaging(true);
          try {
            const patch = await packageVideoUpload(resource.storedUrl, {
              size: resource.fileSize,
            });
            await writeContentPatch(nodeId, liveContent(), patch);
          } finally {
            setPackaging(false);
          }
        }
      } else {
        // Image / audio: reuse the measurements the record carries; measure
        // only a record that has none. The resource address is already what
        // `<img>` / `<audio>` needs, so no object URL is involved.
        let preview: FilePreview;
        if (variant === "image" && resource.width > 0 && resource.height > 0) {
          preview = { width: resource.width, height: resource.height };
        } else if (variant === "audio" && resource.duration > 0) {
          preview = { duration: resource.duration };
        } else {
          preview = await generatePreviewFromUrl(resource.url, variant);
          // Best effort: the resource may belong to a teammate, and the node
          // already has these numbers; caching only spares the next reference
          // the measurement.
          await cacheResourceMeasurements(resource.storedUrl, preview);
        }

        const patch = buildNodeUpdates(
          variant,
          resource.storedUrl,
          { size: resource.fileSize },
          preview,
        );
        await writeContentPatch(nodeId, liveContent(), patch);
      }

      onUploaded?.();
      showUploadSuccessToast(resource);
    } catch (error) {
      onUploadError?.(
        error instanceof Error ? error : new Error(t("引用资源失败")),
      );
    } finally {
      setReferencing(null);
    }
  };

  /**
   * Runs one site import: download, store, and post-process on the server, then
   * write the result onto this node.
   *
   * The dialog has already closed when this starts: the zone replaces its cards
   * with {@link MediaImportProgressView} and follows the server's progress until
   * the mutation resolves, so the user sees the download the same way they see
   * an upload. A failure reopens the dialog with the address and the reason, so
   * retrying costs no retyping.
   *
   * The stored addresses are written **as returned**, never through
   * `resolveFileUrl`: node content and the resource library both keep
   * root-relative addresses and the renderer resolves them, exactly as the
   * upload and resource-reference paths do.
   *
   * `workspaceId` comes from the store, not from this render's props: the
   * backend stores the downloaded file on behalf of a workspace, and the node's
   * live record is the only place that names it.
   *
   * `jobId` is only set when continuing an interrupted job: the server reuses
   * that job's partial download and its directory instead of starting over.
   */
  const runMediaImport = async (
    request: MediaImportRequest & { jobId?: string },
  ) => {
    setActionError(null);
    onUploadStart?.();
    // Module-level, so the bar survives this zone unmounting with the node
    // dialog; the promise below keeps writing to it either way.
    startMediaUrlImport(nodeId, {
      kind: request.kind,
      url: request.url,
      jobId: request.jobId,
    });

    try {
      const workspaceId = useDataStore
        .getState()
        .nodes.get(nodeId)?.workspaceId;
      if (!workspaceId) {
        throw new Error(t("无法读取工作区信息，请重试"));
      }

      const imported = await importMedia(
        {
          url: request.url,
          kind: request.kind,
          nodeId,
          workspaceId,
          probeId: request.probeId,
          formatId: request.formatId,
          // Same job on resume; omitted for a fresh import so the API layer
          // generates the id it subscribes with.
          ...(request.jobId ? { jobId: request.jobId } : {}),
        },
        (progress) => reportMediaUrlImportProgress(nodeId, progress),
      );

      await writeImportedMedia(imported);
      // The server keeps a completed job until the client confirms it, so a
      // page reload between the write and this line can recover the result.
      await confirmMediaImport(nodeId, imported.jobId);
      clearMediaUrlImportResumable(nodeId);
    } catch (cause) {
      const failure = mediaImportFailure(cause);
      if (failure.code !== "cancelled") {
        // The zone maps this back to the field the user can correct. It is kept
        // outside React as well, because the failure may land while the node
        // dialog is closed: a zone mounted later reopens the retry dialog with
        // the address and the reason instead of silently showing its cards.
        onUploadError?.(new Error(failure.message));
        failMediaUrlImport(nodeId, {
          kind: request.kind,
          url: request.url,
          code: failure.code,
          message: failure.message,
        });
      }
    } finally {
      completeMediaUrlImport(nodeId);
    }
  };

  /** Cancels the import on the server; the promise above ignores its failure. */
  const handleCancelMediaImport = async () => {
    try {
      await cancelMediaImport(nodeId);
    } catch (cause) {
      const failure = mediaImportFailure(cause);
      // Cancelling an already-finished job is not worth a retry dialog; anything
      // else may leave the download running, so it is reported.
      if (failure.code !== "cancelled") {
        onUploadError?.(new Error(failure.message));
      }
    } finally {
      completeMediaUrlImport(nodeId);
      clearMediaUrlImportResumable(nodeId);
    }
  };

  /** Continues the interrupted job the mount query found. */
  const handleResumeMediaImport = () => {
    const resumable = mediaImport.resumable;
    if (!resumable) return;
    void runMediaImport({
      kind: resumable.kind,
      url: resumable.url,
      formatId: resumable.formatId || undefined,
      jobId: resumable.jobId,
    });
  };

  // A site import takes over the whole zone while it runs: the backend can
  // spend minutes on it, and a bar with the current phase is what tells the
  // user it is working — not a dialog that only says "importing". Its state
  // outlives this mount, so reopening the node dialog while the import runs
  // shows the same live bar instead of an empty drop zone.
  if (mediaImport.active) {
    return (
      <MediaImportProgressView
        kind={mediaImport.active.kind}
        url={mediaImport.active.url}
        progress={mediaImport.active.progress}
        onCancel={() => void handleCancelMediaImport()}
        className={className}
      />
    );
  }

  // A job left interrupted by a reload or a server restart: offer to continue
  // it instead of silently starting a new download.
  if (mediaImport.resumable) {
    return (
      <MediaImportProgressView
        kind={mediaImport.resumable.kind}
        url={mediaImport.resumable.url}
        progress={null}
        resumable
        onResume={handleResumeMediaImport}
        onCancel={() => void handleCancelMediaImport()}
        className={className}
      />
    );
  }

  if (fileItems.length === 0) {
    return (
      <>
        {referencing ? (
          <div
            className={cn(
              "w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/30 rounded-lg",
              config.minHeight,
              className,
            )}
          >
            <Icon className="size-10 text-muted-foreground" />
            <span className="max-w-full truncate px-4 text-sm">
              {referencing}
            </span>
            <span className="text-xs text-muted-foreground">
              {packaging ? t("正在转码为 HLS…") : t("正在应用资源…")}
            </span>
          </div>
        ) : (
          <>
            <Input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={accept}
              onChange={handleFileInputChange}
              // Not `display: none` (class `hidden`): WebKit refuses to open the
              // picker for an unrendered file input. The input must stay rendered
              // and only be made invisible, hence the off-screen 1px box.
              className="absolute -left-[9999px] h-px w-px overflow-hidden opacity-0"
            />

            <DropZoneSurface
              config={config}
              error={actionError}
              onDropFiles={handleFilesSelected}
              className={className}
            >
              <AddMethodCard
                icon={UploadIcon}
                tone={METHOD_TONES.local}
                title={t("本地上传")}
                description={t("从当前设备选择文件")}
                htmlFor={fileInputId}
                onActivate={() => fileInputRef.current?.click()}
              />
              {variant === "image" && (
                <AddMethodCard
                  icon={ClipboardPasteIcon}
                  tone={METHOD_TONES.paste}
                  title={t("粘贴图片")}
                  description={t("使用剪贴板中的图片")}
                  onSelect={() => void handlePasteImage()}
                />
              )}
              {/* Media variants only: the backend downloads and post-processes
                  the page's media, so the card opens the shared URL dialog
                  instead of a file picker. The other variants have no remote
                  counterpart. Both cards open the same dialog; only `kind`
                  (which site list, quality picker and stage wording) differs. */}
              {importKind && (
                <AddMethodCard
                  icon={LinkIcon}
                  tone={METHOD_TONES.site}
                  title={
                    importKind === "video"
                      ? t("从视频网站添加")
                      : t("从音乐网站添加")
                  }
                  description={
                    importKind === "video"
                      ? t("粘贴 YouTube、Bilibili 等视频链接")
                      : t("粘贴网易云音乐、QQ 音乐等链接")
                  }
                  onSelect={() => {
                    // A fresh attempt starts from an empty field: the previous
                    // address and its failure are only prefilled when the zone
                    // itself sends the user back to fix them.
                    setImportDraft({ url: "", error: null });
                    setImportDialogOpen(true);
                  }}
                />
              )}
              <AddMethodCard
                icon={LibraryIcon}
                tone={METHOD_TONES.library}
                title={t("从资源库选择")}
                description={t("引用已上传的资源")}
                onSelect={() => setResourcePickerOpen(true)}
              />
            </DropZoneSurface>
          </>
        )}

        <ResourceSelectorDialog
          open={resourcePickerOpen}
          onOpenChange={setResourcePickerOpen}
          accept={accept}
          onSelect={(resource) => {
            void handleResourceSelected(resource);
          }}
        />

        {importKind && (
          <MediaUrlImportDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            kind={importKind}
            onSubmit={(request) => {
              void runMediaImport(request);
            }}
            initialUrl={importDraft.url}
            initialError={importDraft.error}
          />
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "w-full h-full flex flex-col items-center justify-center gap-4",
        className,
      )}
    >
      {fileItems.map((item) => (
        <div key={item.id} className="w-full max-w-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm truncate">{item.file.name}</span>
            <button
              onClick={() => removeFileItem(item.id)}
              disabled={item.status === "success"}
              className="p-1 hover:bg-muted rounded-sm disabled:opacity-50 disabled:pointer-events-none"
            >
              <X className="size-4" />
            </button>
          </div>
          <Progress value={packaging ? 100 : item.progress} />
          <span
            className="text-xs text-muted-foreground break-words"
            title={item.status === "error" ? item.error : undefined}
          >
            {item.status === "error"
              ? translate("上传失败：{value1}", {
                  value1: item.error ?? t("未知原因"),
                })
              : packaging
                ? t("正在转码为 HLS…")
                : `${item.progress}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The empty state of a `webpage` node: the document is a stored object.
 *
 * A webpage node keeps an HTML file in the resource library, the way a PDF node
 * keeps a PDF, so this zone uploads a picked file (or references one already in
 * the library) and writes the stored address onto the node. The 「编辑器」
 * method opens the host's source editor; saving there creates the object.
 *
 * The category ceiling is the deployment's web page limit
 * (`maxFileBytesFor`), the same bound the PocketBase hook enforces, so the zone
 * cannot disagree with the server. A rejected file and a failed write both
 * report here and to the host, which raises the toast: the import screen can be
 * replaced as soon as the node is written, so an inline line alone is not
 * always seen.
 */
function WebpageDropZone({
  nodeId,
  accept,
  onUploadStart,
  onUploaded,
  onUploadError,
  onEditSource,
  className,
}: FileDropZoneProps) {
  const { t } = useI18n();
  const limits = useStorageLimits();

  /** Rejection / failed write shown under the method cards. */
  const [actionError, setActionError] = useState<string | null>(null);
  /** Name of the library resource being referenced, shown while it is applied. */
  const [referencing, setReferencing] = useState<string | null>(null);
  /** Set while the 「从资源库选择」 dialog is open. */
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const config = VARIANT_CONFIG.webpage;
  const Icon = config.icon;

  /**
   * The node's freshest `content`, read when a write is built. The address and
   * the byte length are two halves of one write, so the update is awaited and
   * its failure reaches `onUploadError`.
   */
  const { liveContent } = useNodeContentWriter<Record<string, unknown>>(
    nodeId,
    "webpage",
    NO_LIVE_CONTENT,
  );

  const reportImportError = (message: string) => {
    setActionError(message);
    onUploadError?.(new Error(message));
  };

  /** Writes the stored address and the byte length onto the node. */
  const writeDocument = async (url: string, fileSize: number) => {
    await writeContentPatch(nodeId, liveContent(), {
      contentHalf: { url },
      meta: { fileSize },
    });
  };

  const { fileItems, uploadFiles, removeFileItem } = useFileUpload({
    // The pipeline's own ceiling; the category ceiling is checked below, where
    // the file name and MIME type are known.
    maxSize: MAX_UPLOAD_BYTES,
    limit: 1,
    accept,
    // Outlives this dialog: the key lets a reopened zone subscribe to the
    // upload that started before it unmounted.
    key: `${nodeId}:webpage`,
    upload: uploadFile,
    onSuccess: async (url, file) => {
      try {
        await writeDocument(url, file.size);
        onUploaded?.();
        showUploadSuccessToast(file);
      } catch (cause) {
        onUploadError?.(
          cause instanceof Error ? cause : new Error(t("写入节点失败")),
        );
      }
    },
    onError: (error) => onUploadError?.(error),
  });

  const handleFilesSelected = (files: File[]) => {
    setActionError(null);
    const file = files[0];
    if (!file) return;

    onUploadStart?.();

    if (!matchesAccept(file, accept)) {
      reportImportError(
        translate("不支持的文件类型：{value1}（期望 {value2}）", {
          value1: file.name,
          value2: accept,
        }),
      );
      return;
    }
    if (file.size === 0) {
      reportImportError(t("文件内容为空"));
      return;
    }

    // The deployment's own ceiling for this file's category (web page by
    // default), never a hard-coded size. Both sides are runtime policy.
    const limit = maxFileBytesFor(limits, file.name, file.type);
    if (file.size > limit) {
      reportImportError(
        translate("网页文件超过 {value1}MB，无法导入", {
          value1: Math.round(limit / 1024 / 1024),
        }),
      );
      return;
    }

    uploadFiles([file]);
  };

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) handleFilesSelected(files);
    // Let the same file be picked twice in a row.
    event.target.value = "";
  };

  /**
   * References a web page resource the user picked from the library.
   *
   * The node stores the resource's `storedUrl`, never its bytes — exactly what
   * the PDF variant does — so one resource can be shown by several nodes and
   * deleting it clears this node's address (the PocketBase delete hook rewrites
   * the record). No read, parse or copy happens here.
   */
  const handleResourceSelected = async (resource: ResourceRecord) => {
    setActionError(null);
    setReferencing(resource.name);
    onUploadStart?.();

    try {
      if (!resource.storedUrl) throw new Error(t("无法读取资源内容"));
      await writeDocument(resource.storedUrl, resource.fileSize);
      onUploaded?.();
      showUploadSuccessToast(resource);
    } catch (error) {
      onUploadError?.(
        error instanceof Error ? error : new Error(t("引用资源失败")),
      );
    } finally {
      setReferencing(null);
    }
  };

  if (fileItems.length === 0) {
    return (
      <>
        {referencing ? (
          <div
            className={cn(
              "w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/30 rounded-lg",
              config.minHeight,
              className,
            )}
          >
            <Icon className="size-10 text-muted-foreground" />
            <span className="max-w-full truncate px-4 text-sm">
              {referencing}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("正在应用资源…")}
            </span>
          </div>
        ) : (
          <>
            <Input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={accept}
              onChange={handleFileInputChange}
              // Not `display: none` (class `hidden`): WebKit refuses to open the
              // picker for an unrendered file input. The input must stay rendered
              // and only be made invisible, hence the off-screen 1px box.
              className="absolute -left-[9999px] h-px w-px overflow-hidden opacity-0"
            />

            <DropZoneSurface
              config={config}
              error={actionError}
              onDropFiles={handleFilesSelected}
              className={className}
            >
              <AddMethodCard
                icon={Code2Icon}
                tone={METHOD_TONES.edit}
                title={t("编辑器")}
                description={t("直接在编辑器中编写 HTML 或代码")}
                onSelect={() => onEditSource?.()}
              />
              <AddMethodCard
                icon={UploadIcon}
                tone={METHOD_TONES.local}
                title={t("文件上传")}
                description={t("导入本地 HTML 文件")}
                htmlFor={fileInputId}
                onActivate={() => fileInputRef.current?.click()}
              />
              <AddMethodCard
                icon={LibraryIcon}
                tone={METHOD_TONES.library}
                title={t("从资源库选择")}
                description={t("引用资源库中的网页")}
                onSelect={() => setResourcePickerOpen(true)}
              />
            </DropZoneSurface>
          </>
        )}

        <ResourceSelectorDialog
          open={resourcePickerOpen}
          onOpenChange={setResourcePickerOpen}
          accept={accept}
          onSelect={(resource) => {
            void handleResourceSelected(resource);
          }}
        />
      </>
    );
  }

  return (
    <div
      className={cn(
        "w-full h-full flex flex-col items-center justify-center gap-4",
        className,
      )}
    >
      {fileItems.map((item) => (
        <div key={item.id} className="w-full max-w-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm truncate">{item.file.name}</span>
            <button
              onClick={() => removeFileItem(item.id)}
              disabled={item.status === "success"}
              className="p-1 hover:bg-muted rounded-sm disabled:opacity-50 disabled:pointer-events-none"
            >
              <X className="size-4" />
            </button>
          </div>
          <Progress value={item.progress} />
          <span
            className="text-xs text-muted-foreground break-words"
            title={item.status === "error" ? item.error : undefined}
          >
            {item.status === "error"
              ? translate("上传失败：{value1}", {
                  value1: item.error ?? t("未知原因"),
                })
              : `${item.progress}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function FileDropZone(props: FileDropZoneProps) {
  useI18n();

  if (props.variant === "webpage") {
    return <WebpageDropZone {...props} />;
  }

  if (props.variant === "icon" || props.variant === "cover") {
    return <DisplayFieldDropZone {...props} variant={props.variant} />;
  }

  return <UploadDropZone {...props} variant={props.variant} />;
}

/**
 * The `icon` / `cover` variants of {@link FileDropZone}.
 *
 * Signature frozen by the main agent (`docs/plan/node-content-ui.md` §0-2) so
 * `SelectorUploadPane` can pass `variant="cover"`; **W1-B owns the body**: upload as
 * usual, then write only the top-level field —
 * `cover → { cover: { kind: "image", url } }`, `icon → { icon: { kind: "image", value: url } }`
 * — never `content`, and never `width` / `height` / `fileSize`.
 *
 * A branch of its own rather than a widening of {@link UploadDropZone} (plan
 * §M2.2-7): that component's `LocalVariant` constrains `buildNodeUpdates` to
 * the variants whose upload *is* the node's content, and reusing it would write
 * the picture into `content.url` — the one way this component can corrupt data
 * (sel §6.1).
 */
function DisplayFieldDropZone({
  nodeId,
  accept = "image/*",
  variant,
  onUploadStart,
  onUploaded,
  onUploadError,
  className,
}: FileDropZoneProps & { variant: DisplayVariant }) {
  const { t } = useI18n();

  /** Rejection / clipboard error shown under the method cards. */
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  /** Name of the library resource being referenced, shown while it is applied. */
  const [referencing, setReferencing] = useState<string | null>(null);
  /** Set while the 「从资源库选择」 dialog is open. */
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  const { fileItems, uploadFiles, removeFileItem } = useFileUpload({
    maxSize: MAX_UPLOAD_BYTES,
    limit: 1,
    accept: accept,
    // Keyed by the display field too: one node can mount the icon and the
    // cover zone at the same time.
    key: `${nodeId}:${variant}`,
    upload: uploadFile,
    onSuccess: async (url: string, file: File) => {
      try {
        // Only the top-level display field is written; `content` is not touched
        // at all (sel §6.1). Nothing is cleared before the upload, so a failed
        // write leaves whatever icon / cover the node already had.
        //
        // The icon half merges over the **live** value: sel §7 names 「换图但保留
        // 底色」 as one of the two partial updates that must not lose a field, so
        // the stored `color` survives an upload. `cover` needs no merge — its
        // `{kind:"image"}` variant carries no field beyond `url`, and spreading a
        // `{kind:"node"}` cover into it would produce an invalid union member.
        const liveIcon = useDataStore.getState().getNode(nodeId)?.icon;
        const updates: Partial<NodeData> =
          variant === "cover"
            ? { cover: { kind: "image", url } }
            : { icon: { ...liveIcon, kind: "image", value: url } };

        await NodeService.upsert(nodeId, updates);
        onUploaded?.();
        showUploadSuccessToast(file);
      } catch (error) {
        onUploadError?.(
          error instanceof Error ? error : new Error("Upload failed"),
        );
      }
    },
    onError: (error) => {
      onUploadError?.(error);
    },
  });

  const handleFilesSelected = (files: File[]) => {
    onUploadStart?.();
    uploadFiles(files);
  };

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) handleFilesSelected(files);
    // Let the same file be picked twice in a row.
    event.target.value = "";
  };

  const handlePasteImage = async () => {
    setActionError(null);
    try {
      const file = await readClipboardImage();
      if (!file) {
        setActionError(t("剪贴板中没有图片"));
        return;
      }
      handleFilesSelected([file]);
    } catch (cause) {
      const unavailable =
        cause instanceof Error && cause.message === "clipboard-unavailable";
      const message = unavailable
        ? t("当前浏览器不支持读取剪贴板，请改用「本地上传」")
        : t("粘贴图片失败（剪贴板权限被拒绝？）");
      setActionError(message);
      onUploadError?.(cause instanceof Error ? cause : new Error(message));
    }
  };

  /**
   * Writes a referenced library resource into the node's **top-level** display
   * field, exactly like the upload path above — never into `content`.
   *
   * The icon half merges over the live value so the stored colour survives; the
   * cover half carries only `url` (its `{kind:"image"}` union member has no other
   * field).
   */
  const handleResourceSelected = async (resource: ResourceRecord) => {
    onUploadStart?.();
    setReferencing(resource.name);

    try {
      const liveIcon = useDataStore.getState().getNode(nodeId)?.icon;
      const updates: Partial<NodeData> =
        variant === "cover"
          ? { cover: { kind: "image", url: resource.storedUrl } }
          : {
              icon: { ...liveIcon, kind: "image", value: resource.storedUrl },
            };

      await NodeService.upsert(nodeId, updates);
      onUploaded?.();
      showUploadSuccessToast(resource);
    } catch (error) {
      onUploadError?.(
        error instanceof Error ? error : new Error(t("引用资源失败")),
      );
    } finally {
      setReferencing(null);
    }
  };

  if (fileItems.length === 0) {
    return (
      <>
        {referencing ? (
          <div
            className={cn(
              "w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/30 rounded-lg",
              config.minHeight,
              className,
            )}
          >
            <Icon className="size-10 text-muted-foreground" />
            <span className="max-w-full truncate px-4 text-sm">
              {referencing}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("正在应用资源…")}
            </span>
          </div>
        ) : (
          <>
            <Input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={accept}
              onChange={handleFileInputChange}
              // Not `display: none` (class `hidden`): WebKit refuses to open the
              // picker for an unrendered file input. The input must stay rendered
              // and only be made invisible, hence the off-screen 1px box.
              className="absolute -left-[9999px] h-px w-px overflow-hidden opacity-0"
            />

            <DropZoneSurface
              config={config}
              error={actionError}
              onDropFiles={handleFilesSelected}
              className={className}
            >
              <AddMethodCard
                icon={UploadIcon}
                tone={METHOD_TONES.local}
                title={t("本地上传")}
                description={t("从当前设备选择文件")}
                htmlFor={fileInputId}
                onActivate={() => fileInputRef.current?.click()}
              />
              {/* Both variants only ever take a picture, so a pasted image is a
                  valid source (same reason `variant="image"` allows it). */}
              <AddMethodCard
                icon={ClipboardPasteIcon}
                tone={METHOD_TONES.paste}
                title={t("粘贴图片")}
                description={t("使用剪贴板中的图片")}
                onSelect={() => void handlePasteImage()}
              />
              <AddMethodCard
                icon={LibraryIcon}
                tone={METHOD_TONES.library}
                title={t("从资源库选择")}
                description={t("引用已上传的资源")}
                onSelect={() => setResourcePickerOpen(true)}
              />
            </DropZoneSurface>
          </>
        )}

        <ResourceSelectorDialog
          open={resourcePickerOpen}
          onOpenChange={setResourcePickerOpen}
          accept={accept}
          onSelect={(resource) => {
            void handleResourceSelected(resource);
          }}
        />
      </>
    );
  }

  return (
    <div
      className={cn(
        "w-full h-full flex flex-col items-center justify-center gap-4",
        className,
      )}
    >
      {fileItems.map((item) => (
        <div key={item.id} className="w-full max-w-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm truncate">{item.file.name}</span>
            <button
              onClick={() => removeFileItem(item.id)}
              disabled={item.status === "success"}
              className="p-1 hover:bg-muted rounded-sm disabled:opacity-50 disabled:pointer-events-none"
            >
              <X className="size-4" />
            </button>
          </div>
          <Progress value={item.progress} />
          <span
            className="text-xs text-muted-foreground break-words"
            title={item.status === "error" ? item.error : undefined}
          >
            {item.status === "error"
              ? translate("上传失败：{value1}", {
                  value1: item.error ?? t("未知原因"),
                })
              : `${item.progress}%`}
          </span>
        </div>
      ))}
    </div>
  );
}
