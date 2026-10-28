// SPDX-License-Identifier: AGPL-3.0-only

/** A page-local anchor survives fixed gutters, auto margins and mixed page sizes. */
export interface PdfZoomAnchor {
  page: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Do not clamp: a cursor in a gutter still has a meaningful page-relative point. */
export function pdfAnchorPoint(
  rect: PageRect,
  clientX: number,
  clientY: number,
) {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  };
}

export function pdfAnchorDelta(
  anchor: PdfZoomAnchor,
  rect: PageRect,
  origin: { x: number; y: number },
) {
  return {
    x: rect.left + anchor.x * rect.width - origin.x - anchor.offsetX,
    y: rect.top + anchor.y * rect.height - origin.y - anchor.offsetY,
  };
}

/** Re-anchor against a zoom still queued for the next frame, using its page point. */
export function pdfReanchorPending(
  anchor: PdfZoomAnchor,
  rect: PageRect,
  currentScale: number,
  offsetX: number,
  offsetY: number,
): PdfZoomAnchor {
  const ratio = anchor.scale / currentScale;
  return {
    ...anchor,
    x: anchor.x + (offsetX - anchor.offsetX) / (rect.width * ratio),
    y: anchor.y + (offsetY - anchor.offsetY) / (rect.height * ratio),
    offsetX,
    offsetY,
  };
}
