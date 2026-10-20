// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { HTMLAttributes } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Editor } from "@tiptap/react";
import {
  flip,
  offset,
  shift,
  useMergeRefs,
  type UseFloatingOptions,
} from "@floating-ui/react";
import { Selection } from "@tiptap/pm/state";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";
import { useFloatingElement } from "@workspace/editor/hooks/use-floating-element";

// --- Lib ---
import { isShieldedByInnerLayer } from "@workspace/ui/lib/inner-layer";
import {
  getSelectionBoundingRect,
  isSelectionValid,
} from "@workspace/editor/lib/tiptap-collab-utils";

import {
  isElementWithinEditor,
  isElementWithinExternalPortal,
} from "@workspace/editor/components/tiptap-ui-utils/floating-element";
import { isValidPosition } from "@workspace/editor/lib/tiptap-utils";

export interface FloatingElementProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The Tiptap editor instance to attach to.
   */
  editor?: Editor | null;
  /**
   * Controls whether the floating element should be visible.
   * @default undefined
   */
  shouldShow?: boolean;
  /**
   * Additional options to pass to the floating UI.
   */
  floatingOptions?: Partial<UseFloatingOptions>;
  /**
   * Z-index for the floating element.
   * @default 50
   */
  zIndex?: number;
  /**
   * Callback fired when the visibility state changes.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Reference element to position the floating element relative to.
   * If provided, this takes precedence over getBoundingClientRect.
   */
  referenceElement?: HTMLElement | null;
  /**
   * Custom function to determine the position of the floating element.
   * Only used if referenceElement is not provided.
   * @default getSelectionBoundingRect
   */
  getBoundingClientRect?: (editor: Editor) => DOMRect | null;
  /**
   * Whether to close the floating element when Escape key is pressed.
   * @default true
   */
  closeOnEscape?: boolean;
  /**
   * Whether to reset the text selection when the floating element is closed or clicked outside the editor.
   * @default true
   */
  resetTextSelectionOnClose?: boolean;
}

/**
 * A floating UI element that positions itself relative to the current selection in a Tiptap editor.
 * Used for floating toolbars, menus, and other UI elements that need to appear near the text cursor.
 */
export const FloatingElement = forwardRef<HTMLDivElement, FloatingElementProps>(
  (
    {
      editor: providedEditor,
      shouldShow = undefined,
      floatingOptions,
      zIndex = 50,
      onOpenChange,
      referenceElement,
      getBoundingClientRect = getSelectionBoundingRect,
      closeOnEscape = true,
      resetTextSelectionOnClose = true,
      children,
      style: propStyle,
      ...props
    },
    forwardedRef,
  ) => {
    const [open, setOpen] = useState<boolean>(
      shouldShow !== undefined ? shouldShow : false,
    );

    const floatingElementRef = useRef<HTMLDivElement | null>(null);
    const preventHideRef = useRef(false);
    const preventShowRef = useRef(false);
    const editorRef = useRef<Editor | null>(null);
    const getBoundingClientRectRef = useRef(getBoundingClientRect);

    const { editor } = useTiptapEditor(providedEditor);

    // Keep refs up to date
    useEffect(() => {
      editorRef.current = editor;
      getBoundingClientRectRef.current = getBoundingClientRect;
    }, [editor, getBoundingClientRect]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        onOpenChange?.(newOpen);
        setOpen(newOpen);
      },
      [onOpenChange],
    );

    const handleFloatingOpenChange = useCallback(
      (open: boolean) => {
        if (!open && editor && resetTextSelectionOnClose) {
          // When the floating element closes, reset the selection.
          // This lets the user place the cursor again and ensures the drag handle reappears,
          // as it's intentionally hidden during valid text selections.
          const tr = editor.state.tr.setSelection(
            Selection.near(editor.state.doc.resolve(0)),
          );
          editor.view.dispatch(tr);
        }

        handleOpenChange(open);
      },
      [editor, resetTextSelectionOnClose, handleOpenChange],
    );

    /**
     * Whether a layer above this element had taken the pointer when the in-flight
     * gesture started — see {@link isShieldedByInnerLayer}.
     *
     * Sampled on the capture pass, because the layer that owns the gesture (a
     * dropdown opened from this toolbar) dismisses itself from a `document`
     * bubble listener: by the time floating-ui asks `outsidePress`, the shield is
     * already gone and a live read would answer "nobody is above me" — which is
     * exactly the reported bug, where the click that collapsed the dropdown also
     * took the whole toolbar (and the text selection) with it.
     */
    const shieldedAtPointerDown = useRef(false);
    useEffect(() => {
      const snapshot = () => {
        shieldedAtPointerDown.current = isShieldedByInnerLayer(
          floatingElementRef.current,
        );
      };
      window.addEventListener("pointerdown", snapshot, true);
      return () => window.removeEventListener("pointerdown", snapshot, true);
    }, []);

    /**
     * Escape, answered here rather than by floating-ui's own `escapeKey`.
     *
     * floating-ui closes on any Escape while this element is open, and its
     * listener sits on `document`, i.e. behind the toolbar's dropdowns in the
     * capture path: the dropdown dismisses itself first, then floating-ui sees an
     * un-shielded element and tears the toolbar down as well. Reading the shield
     * on the **window capture** pass answers before any layer can dismiss
     * anything, so the innermost layer keeps the first Escape — the same rule
     * Radix layers already follow inside the node-editor dialog.
     *
     * An Escape aimed at the editor itself is left to the editor's own
     * `closeOnEscape` listener below, which closes without touching the
     * selection.
     */
    useEffect(() => {
      if (!editor || !open || !closeOnEscape) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (isShieldedByInnerLayer(floatingElementRef.current)) return;

        const target = event.target as Node | null;
        if (target && isElementWithinEditor(editor, target)) return;

        handleFloatingOpenChange(false);
      };

      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [editor, open, closeOnEscape, handleFloatingOpenChange]);

    // Use referenceElement if provided, otherwise create dynamic rect function
    const reference = useMemo(() => {
      if (referenceElement) {
        return referenceElement;
      }

      return () => {
        if (!editorRef.current) return null;
        return getBoundingClientRectRef.current(editorRef.current);
      };
    }, [referenceElement]);

    const { isMounted, ref, style, getFloatingProps } = useFloatingElement(
      open,
      reference,
      zIndex,
      {
        placement: "top",
        middleware: [shift(), flip(), offset(4)],
        onOpenChange: handleFloatingOpenChange,
        dismissOptions: {
          enabled: true,
          // Escape is answered by the shield-aware window listener above.
          escapeKey: false,
          outsidePress(event) {
            const relatedTarget = event.target as Node;
            if (!relatedTarget) return false;

            // The gesture started while a layer above this one had taken the
            // pointer: that is how the toolbar's own dropdown collapses, not a
            // reason to close the toolbar itself.
            if (shieldedAtPointerDown.current) return false;

            // Don't close if clicking inside a portaled UI
            if (isElementWithinExternalPortal(relatedTarget)) return false;

            return !isElementWithinEditor(editor, relatedTarget);
          },
        },
        ...floatingOptions,
      },
    );

    const updateSelectionState = useCallback(() => {
      if (!editor) return;

      const newRect = getBoundingClientRect(editor);

      if (newRect && shouldShow !== undefined && !preventShowRef.current) {
        handleOpenChange(shouldShow);
        return;
      }

      const shouldShowResult = isSelectionValid(editor);

      if (
        newRect &&
        !preventShowRef.current &&
        (shouldShowResult || preventHideRef.current)
      ) {
        handleOpenChange(true);
      } else if (
        !preventHideRef.current &&
        (!shouldShowResult || preventShowRef.current || !editor.isEditable)
      ) {
        handleOpenChange(false);
      }
    }, [editor, getBoundingClientRect, handleOpenChange, shouldShow]);

    // Escape aimed at the editor itself: closes without resetting the selection
    // (the window-capture listener above defers to this one for those events and
    // covers everything else).
    useEffect(() => {
      if (!editor || !closeOnEscape) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && open) {
          handleOpenChange(false);
          return true;
        }
        return false;
      };

      editor.view.dom.addEventListener("keydown", handleKeyDown);
      return () => {
        editor.view.dom.removeEventListener("keydown", handleKeyDown);
      };
    }, [editor, open, closeOnEscape, handleOpenChange]);

    useEffect(() => {
      if (!editor) return;

      const handleBlur = (event: FocusEvent) => {
        if (preventHideRef.current) {
          preventHideRef.current = false;
          return;
        }

        const relatedTarget = event.relatedTarget as Node;
        if (!relatedTarget) return;

        const isWithinEditor = isElementWithinEditor(editor, relatedTarget);

        const floatingElement = floatingElementRef.current;
        const isWithinFloatingElement =
          floatingElement &&
          (floatingElement === relatedTarget ||
            floatingElement.contains(relatedTarget));

        // Don't close if focus moved to a portaled UI
        const isWithinExternalPortal =
          isElementWithinExternalPortal(relatedTarget);

        if (
          !isWithinEditor &&
          !isWithinFloatingElement &&
          !isWithinExternalPortal &&
          open
        ) {
          handleOpenChange(false);
        }
      };

      editor.view.dom.addEventListener("blur", handleBlur);
      return () => {
        editor.view.dom.removeEventListener("blur", handleBlur);
      };
    }, [editor, handleOpenChange, open]);

    useEffect(() => {
      if (!editor) return;

      const handleDrag = () => {
        if (open) {
          handleOpenChange(false);
        }
      };

      editor.view.dom.addEventListener("dragstart", handleDrag);
      editor.view.dom.addEventListener("dragover", handleDrag);

      return () => {
        editor.view.dom.removeEventListener("dragstart", handleDrag);
        editor.view.dom.removeEventListener("dragover", handleDrag);
      };
    }, [editor, open, handleOpenChange]);

    useEffect(() => {
      if (!editor) return;

      const handleMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;

        preventShowRef.current = true;

        const { state, view } = editor;
        const posCoords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });

        if (!posCoords || !isValidPosition(posCoords.pos)) return;

        const $pos = state.doc.resolve(posCoords.pos);
        const nodeBefore = $pos.nodeBefore;

        if (!nodeBefore || nodeBefore.isBlock) return;

        const tr = state.tr.setSelection(
          Selection.near(state.doc.resolve(posCoords.pos)),
        );
        view.dispatch(tr);
      };

      const handleMouseUp = () => {
        if (preventShowRef.current) {
          preventShowRef.current = false;
          updateSelectionState();
        }
      };

      editor.view.dom.addEventListener("mousedown", handleMouseDown);
      editor.view.root.addEventListener("mouseup", handleMouseUp);

      return () => {
        editor.view.dom.removeEventListener("mousedown", handleMouseDown);
        editor.view.root.removeEventListener("mouseup", handleMouseUp);
      };
    }, [editor, updateSelectionState]);

    useEffect(() => {
      if (!editor) return;

      editor.on("selectionUpdate", updateSelectionState);

      return () => {
        editor.off("selectionUpdate", updateSelectionState);
      };
    }, [editor, updateSelectionState]);

    useEffect(() => {
      if (!editor) return;
      updateSelectionState();
    }, [editor, updateSelectionState]);

    const finalStyle = useMemo(
      () =>
        propStyle && Object.keys(propStyle).length > 0 ? propStyle : style,
      [propStyle, style],
    );
    const mergedRef = useMergeRefs([ref, forwardedRef, floatingElementRef]);

    if (!editor || !isMounted || !open) return null;

    return (
      <div
        ref={mergedRef}
        style={finalStyle}
        {...props}
        {...getFloatingProps()}
      >
        {children}
      </div>
    );
  },
);

FloatingElement.displayName = "FloatingElement";
