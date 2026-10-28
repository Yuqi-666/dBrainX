// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Geometry for the table-of-contents highlight.
 *
 * Kept as a pure function outside the sidebar so it can be tested without a
 * DOM: the sidebar says where the reading line is, this decides which heading
 * the reader is in.
 */

/** One heading, already measured against the scroll container. */
export interface TocScrollAnchor {
  id: string;
  /** Heading top, in the same coordinate space as the reading line. */
  top: number;
}

/**
 * The last heading that has scrolled past the reading line.
 *
 * Headings arrive in document order, so the last one at or above the line is
 * the section currently being read. Before any heading reaches the line — a
 * document scrolled to the very top — there is no answer, and the caller falls
 * back to the first heading.
 */
export function resolveScrollActiveHeadingId(
  headings: readonly TocScrollAnchor[],
  readingLine: number,
): string | null {
  let activeId: string | null = null;
  for (const heading of headings) {
    if (heading.top <= readingLine) {
      activeId = heading.id;
    }
  }
  return activeId;
}
