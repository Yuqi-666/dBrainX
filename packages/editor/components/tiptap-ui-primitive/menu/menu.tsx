// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as Ariakit from "@ariakit/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";

// -- Hooks --
import { useOnClickOutside } from "@workspace/editor/hooks/use-on-click-outside";
import { useComposedRef } from "@workspace/editor/hooks/use-composed-ref";

// -- Utils --
import { cn } from "@workspace/editor/lib/tiptap-utils";

// -- UI Primitives --
import {
  ComboboxItem,
  ComboboxProvider,
} from "@workspace/editor/components/tiptap-ui-primitive/combobox";

// -- Local imports --
import type {
  MenuProps,
  MenuContentProps,
  MenuItemProps,
} from "@workspace/editor/components/tiptap-ui-primitive/menu";
import {
  SearchableContext,
  MenuContext,
  useSearchableContext,
  useMenuContext,
} from "@workspace/editor/components/tiptap-ui-primitive/menu";
import {
  useMenuPlacement,
  useMenuItemClick,
} from "@workspace/editor/components/tiptap-ui-primitive/menu";

// -- Styles --
import "@workspace/editor/components/tiptap-ui-primitive/menu/menu.scss";

export function MenuProvider({ ...props }: Ariakit.MenuProviderProps) {
  return <Ariakit.MenuProvider {...props} />;
}

export function Menu({
  children,
  trigger,
  value,
  onOpenChange,
  onValueChange,
  onValuesChange,
  ...props
}: MenuProps) {
  const isRootMenu = !Ariakit.useMenuContext();
  const [open, setOpen] = useState<boolean>(false);
  const searchable = !!onValuesChange || isRootMenu;

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (props.open === undefined) {
        setOpen(v);
      }
      onOpenChange?.(v);
    },
    [props.open, onOpenChange],
  );

  const menuContextValue = useMemo(
    () => ({
      isRootMenu,
      open: props.open ?? open,
    }),
    [isRootMenu, props.open, open],
  );

  const menuProvider = (
    <Ariakit.MenuProvider
      open={open}
      setOpen={handleOpenChange}
      setValues={onValuesChange}
      showTimeout={100}
      {...props}
    >
      {trigger}
      <MenuContext.Provider value={menuContextValue}>
        <SearchableContext.Provider value={searchable}>
          {children}
        </SearchableContext.Provider>
      </MenuContext.Provider>
    </Ariakit.MenuProvider>
  );

  if (searchable) {
    return (
      <ComboboxProvider value={value} setValue={onValueChange}>
        {menuProvider}
      </ComboboxProvider>
    );
  }

  return menuProvider;
}

/**
 * Escape belongs to the innermost layer — but Radix and Ariakit keep separate
 * layer stacks, so this menu has to claim the key itself.
 *
 * Ariakit answers this layer's Escape from a `document` capture listener, and so
 * does a Radix modal around the editor (the node-editor dialog). Both are
 * `document` capture, so the winner is whichever registered first — the dialog —
 * and it only asks whether another **Radix** layer sits above it. This Ariakit
 * layer is invisible there, so 「Esc closes the block menu」 used to close the
 * dialog with it (measured: probe ⑧ in `/tmp/probe/inner-check`).
 *
 * Radix skips its own dismissal when the key already arrives `defaultPrevented`
 * (`@radix-ui/react-dismissable-layer` → `useEscapeKeydown`), and this listener
 * sits on `window` capture — which every `document` listener follows, whatever
 * the registration order — so claiming the key here hides this menu exactly as
 * before and leaves the dialog open. Ariakit's own listener then sees
 * `defaultPrevented` and stands down, so the hide below is the only one.
 *
 * The key is claimed only when it is aimed at this layer, using Ariakit's own
 * rule: the focused target is the body, sits inside this menu, or sits inside the
 * button that disclosed it. Anything else (a Radix layer stacked above this menu,
 * say) keeps the key.
 */
export function MenuContent({
  children,
  className,
  ref,
  onClickOutside,
  style,
  ...props
}: MenuContentProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { open } = useMenuContext();
  const side = useMenuPlacement();
  const menuStore = Ariakit.useMenuContext();

  useOnClickOutside(menuRef, onClickOutside || (() => {}));

  const hideOnEscape = props.hideOnEscape;
  const hideOnInteractOutsideProp = props.hideOnInteractOutside;

  /**
   * A modal host steals hover focus back — and that is not "clicked outside".
   *
   * While the node-editor dialog is up, Radix keeps a trapped `FocusScope` in
   * `DialogContent`: on `focusout` it re-focuses the last element it saw focused
   * *inside* the dialog whenever focus lands *outside* it. Our menus portal to
   * `body` (the block drag menu, the table handle menus), so the moment a hovered
   * item takes focus — `useMenuItem` → `useCompositeHover` → `baseElement.focus()`
   * — that focus is outside the dialog and Radix pulls it straight back to the
   * grip within the same tick.
   *
   * A popup reads a `focusin` that lands outside itself as "the pointer went
   * somewhere else" (`useHideOnInteractOutside` → document capture) and hides. So
   * on that restore an open submenu closed the instant you hovered one of its own
   * items, and — a level up — hovering any item of the parent menu closed the
   * submenu that the trigger had just opened, whose hover timer then re-opened it:
   * one closed/open cycle per mouse move, which the CSS (`[data-state="closed"]
   * { display: none }` + the 150ms open animation) turns into a visible blink.
   * Measured against the real editor in the real dialog, 8 mousemoves over the
   * trigger: 8 `closed` + 8 `open`, and the pointer could never reach the submenu
   * (`/tmp/probe/reach-check.mjs`).
   *
   * Focus anywhere in *this* menu chain is therefore not an outside interaction:
   * this popup, or the popup / the disclosing button of any ancestor menu. That is
   * exactly the element Radix restores focus to. Everything else — a click, focus
   * somewhere genuinely else, a context menu — still hides as before, and an
   * explicit `hideOnInteractOutside` from the caller still wins.
   */
  const hideOnInteractOutside = useCallback(
    (event: Event | SyntheticEvent) => {
      if (typeof hideOnInteractOutsideProp === "function") {
        return hideOnInteractOutsideProp(event);
      }
      if (hideOnInteractOutsideProp === false) return false;

      if (event.type === "focusin" && menuStore) {
        const target = event.target;
        if (target instanceof Node) {
          let store: Ariakit.MenuStore | null | undefined = menuStore;
          while (store) {
            const { contentElement, disclosureElement } = store.getState();
            if (
              contentElement?.contains(target) ||
              disclosureElement?.contains(target)
            ) {
              return false;
            }
            store = store.parent;
          }
        }
      }

      return true;
    },
    [menuStore, hideOnInteractOutsideProp],
  );

  useEffect(() => {
    if (!open || !menuStore) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      const { contentElement, disclosureElement } = menuStore.getState();
      const isOurs =
        target === document.body ||
        Boolean(contentElement?.contains(target)) ||
        !disclosureElement ||
        disclosureElement.contains(target);
      if (!isOurs) return;

      if (typeof hideOnEscape === "function" && !hideOnEscape(event)) return;
      if (hideOnEscape === false) return;

      event.preventDefault();
      menuStore.hideAll();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, menuStore, hideOnEscape]);

  /**
   * A portaled layer has to declare itself interactive. While a modal layer is
   * up, Radix writes `pointer-events: none` on `document.body` (and `auto` on its
   * own topmost layer), so a layer portalled to `body` inherits that shield —
   * which is why, inside the node-editor dialog, every click on an Ariakit menu
   * (the block drag menu, the table handle menus, the AI menu) used to land on
   * the dialog overlay instead: the menu item never ran and the click counted as
   * "outside" the dialog (measured: probe ⑦b in `/tmp/probe/inner-check`). `auto`
   * is exactly what Radix writes on its own topmost layer, and outside such a
   * host it changes nothing.
   */
  const menuStyle: CSSProperties = { pointerEvents: "auto", ...style };

  return (
    <Ariakit.Menu
      ref={useComposedRef(menuRef, ref)}
      className={cn("tiptap-menu-content", className)}
      data-side={side}
      data-state={open ? "open" : "closed"}
      gutter={4}
      flip
      unmountOnHide
      style={menuStyle}
      {...props}
      hideOnInteractOutside={hideOnInteractOutside}
    >
      {children}
    </Ariakit.Menu>
  );
}

export function MenuList({ className, ...props }: Ariakit.MenuListProps) {
  return (
    <Ariakit.MenuList
      data-slot="tiptap-menu-list"
      className={cn("tiptap-menu-list", className)}
      {...props}
    />
  );
}

export function MenuButton({ className, ...props }: Ariakit.MenuButtonProps) {
  return (
    <Ariakit.MenuButton
      {...props}
      className={cn("tiptap-menu-button", className)}
    />
  );
}

export function MenuButtonArrow({
  className,
  ...props
}: Ariakit.MenuButtonArrowProps) {
  return (
    <Ariakit.MenuButtonArrow
      {...props}
      className={cn("tiptap-menu-button-arrow", className)}
    />
  );
}

export function MenuArrow({ className, ...props }: Ariakit.MenuArrowProps) {
  return (
    <Ariakit.MenuArrow
      data-slot="tiptap-menu-arrow"
      className={cn("tiptap-menu-arrow", className)}
      {...props}
    />
  );
}

export function MenuHeading({ className, ...props }: Ariakit.MenuHeadingProps) {
  return (
    <Ariakit.MenuHeading
      data-slot="tiptap-menu-heading"
      className={cn("tiptap-menu-heading", className)}
      {...props}
    />
  );
}

export function MenuDescription({
  className,
  ...props
}: Ariakit.MenuDescriptionProps) {
  return (
    <Ariakit.MenuDescription
      data-slot="tiptap-menu-description"
      className={cn("tiptap-menu-description", className)}
      {...props}
    />
  );
}

export function MenuDismiss({ className, ...props }: Ariakit.MenuDismissProps) {
  return (
    <Ariakit.MenuDismiss
      data-slot="tiptap-menu-dismiss"
      className={cn("tiptap-menu-dismiss", className)}
      {...props}
    />
  );
}

export function MenuGroup({ className, ...props }: Ariakit.MenuGroupProps) {
  return (
    <Ariakit.MenuGroup
      {...props}
      className={cn("tiptap-menu-group", className)}
    />
  );
}

export function MenuGroupLabel({
  className,
  ...props
}: Ariakit.MenuGroupLabelProps) {
  return (
    <Ariakit.MenuGroupLabel
      {...props}
      className={cn("tiptap-menu-group-label", className)}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: Ariakit.MenuSeparatorProps) {
  return (
    <Ariakit.MenuSeparator
      data-slot="tiptap-menu-separator"
      className={cn("tiptap-menu-separator", className)}
      {...props}
    />
  );
}

export function MenuItemCheck({
  className,
  ...props
}: Ariakit.MenuItemCheckProps) {
  return (
    <Ariakit.MenuItemCheck
      {...props}
      className={cn("tiptap-menu-item-check", className)}
    />
  );
}

export function MenuItemCheckbox({
  className,
  ...props
}: Ariakit.MenuItemCheckboxProps) {
  return (
    <Ariakit.MenuItemCheckbox
      data-slot="tiptap-menu-item-checkbox"
      className={cn("tiptap-menu-item-checkbox", className)}
      {...props}
    />
  );
}

export function MenuItemRadio({
  className,
  ...props
}: Ariakit.MenuItemRadioProps) {
  return (
    <Ariakit.MenuItemRadio
      {...props}
      className={cn("tiptap-menu-item-radio", className)}
    />
  );
}

export function MenuItem({
  name,
  value,
  preventClose,
  className,
  ...props
}: MenuItemProps) {
  const menu = Ariakit.useMenuContext();
  const searchable = useSearchableContext();

  const hideOnClick = useMenuItemClick(menu, preventClose);

  const itemProps: MenuItemProps = {
    blurOnHoverEnd: false,
    focusOnHover: true,
    className: cn("tiptap-menu-item", className),
    ...props,
  };

  if (!searchable) {
    if (name && value) {
      return (
        <MenuItemRadio
          {...itemProps}
          hideOnClick={true}
          name={name}
          value={value}
        />
      );
    }

    return <Ariakit.MenuItem {...itemProps} />;
  }

  return <ComboboxItem {...itemProps} hideOnClick={hideOnClick} />;
}
