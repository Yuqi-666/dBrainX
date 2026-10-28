// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copies the pdf.js CMap and standard-font trees into the client apps.
 *
 * Run before a build or a dev server (the app scripts and scripts/dev-run.mjs
 * do it); the destination directories are generated and not tracked by Git.
 *
 *   node scripts/copy-pdfjs-assets.mjs            both apps
 *   node scripts/copy-pdfjs-assets.mjs web        one app
 */
import {
  PDFJS_ASSET_APPS,
  copyPdfjsAssets,
  countPdfjsAssets,
} from "./lib/pdfjs-assets.mjs";

const requested = process.argv.slice(2);
const apps = requested.length > 0 ? requested : PDFJS_ASSET_APPS;

for (const app of apps) {
  const destination = await copyPdfjsAssets(app);
  const counts = await countPdfjsAssets(app);
  console.log(
    "[pdfjs] " +
      counts.cmaps +
      " cmaps + " +
      counts.standard_fonts +
      " standard fonts + " +
      counts.worker +
      " patched worker -> " +
      destination,
  );
}
