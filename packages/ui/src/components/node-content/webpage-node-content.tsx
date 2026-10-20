// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Loader2Icon, Pencil, RotateCcwIcon, Save } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IAttachment, WebpageNodeData } from "@workspace/interfaces";
import { NodeService } from "@workspace/services";
import {
  getPocketbaseClient,
  readAuthSessionToken,
  replaceAttachment,
  resolveFileUrl,
  uploadAttachment,
} from "@workspace/api-client";
import { isHtmlDocument, storedFileName } from "@workspace/utils/node-content";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  CodeEditor,
  languageFromFilename,
} from "@workspace/ui/components/code-editor/code-editor";
import { toast } from "@workspace/ui/components/ui/toast";
import { FileDropZone } from "./file-drop-zone";

/** Types the picker accepts: a web page node holds an HTML document. */
const DOCUMENT_ACCEPT = ".html,.htm,.xhtml,text/html";

interface WebpageNodeContentProps {
  node: WebpageNodeData;
  className?: string;
}

/** Which surface the node shows once it has a document. */
type SourceView = "preview" | "edit";

/** What the stored document reads back as. */
interface StoredSource {
  text: string | null;
  error: string | null;
  loading: boolean;
}

const EMPTY_SOURCE: StoredSource = { text: null, error: null, loading: false };

/**
 * The token a direct file read sends.
 *
 * The PocketBase download hook rejects a superuser and authorizes a user token;
 * the browser keeps the web session in a cookie, which an explicit `fetch` must
 * turn into an `Authorization` header. The desktop keeps its token in the
 * PocketBase auth store. Same credentials the upload writes use.
 */
function readFileToken(): string {
  const token =
    process.env.NEXT_PUBLIC_DBRAIN_PLATFORM === "desktop"
      ? getPocketbaseClient().authStore?.token
      : readAuthSessionToken();
  return token ?? "";
}

/** Reads the stored document as text, for the preview and the source editor. */
async function fetchStoredSource(storedUrl: string): Promise<string> {
  if (!storedUrl) throw new Error("No stored document");
  const token = readFileToken();
  const response = await fetch(
    resolveFileUrl(storedUrl),
    token ? { headers: { Authorization: token } } : undefined,
  );
  if (!response.ok) throw new Error(`The stored document could not be read (${response.status})`);
  return response.text();
}

/** A stored name derived from the node title, for a document created here. */
function documentNameFor(node: WebpageNodeData): string {
  const stem = (node.title || "")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${stem || "webpage"}.html`;
}

/**
 * Node content editor for `webpage` nodes.
 *
 * A webpage node is a stored web page: the document's bytes live in the object
 * store (the resource library), and the node keeps only the address and the
 * byte length, exactly like a `pdf` node keeps a PDF. This editor therefore
 * never writes the document into the record. It renders the stored object in a
 * sandboxed iframe, and when the user edits the source it reads the object
 * back, edits in memory and saves it as a stored file again (replacing the
 * node's own resource in place when the user owns it, otherwise storing a new
 * one and pointing the node at it).
 *
 * An empty node is the drop zone: upload a local HTML file, reference one
 * already in the resource library, or open the editor and write the first
 * document. A live address belongs to a `website` node and a screenshot is an
 * `image`, so neither is offered here.
 */
export function WebpageNodeContent({
  node,
  className,
}: WebpageNodeContentProps) {
  const { t } = useI18n();

  const url = (node.content?.url ?? "").trim();
  const hasDocument = url.length > 0;
  const storedName = storedFileName(url);
  const language = storedName
    ? languageFromFilename(storedName)
    : ("html" as const);
  const rendersAsPage = hasDocument ? isHtmlDocument(url) : true;

  /**
   * The view the user asked for. `null` follows the stored document: an HTML
   * object opens as a page and a source file opens in the editor.
   */
  const [requestedView, setRequestedView] = useState<SourceView | null>(null);
  const view: SourceView =
    requestedView ?? (rendersAsPage ? "preview" : "edit");

  const [source, setSource] = useState<StoredSource>(EMPTY_SOURCE);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  /**
   * The address we just wrote ourselves. The stored text is already in hand, so
   * the reader must not download the document again right after a save.
   */
  const skipNextFetch = useRef<string | null>(null);

  // Reading the document is enabled for both surfaces: the preview renders its
  // text (the file route is not a page route) and the editor needs it.
  useEffect(() => {
    if (!url) {
      setSource(EMPTY_SOURCE);
      setDraft("");
      return;
    }
    if (skipNextFetch.current === url) {
      skipNextFetch.current = null;
      return;
    }

    let cancelled = false;
    setSource({ text: null, error: null, loading: true });
    fetchStoredSource(url)
      .then((text) => {
        if (cancelled) return;
        setSource({ text, error: null, loading: false });
        setDraft(text);
      })
      .catch(() => {
        if (cancelled) return;
        // A network or authorization failure has no useful browser message;
        // the inline surface names the failure in the UI language instead.
        setSource({ text: null, error: t("加载网页失败"), loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadToken, t]);

  const storedText = source.text ?? "";
  const dirty = hasDocument && storedText !== draft;

  /**
   * Saves the edited source back into the object store.
   *
   * The node owns a stored file, so a save replaces that file in place and
   * keeps one storage unit — the same rule the Excalidraw preview follows. A
   * node that references someone else's resource (a teammate's library file, a
   * file this user cannot update) falls back to storing a new object and
   * pointing the node at it, so the save never depends on that resource's
   * permissions.
   */
  const save = useCallback(async () => {
    if (saving) return;
    if (!hasDocument && draft.trim().length === 0) return;

    setSaving(true);
    try {
      const storedFileNameForSave = storedName || documentNameFor(node);
      const file = new File([draft], storedFileNameForSave, {
        type: rendersAsPage ? "text/html" : "text/plain",
      });
      const recordId = storedUrlRecordId(url);

      let attachment: IAttachment | null = null;
      if (recordId) {
        try {
          attachment = await replaceAttachment(recordId, file);
        } catch {
          // Not this user's resource (or it was deleted): store a new object.
          attachment = null;
        }
      }
      if (!attachment) attachment = await uploadAttachment(file);

      // The text we already hold is what the new address will read back as, so
      // the next render must not download it again.
      skipNextFetch.current = attachment.url;
      setSource({ text: draft, error: null, loading: false });

      await NodeService.upsert(node.id, {
        content: { url: attachment.url },
        fileSize: attachment.fileSize,
      });

      // The node now has a document: leave the initialization surface on the
      // preview if it is a page, or keep editing if it is source.
      setRequestedView(rendersAsPage ? "preview" : "edit");
      toast({ title: t("已保存") });
    } catch (cause) {
      toast({
        title: t("无法保存网页"),
        description:
          cause instanceof Error && cause.message
            ? cause.message
            : t("保存失败，请稍后重试"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [draft, hasDocument, node, rendersAsPage, saving, storedName, t, url]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (view === "edit" && !saving) void save();
    }
  };

  // No document yet: the drop zone is the whole surface, except while the user
  // is writing the first document in the editor.
  if (!hasDocument && view !== "edit") {
    return (
      <div className={cn("relative h-full min-h-[380px] p-4", className)}>
        <FileDropZone
          nodeId={node.id}
          accept={DOCUMENT_ACCEPT}
          variant="webpage"
          onEditSource={() => setRequestedView("edit")}
          onUploaded={() => setRequestedView(null)}
          onUploadError={(error) => {
            toast({
              title: t("导入文件失败"),
              description: error.message,
              variant: "destructive",
            });
          }}
          className="h-full w-full"
        />
      </div>
    );
  }

  const loading = source.loading && !dirty;
  const loadError = source.error;

  return (
    <div
      className={cn("flex h-full min-h-[380px] flex-col gap-2 p-4", className)}
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-wrap items-center gap-2">
        {hasDocument && (
          <div className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5">
            <ViewTab
              active={view === "preview"}
              icon={Eye}
              label={t("预览")}
              onClick={() => setRequestedView("preview")}
            />
            <ViewTab
              active={view === "edit"}
              icon={Pencil}
              label={t("编辑")}
              onClick={() => setRequestedView("edit")}
            />
          </div>
        )}

        {view === "edit" ? (
          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <span className="text-xs text-muted-foreground">
                {t("未保存")}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 px-2 text-xs"
              disabled={saving || (!dirty && hasDocument)}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {t("保存")}
            </Button>
            {!hasDocument && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 px-2 text-xs"
                disabled={saving}
                onClick={() => {
                  setDraft("");
                  setRequestedView(null);
                }}
              >
                <RotateCcwIcon className="size-3.5" />
                {t("返回")}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
        {view === "edit" ? (
          loading ? (
            <LoadingSurface />
          ) : loadError ? (
            <LoadFailure
              message={loadError}
              onRetry={() => setReloadToken((token) => token + 1)}
            />
          ) : (
            <CodeEditor
              value={draft}
              language={language}
              placeholder={t("在此编写 HTML 或代码…")}
              onChange={setDraft}
              className="size-full"
            />
          )
        ) : loading ? (
          <LoadingSurface />
        ) : loadError ? (
          <LoadFailure
            message={loadError}
            onRetry={() => setReloadToken((token) => token + 1)}
          />
        ) : rendersAsPage ? (
          <iframe
            title={node.title || t("HTML 预览")}
            srcDoc={storedText}
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            className="size-full border-0 bg-white"
          />
        ) : (
          <CodeEditor
            value={storedText}
            language={language}
            readOnly
            className="size-full"
          />
        )}
      </div>
    </div>
  );
}

/** The recorded file id in a stored address, or `""` when there is none. */
function storedUrlRecordId(storedUrl: string): string {
  const match = /\/api\/files\/[A-Za-z0-9_]+\/([A-Za-z0-9]+)\//.exec(storedUrl);
  return match ? match[1]! : "";
}

/** A spinner shown while the stored document is read. */
function LoadingSurface() {
  const { t } = useI18n();
  return (
    <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
      {t("正在加载网页…")}
    </div>
  );
}

/** The read failure and the one action that helps: read again. */
function LoadFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="max-w-md text-sm break-words text-muted-foreground">
        {message}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t("重试")}
      </Button>
    </div>
  );
}

/** Preview / edit switch for the stored document. */
function ViewTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  useI18n();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
