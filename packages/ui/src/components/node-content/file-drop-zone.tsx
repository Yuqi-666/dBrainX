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
import { attachMediaFile } from "@workspace/ui/lib/media-attach";
import { Input } from "@workspace/ui/components/ui/input";
import { ResourceSelectorDialog } from "@workspace/ui/components/selector/resource-selector";
import { Progress } from "@workspace/ui/components/ui/progress";
import { toast } from "@workspace/ui/components/ui/toast";
import {
  MAX_UPLOAD_BYTES,
  matchesAccept,
  useFileUpload,
  useStorageLimits,
  uploadAttachment,
  uploadFile,
  cancelMediaImport,
  confirmMediaImport,
  importMedia,
  mediaImportJob,
  resourceIdFromStoredUrl,
} from "@workspace/api-client";
import type { ImportedMedia, MediaImportJob } from "@workspace/api-client";
import { maxFileBytesFor } from "@workspace/utils/storage-limits";
import type { ResourceRecord } from "@workspace/api-client";
import { NodeService } from "@workspace/services";
import { useDataStore } from "@workspace/store";
import type {
  MediaImportProgress,
  MediaKind,
  TimestampData,
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
 * Shapes frozen by the main agent (`docs/plan/node-content-ui.md` §0-2).
 */
type DisplayVariant = "icon" | "cover";

/** Base for the shared writer when the store has no live node to read. */
const NO_LIVE_CONTENT: Record<string, unknown> = {};

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
   * The node's freshest `content`.
   *
   * Every write of this zone is an operation now, so this is read for one
   * thing: the base the import's subtitle cues merge onto
   * ({@link timestampsAfterImport}).
   */
  const { liveContent } = useNodeContentWriter<Record<string, unknown>>(
    nodeId,
    variant,
    NO_LIVE_CONTENT,
  );

  /**
   * Writes one finished import onto the node.
   *
   * The import has already stored the file, so the write is the same
   * `*.attachFile` an upload uses: the server reads the address, cover, HLS
   * playlist and measurements off the stored record, and the client names only
   * the file and the page it came from. `source: "online"` is what tells the
   * player and the resource panel that this is not a local file; `sourceUrl` is
   * the canonical page.
   *
   * The subtitle / lyric cues the import carries are merged after the user's own
   * notes ({@link timestampsAfterImport}) and written as the timeline operation.
   *
   * The title is a fallback, never a replacement: it is adopted with a second
   * write only when the node has no title yet, because the user's own title
   * always wins.
   */
  const writeImportedMedia = async (imported: ImportedMedia) => {
    const uploadId = resourceIdFromStoredUrl(imported.url);
    if (uploadId === "") {
      throw new Error(t("导入结果没有已存储的文件"));
    }
    // The server reads the stored file's address, cover, rendition and
    // measurements; the client names the file and the page it came from.
    await NodeService.invokeTypeOperation(`${variant}.attachFile`, nodeId, {
      uploadId,
      source: "online",
      sourceUrl: imported.sourceUrl,
    });
    // The subtitle / lyric track is node content the import result carries, so
    // it lands as the timeline operation after the file is attached.
    await NodeService.invokeTypeOperation(`${variant}.setTimeline`, nodeId, {
      timestamps: timestampsAfterImport(liveContent(), imported.subtitle),
    });

    const liveTitle = useDataStore.getState().nodes.get(nodeId)?.title ?? "";
    const title = (imported.title || imported.fileName).trim();
    if (title !== "" && liveTitle.trim() === "") {
      await NodeService.setTitle(nodeId, title);
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
    /**
     * Stores the bytes, then attaches them through this type's own operation
     * (plan item 41).
     *
     * The operation takes `{ uploadId }` — the id of the stored upload result —
     * and the server reads that result to fill the file address, size, duration
     * and page count. Nothing about the file is measured or assembled here, so
     * there is no per-type branch left: the type only picks the operation
     * (`media-attach.ts`). Returning the url *after* the attach is what makes
     * `useFileUpload` report a refused attach as a failed upload, with the
     * operation's code in the item's error line, and leaves the node untouched.
     */
    upload: async (file, onProgress, signal) => {
      const attachment = await uploadAttachment(file, onProgress, signal);
      const outcome = await attachMediaFile({
        nodeId,
        mediaType: variant,
        uploadId: attachment.id,
      });
      if (!outcome.ok) {
        // The server's message already starts with the code; only a client-side
        // refusal (a type with no operation) has to have it added.
        const detail = outcome.message.startsWith(`${outcome.code}:`)
          ? outcome.message
          : `${outcome.code}: ${outcome.message}`;
        throw new Error(detail);
      }
      return attachment.url;
    },
    onSuccess: (_url, file) => {
      onUploaded?.();
      showUploadSuccessToast(file);
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
   * It is the same write as an upload: `*.attachFile` with the resource's record
   * id, and the server writes the address, cover, HLS playlist and measurements
   * it reads off the record. The node stores the resource's address, never its
   * bytes.
   */
  const handleResourceSelected = async (resource: ResourceRecord) => {
    onUploadStart?.();
    setReferencing(resource.name);

    try {
      if (resource.storedUrl === "") throw new Error(t("无法读取资源内容"));
      // A library resource is a stored file, exactly like an upload: the
      // attach operation reads its address, cover, rendition and measurements
      // off the record, so the client sends the record id and nothing else.
      await NodeService.invokeTypeOperation(`${variant}.attachFile`, nodeId, {
        uploadId: resource.id,
      });

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

  const reportImportError = (message: string) => {
    setActionError(message);
    onUploadError?.(new Error(message));
  };

  /**
   * Attaches a stored web page document through `webpage.attachFile`.
   *
   * The operation takes the id of the stored upload result and the server reads
   * the address and the byte length off it, so neither is assembled here.
   */
  const writeDocument = async (uploadId: string) => {
    await NodeService.invokeTypeOperation("webpage.attachFile", nodeId, {
      uploadId,
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
    upload: async (file, onProgress, signal) => {
      const attachment = await uploadAttachment(file, onProgress, signal);
      await writeDocument(attachment.id);
      return attachment.url;
    },
    onSuccess: async (_url, file) => {
      try {
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
      await writeDocument(resource.id);
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
 * §M2.2-7): that component attaches every upload as the node's content, and
 * routing a display field through it would write the picture into
 * `content.url` — the one way this component can corrupt data (sel §6.1).
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
        if (variant === "cover") {
          await NodeService.setCover(nodeId, { kind: "image", url });
        } else {
          await NodeService.setIcon(nodeId, {
            ...liveIcon,
            kind: "image",
            value: url,
          });
        }
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
      if (variant === "cover") {
        await NodeService.setCover(nodeId, {
          kind: "image",
          url: resource.storedUrl,
        });
      } else {
        await NodeService.setIcon(nodeId, {
          ...liveIcon,
          kind: "image",
          value: resource.storedUrl,
        });
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
