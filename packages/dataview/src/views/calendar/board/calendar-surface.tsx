// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The FullCalendar surface — the one place the library is instantiated.
 *
 * The shell drives it; nothing here knows about rows, cells or the host. Two
 * decisions are load-bearing:
 *
 * - **It is `memo`-wrapped on purpose.** FullCalendar's React wrapper applies
 *   `resetOptions` on *every* re-render (`componentDidUpdate`), and a changed
 *   option makes FullCalendar re-render its whole preact tree. The shell holds
 *   the hover readout in React state, so without the memo a
 *   mouse move over an event would re-render the calendar. Every prop here is
 *   therefore either a primitive, a memoized array/object, or a `useCallback`
 *   the shell keeps stable; the surface then only re-renders when the config or
 *   the data actually changed.
 * - **Views are switched imperatively.** `initialView` is read once at mount, so
 *   the shell calls `api.changeView` through {@link CalendarSurfaceProps.onApi}
 *   when `config.defaultView` changes — remounting the surface would throw away
 *   the date the user navigated to.
 *
 * Locale: FullCalendar resolves a locale *code* only if that locale is
 * registered, and this package ships exactly one (`zh-cn`). `en` is built into
 * the core; everything else falls back to `zh-cn`, so a hand-written config can
 * never crash the view with an unregistered locale.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { useI18n } from "@workspace/ui/lib/i18n";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import multimonthPlugin from "@fullcalendar/multimonth";
import timeGridPlugin from "@fullcalendar/timegrid";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn";
import type {
  CalendarApi,
  DayCellMountArg,
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventHoveringArg,
  EventMountArg,
  LocaleInput,
  PluginDef,
} from "@fullcalendar/core";
import type {
  DateClickArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction";

import type { CalendarViewConfig } from "@workspace/interfaces";

import { buttonTextFor, toFullCalendarView } from "../core/config";
import type { CalendarEventInput } from "../core/schema";

/** The five plugins the calendar's views need; no premium plugin is used. */
const DAY_CELL_CLASSES = ["group/calendar-day"];

const PLUGINS: PluginDef[] = [
  dayGridPlugin,
  timeGridPlugin,
  listPlugin,
  multimonthPlugin,
  interactionPlugin,
];

/** `zh-CN` / `en` are the two the toolbar offers; anything else is 中文. */
function resolveLocale(code: string): LocaleInput | string {
  return code === "en" ? "en" : zhCnLocale;
}

export interface CalendarSurfaceProps {
  events: CalendarEventInput[];
  /**
   * The `--fc-*` custom properties the shell puts on the calendar's wrapper.
   *
   * The surface needs them a second time: the drag mirror is appended to a host
   * of ours in `document.body` (see {@link CalendarSurface}'s mirror-host effect),
   * and that host is outside the wrapper's inheritance chain.
   */
  themeVars: Record<string, string>;
  /** Read only at mount; later changes go through `onApi` + `changeView`. */
  initialView: CalendarViewConfig["defaultView"];
  headerToolbar: CalendarViewConfig["headerToolbar"];
  firstDay: number;
  locale: string;
  /** Cell writes are allowed (a drag writes the date back). */
  editable: boolean;
  /** Row inserts are allowed (a drag over blank days creates one). */
  selectable: boolean;
  /**
   * A right-click on an event element.
   *
   * It is a mount hook rather than `eventContent` because FullCalendar's event
   * element is not a React node: a Radix context-menu trigger rendered *inside*
   * the event never sees the gesture (the browser's `contextmenu` target is the
   * library's own `<a class="fc-event">`, not the content we rendered into it).
   * The shell wires this to the shell-level record menu instead.
   */
  onEventContextMenu?: (rowId: string, point: { x: number; y: number }) => void;

  /** Reports the live `CalendarApi` (and `null` on unmount). */
  onApi: (api: CalendarApi | null) => void;
  onEventDrop: (arg: EventDropArg) => void;
  onEventResize: (arg: EventResizeDoneArg) => void;
  onSelectRange: (arg: DateSelectArg) => void;
  onDateDoubleClick: (arg: DateClickArg) => void;
  onAddDate: (date: Date) => void;
  onEventClick: (arg: EventClickArg) => void;
  onEventMouseEnter: (arg: EventHoveringArg) => void;
  onEventMouseLeave: () => void;
  onDatesSet: (arg: DatesSetArg) => void;
}

/**
 * Hangs the unified record menu off one event element.
 *
 * FullCalendar owns the event DOM and the browser's `contextmenu` target is the
 * library's own `<a class="fc-event">`, so a Radix trigger rendered into
 * `eventContent` never fires; a native listener here does. Kept at module scope
 * so the JSX stays a one-line prop.
 */
function attachEventContextMenu(
  arg: EventMountArg,
  onContextMenu: (rowId: string, point: { x: number; y: number }) => void,
): void {
  const extended = arg.event.extendedProps as { rowId?: string };
  const rowId =
    typeof extended.rowId === "string" ? extended.rowId : arg.event.id;
  arg.el.addEventListener("contextmenu", (event: MouseEvent) => {
    event.preventDefault();
    onContextMenu(rowId, { x: event.clientX, y: event.clientY });
  });
}

export const CalendarSurface = memo(function CalendarSurface({
  events,
  themeVars,
  initialView,
  headerToolbar,
  firstDay,
  locale,
  editable,
  selectable,
  onEventContextMenu,
  onApi,
  onEventDrop,
  onEventResize,
  onSelectRange,
  onDateDoubleClick,
  onAddDate,
  onEventClick,
  onEventMouseEnter,
  onEventMouseLeave,
  onDatesSet,
}: CalendarSurfaceProps) {
  /**
   * The body-level host the drag mirror is appended to.
   *
   * FullCalendar draws the mirror as a `position: fixed` clone of the event
   * element and appends it to the closest `.fc` — its own root — unless
   * `fixedMirrorParent` says otherwise. Inside a **transformed ancestor** that
   * root *is* the mirror's containing block: the node content is routinely
   * mounted in the node editor's `-translate-x-1/2 -translate-y-1/2` dialog, so
   * the dragged chip trailed the pointer by the dialog's own page offset
   * (measured: panel at `120, 86`, the mirror at `959, 552` where the pointer
   * asked for `839, 467`; in a plain host it sat exactly on the drag delta). A
   * host in `document.body` is in the viewport's coordinate space, which is the
   * space `left`/`top` were computed in.
   *
   * It is a host of ours rather than bare `<body>` because the mirror is a clone
   * of the event chip: a colourless event's fill *is* `--fc-event-bg-color`
   * (`buildEventUiStyle` writes nothing inline), so the wrapper's `--fc-*`
   * overrides have to reach the host or the chip turns FullCalendar's built-in
   * blue for the length of the drag. A zero-size, untransformed box at the
   * viewport origin carries them without affecting where the mirror lands.
   */
  const { t } = useI18n();
  const nextCellKey = useRef(0);
  const cellCleanup = useRef(new WeakMap<HTMLElement, () => void>());
  const [dayCells, setDayCells] = useState<
    Array<DayCellMountArg & { portalKey: number }>
  >([]);
  const handleDayMount = useCallback((arg: DayCellMountArg) => {
    if (!arg.el.querySelector(".fc-daygrid-day-bottom")) return;
    const measureChip = () => {
      const chip =
        arg.el.querySelector<HTMLElement>(".fc-daygrid-event") ??
        arg.el.closest(".fc")?.querySelector<HTMLElement>(".fc-daygrid-event");
      const height = chip?.getBoundingClientRect().height;
      if (height)
        arg.el.style.setProperty("--calendar-add-height", `${height}px`);
    };
    arg.el.addEventListener("mouseenter", measureChip);
    cellCleanup.current.set(arg.el, () =>
      arg.el.removeEventListener("mouseenter", measureChip),
    );
    const portalKey = nextCellKey.current++;
    setDayCells((cells) => [...cells, { ...arg, portalKey }]);
  }, []);
  const handleDayUnmount = useCallback((arg: DayCellMountArg) => {
    cellCleanup.current.get(arg.el)?.();
    cellCleanup.current.delete(arg.el);
    setDayCells((cells) => cells.filter((cell) => cell.el !== arg.el));
  }, []);

  const [mirrorHost, setMirrorHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const host = document.createElement("div");
    host.dataset.dataviewCalendarMirrorHost = "";
    host.style.position = "absolute";
    host.style.top = "0px";
    host.style.left = "0px";
    host.style.width = "0px";
    host.style.height = "0px";
    document.body.appendChild(host);
    setMirrorHost(host);
    return () => {
      host.remove();
      setMirrorHost(null);
    };
  }, []);

  useEffect(() => {
    if (!mirrorHost) return;
    for (const [name, value] of Object.entries(themeVars)) {
      mirrorHost.style.setProperty(name, value);
    }
  }, [mirrorHost, themeVars]);

  const handleRef = useCallback(
    (instance: FullCalendar | null) => {
      onApi(instance ? instance.getApi() : null);
    },
    [onApi],
  );

  return (
    <>
      <FullCalendar
        ref={handleRef}
        plugins={PLUGINS}
        initialView={toFullCalendarView(initialView)}
        headerToolbar={headerToolbar}
        // The calendar fills the pane the shell hands it (`CALENDAR_FIXED.height`
        // is "auto"), so 100% is what "automatic" means here.
        height="100%"
        locale={resolveLocale(locale)}
        buttonText={buttonTextFor(locale)}
        firstDay={firstDay}
        timeZone="local"
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        editable={editable}
        eventResizableFromStart
        selectable={selectable}
        selectMirror
        // The rest is presentation and fixed (see `CALENDAR_FIXED`): weekend
        // columns, the "now" line, and folding a busy day behind "+N more".
        weekends
        nowIndicator
        dayMaxEvents
        navLinks={false}
        dayHeaders
        dayCellClassNames={DAY_CELL_CLASSES}
        dayCellDidMount={handleDayMount}
        dayCellWillUnmount={handleDayUnmount}
        events={events}
        // Applied on the calendar's own `resetOptions` after the first commit; a
        // drag cannot happen before that.
        {...(mirrorHost ? { fixedMirrorParent: mirrorHost } : {})}
        {...(onEventContextMenu
          ? {
              eventDidMount: (arg: EventMountArg) =>
                attachEventContextMenu(arg, onEventContextMenu),
            }
          : {})}
        eventDrop={onEventDrop}
        eventResize={onEventResize}
        select={onSelectRange}
        dateClick={onDateDoubleClick}
        eventClick={onEventClick}
        eventMouseEnter={onEventMouseEnter}
        eventMouseLeave={onEventMouseLeave}
        datesSet={onDatesSet}
      />
      {selectable &&
        dayCells.map((cell) => {
          const container = cell.el.querySelector<HTMLElement>(
            ".fc-daygrid-day-bottom",
          );
          if (!container) return null;
          return createPortal(
            <Button
              type="button"
              variant="ghost"
              aria-label={`${t("添加记录")} ${cell.date.toLocaleDateString(locale)}`}
              className="relative z-6 mt-px flex h-5 w-full rounded-[3px] border border-dashed px-0 py-0 text-muted-foreground opacity-0 pointer-events-none shadow-none transition-opacity group-hover/calendar-day:opacity-100 group-hover/calendar-day:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto"
              style={{
                height: "var(--calendar-add-height, 20px)",
                borderColor: "var(--fc-event-border-color)",
                backgroundColor:
                  "color-mix(in oklab, var(--fc-event-bg-color) 50%, transparent)",
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAddDate(cell.date);
              }}
            >
              <Plus className="size-3.5" />
            </Button>,
            container,
            cell.portalKey,
          );
        })}
    </>
  );
});
