// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The island's geometry, as numbers.
 *
 * Everything here is pure and import-free on purpose. The morph is expressed as
 * a *box* plus two ratios, and the only way to keep that honest is to make the
 * math callable without a DOM — `geometry.test.ts` runs it under `node --test`.
 *
 * Three quantities:
 *
 * - `resolveGeometry` — a form's authored numbers, the live viewport and the
 *   measured pill → the box the capsule is actually rendered at. The viewport
 *   caps are resolved *numerically* (`min(440, 52vh)`), so a short window
 *   produces a smaller authored box and the content reflows inside it instead of
 *   being squashed into it. A `"content"` form takes *both* axes from the
 *   measurement, because the pill is the one box the content authors.
 * - `proximity` — how far the live box is from a form, as a **symmetric** ratio
 *   (`1` = arrived). One number drives the content swap in both directions,
 *   which is why the content changes *with* the motion rather than alongside it.
 * - `layerOpacity` / `layerScale` — a layer's presentation, derived from that
 *   number and the live box.
 */

/** A box in CSS pixels. */
export interface Box {
  readonly w: number;
  readonly h: number;
}

/** A box plus the corner radius to render it with. */
export interface Geometry extends Box {
  readonly radius: number;
}

/** The viewport, in CSS pixels. */
export interface Viewport {
  readonly w: number;
  readonly h: number;
}

/** A form's authored size. `"content"` means "as wide as the content needs". */
export interface BoxSpec {
  readonly width: number | "content";
  readonly height: number;
  /** Share of the viewport height this form may occupy, or `null` for none. */
  readonly maxHeightRatio: number | null;
  /** `9999` is the "fully round" sentinel; the resolver clamps it to a pill. */
  readonly radius: number;
}

/** The proximity interval a dissolve runs over. `to` is nearer the target. */
export interface Fade {
  readonly from: number;
  readonly to: number;
}

/** Which side of a swap a layer is on. */
export type LayerSide = "in" | "out";

/**
 * How one side of a move gives the capsule up to the other, as **proximity** —
 * never as a duration, which is what makes the content change *with* the
 * geometry instead of alongside it (see `timingOf` in `tuning.ts`).
 *
 * These are the island's three real timings, not three spellings of one: a body
 * can already hold the capsule (`"done"`), take it at the instant the box
 * crosses a point (`at`), or dissolve into it over a stretch (`Fade`).
 */
export type Handover = "done" | { readonly at: number } | Fade;

/** One direction of travel's hand-over, per side. */
export type HandoverPair = Readonly<Record<LayerSide, Handover>>;

/** The gutter an expanded form may never cross, on both sides together. */
export const VIEWPORT_GUTTER = 32;

const MIN_SIZE = 1;

export function resolveGeometry(
  form: BoxSpec,
  viewport: Viewport,
  pill: Box,
): Geometry {
  // A `"content"` form **is** the pill, so both of its axes come from the
  // measurement: the row's width, and the height that row actually needs. A
  // coarse pointer grows every nav item to a 44px touch target, and the pill has
  // to grow with it — `form.height` is a *floor*, not the size.
  const authored =
    form.width === "content" ? Math.max(MIN_SIZE, pill.w) : form.width;
  const w = clamp(
    MIN_SIZE,
    Math.max(MIN_SIZE, viewport.w - VIEWPORT_GUTTER),
    authored,
  );
  const cap =
    form.width === "content"
      ? Math.max(form.height, pill.h)
      : form.maxHeightRatio === null
        ? form.height
        : Math.min(form.height, viewport.h * form.maxHeightRatio);
  const h = Math.max(MIN_SIZE, cap);

  return {
    w,
    h,
    // Half the shorter side is both the pill the sentinel means and a value a
    // spring can interpolate.
    radius: Math.min(form.radius, Math.min(w, h) / 2),
  };
}

/**
 * How far `box` is from `target`, as a ratio that reads as distance in either
 * direction (`1` = arrived, larger = further).
 *
 * It is deliberately **not** symmetric under swapping its arguments: the ratio
 * is taken on the binding axis, and which axis binds depends on which box is
 * being measured. Expanding from the pill therefore starts at `11` (height
 * binds: 40/440) while collapsing back to it starts at `4.21` (width binds:
 * 560/133). That is a property of the measurement, not a bug — and it is why the
 * hand-over windows are directional (see `forms.ts`).
 */
export function proximity(box: Box, target: Box): number {
  const k = Math.min(box.w / target.w, box.h / target.h);
  return k >= 1 ? k : 1 / k;
}

/**
 * A layer's opacity, as a function of {@link proximity}, its side and the
 * hand-over this move was given.
 *
 * `in` owns the capsule once the box has arrived, `out` owns it until it has —
 * *when* that trade happens is the whole of the island's content timing, and it
 * is the only thing the three {@link Handover} cases say.
 */
export function layerOpacity(
  distance: number,
  side: LayerSide,
  handover: Handover,
): number {
  const incoming = side === "in";

  if (handover === "done") return incoming ? 1 : 0;

  if ("at" in handover) {
    const switched = distance < handover.at;
    return switched === incoming ? 1 : 0;
  }

  const t = clamp01((distance - handover.to) / (handover.from - handover.to));
  return incoming ? 1 - t : t;
}

/**
 * A layer's scale: the authored frame is laid out at the form's own size and
 * transformed onto the live capsule.
 *
 * Uniform, and never above `1` — the capsule's aspect changes during a morph
 * (133×40 ⇄ 560×440) and a per-axis fit would squash the content exactly as much
 * as the box squashes itself, while a form that is leaving must never be blown
 * up to fill a larger capsule.
 */
export function layerScale(form: BoxSpec, authored: Box, box: Box): number {
  const vertical = Math.min(1, box.h / authored.h);
  // A `"content"` form *is* its own width, so there is nothing to fit it
  // against; it still scales down vertically, which keeps it in proportion with
  // a capsule collapsing around it.
  return form.width === "content"
    ? vertical
    : Math.min(1, box.w / authored.w, vertical);
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(0, 1, value);
}
