// SPDX-License-Identifier: AGPL-3.0-only

import { useI18n } from "@workspace/ui/lib/i18n";
import "katex/dist/katex.min.css";
import katex from "katex";
import { useEffect, useRef, useState, useCallback } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@workspace/editor/components/tiptap-ui-primitive/popover";
import { TextareaAutosize } from "@workspace/editor/components/tiptap-ui-primitive/textarea-autosize";
import { cn } from "@workspace/editor/lib/tiptap-utils";

export default function LatexInlineView(props: NodeViewProps) {
  const { t } = useI18n();

  const { node, updateAttributes, editor, getPos, selected } = props;
  const mathResultContainer = useRef<HTMLSpanElement>(null);
  const mathPreviewContainer = useRef<HTMLSpanElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const renderLatex = useCallback(
    (katexString: string, container: HTMLSpanElement | null) => {
      try {
        katex.render(katexString, container!);
        setError(null);
      } catch (e) {
        if (e instanceof Error) {
          setError(e.message);
        }
      }
    },
    [],
  );

  useEffect(() => {
    renderLatex(node.attrs.text, mathResultContainer.current);
  }, [node.attrs.text, renderLatex]);

  useEffect(() => {
    if (isEditing) {
      renderLatex(preview || "", mathPreviewContainer.current);
    } else if (preview !== null) {
      queueMicrotask(() => {
        updateAttributes({ text: preview.trim() });
      });
    }
  }, [preview, isEditing, renderLatex, updateAttributes]);

  const wasSelected = useRef(false);

  const checkEmptyAndDelete = useCallback(() => {
    if (typeof getPos !== "function") return;

    const currentText =
      previewRef.current !== null ? previewRef.current : node.attrs.text;

    if (!currentText.trim()) {
      try {
        const pos = getPos();
        if (pos === undefined) return;
        editor
          .chain()
          .deleteRange({ from: pos, to: pos + node.nodeSize })
          .focus(pos)
          .run();
      } catch {
        // 忽略报错
      }
    }
  }, [editor, getPos, node.attrs.text, node.nodeSize]);

  // 1. Tiptap 状态监听：处理创建与失去焦点
  useEffect(() => {
    const isNowSelected = !!selected;

    // 失去焦点时：关闭编辑框并清理空节点
    if (wasSelected.current && !isNowSelected) {
      setIsEditing(false);
      checkEmptyAndDelete();
    }

    // 获得焦点时
    if (!wasSelected.current && isNowSelected) {
      setPreview(node.attrs.text);

      // 核心判断：如果内容为空，说明一定是刚创建的节点！
      if (!node.attrs.text.trim()) {
        setIsEditing(true);
      }
    }

    wasSelected.current = isNowSelected;
  }, [selected, node.attrs.text, checkEmptyAndDelete]);

  // 2. 快捷键监听：处理方向键进入后按下 Enter 键弹出编辑框
  useEffect(() => {
    if (selected && !isEditing && editor.isEditable) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          setIsEditing(true);
        }
      };
      const dom = editor.view.dom;
      dom.addEventListener("keydown", handleKeyDown, true);
      return () => dom.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [selected, isEditing, editor]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setIsEditing(false);
      wasSelected.current = false;
      checkEmptyAndDelete();
    }
  };

  const open = isEditing && editor.isEditable;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <NodeViewWrapper
          as="span"
          data-katex="true"
          onClick={() => {
            // 点击直接打开编辑框
            if (editor.isEditable) setIsEditing(true);
          }}
          className={cn(
            "inline-block whitespace-pre-wrap break-words rounded px-1 mx-0.5 select-none transition-colors duration-200 cursor-pointer",
            selected && "ProseMirror-selectednode",
            error && "text-red-8 bg-red-0",
            ((isEditing && !preview?.trim().length) ||
              (!isEditing && !node.attrs.text.trim().length)) &&
              "text-gray-6 bg-gray-0",
          )}
        >
          <span
            style={{ display: isEditing ? undefined : "none" }}
            ref={mathPreviewContainer}
          ></span>
          <span
            style={{ display: isEditing ? "none" : undefined }}
            ref={mathResultContainer}
          ></span>
          {((isEditing && !preview?.trim().length) ||
            (!isEditing && !node.attrs.text.trim().length)) && (
            <span className="text-muted-foreground/60 italic text-sm">
              {t("Empty")}{" "}
            </span>
          )}
          {error && (
            <span className="text-red-500 text-sm">{t("Invalid")}</span>
          )}
        </NodeViewWrapper>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        className="z-[101] w-[400px] p-0 overflow-hidden rounded-xl border border-border shadow-lg bg-background"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => {
            textareaRef.current?.focus();
          }, 0);
        }}
      >
        <div className="flex flex-col">
          <div className="flex items-center px-3 py-1.5 border-b border-border bg-muted/30">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t("Inline Equation")}{" "}
            </span>
          </div>

          <div className="p-2.5 bg-muted/10">
            <TextareaAutosize
              ref={textareaRef}
              minRows={1}
              maxRows={5}
              draggable={false}
              value={preview ?? ""}
              placeholder={"E = mc^2"}
              className="w-full min-h-[50px] resize-none border-0 bg-transparent p-1 text-sm font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/50 placeholder:font-sans focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              onKeyDown={(e) => {
                const pos = getPos();
                if (pos === undefined) return;
                if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  return editor.commands.focus(pos + node.nodeSize);
                }

                const target = e.target as HTMLTextAreaElement;
                const valueLength = target.value?.length ?? 0;

                if (
                  e.key === "ArrowLeft" &&
                  selection.start === selection.end &&
                  selection.start === 0
                ) {
                  editor.commands.focus(pos);
                }

                if (
                  e.key === "ArrowRight" &&
                  selection.start === selection.end &&
                  selection.start === valueLength
                ) {
                  editor.commands.focus(pos + node.nodeSize);
                }
              }}
              onSelect={(e) => {
                const target = e.target as HTMLTextAreaElement;
                setSelection({
                  start: target.selectionStart ?? 0,
                  end: target.selectionEnd ?? 0,
                });
              }}
              onChange={(e) => {
                const target = e.target as HTMLTextAreaElement;
                setPreview(target.value);
                setSelection({
                  start: target.selectionStart ?? 0,
                  end: target.selectionEnd ?? 0,
                });
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
