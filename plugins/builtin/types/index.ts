// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin plugin's node content types.
 *
 * `shared/` holds the shapes more than one type embeds (annotations, timelines);
 * `single/` and `complex/` mirror the former `packages/interfaces` split.
 */

export * from "./shared/annotation.ts";
export * from "./shared/timestamp-data.ts";
export * from "./single/text.ts";
export * from "./single/image.ts";
export * from "./single/pdf.ts";
export * from "./single/video.ts";
export * from "./single/audio.ts";
export * from "./single/webpage.ts";
export * from "./single/website.ts";
export * from "./complex/collection.ts";
export * from "./complex/rich-text.ts";
export * from "./complex/database.ts";
