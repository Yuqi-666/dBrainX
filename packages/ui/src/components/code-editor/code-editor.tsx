// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "next-themes";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Languages the editor can highlight, in picker order.
 *
 * Any node type that stores source can render its own picker from this list and
 * feed the chosen `id` straight back into {@link CodeEditor}.
 */
export const CODE_LANGUAGES = [
  { id: "html", label: "HTML" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "css", label: "CSS" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "xml", label: "XML" },
  { id: "sql", label: "SQL" },
  { id: "python", label: "Python" },
  {
    id: "text",
    get label() {
      return translate("纯文本");
    },
  },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["id"];

/** Source-file extension → the language id the editor highlights with. */
const EXTENSION_LANGUAGES: Record<string, CodeLanguage> = {
  html: "html",
  htm: "html",
  xhtml: "html",
  vue: "html",
  svelte: "html",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  py: "python",
  txt: "text",
};

/**
 * Best-effort language for an imported file.
 *
 * Lives here rather than at the import site so every caller that loads source
 * from a file maps extensions identically.
 */
export function languageFromFilename(filename: string): CodeLanguage {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGES[extension] ?? "text";
}

/** Maps a stored language id onto the matching CodeMirror language support. */
function extensionsFor(language: string): Extension[] {
  switch (language) {
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    case "xml":
      return [xml()];
    case "sql":
      return [sql()];
    case "python":
      return [python()];
    case "text":
      return [];
    case "html":
    default:
      return [html()];
  }
}

export interface CodeEditorProps {
  /** Current document text; the editor is fully controlled. */
  value: string;
  /** Language id from {@link CODE_LANGUAGES}. */
  language: string;
  onChange?: (value: string) => void;
  /** Shown while the document is empty. */
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

/**
 * Shared CodeMirror 6 wrapper for any node type that stores source.
 *
 * CodeMirror measures the DOM on mount, so a plain `<pre>` is rendered until
 * the component is mounted client-side; that keeps the shared UI package safe
 * to server-render inside the Next.js apps.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  placeholder,
  readOnly = false,
  className,
}: CodeEditorProps) {
  useI18n();

  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const extensions = useMemo(() => extensionsFor(language), [language]);
  const theme = useMemo(
    () => (resolvedTheme === "dark" ? oneDark : "light"),
    [resolvedTheme],
  );

  if (!mounted) {
    return (
      <pre
        className={cn(
          "h-full overflow-auto rounded-md bg-muted/30 p-3 font-mono text-xs leading-relaxed",
          className,
        )}
      >
        <code>{value}</code>
      </pre>
    );
  }

  return (
    <CodeMirror
      value={value}
      theme={theme}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      placeholder={placeholder}
      height="100%"
      className={cn(
        "h-full overflow-hidden rounded-md text-xs",
        "[&_.cm-editor]:h-full [&_.cm-editor.cm-focused]:outline-none",
        className,
      )}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
      }}
      onChange={(next) => onChange?.(next)}
    />
  );
}
