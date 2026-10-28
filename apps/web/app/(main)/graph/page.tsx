// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/graph` — the graph surface.
 *
 * The surface itself is rendered by `WorkspaceShell` in `(main)/layout.tsx`, which
 * stays mounted across `/graph` ⇄ `/dashboard`; this route exists so that the URL,
 * a deep link, a refresh and the island's `href` all still name the surface. It
 * renders nothing on purpose — see `components/workspace-shell.tsx`.
 */
export default function GraphPage() {
  return null;
}
