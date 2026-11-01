// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counter fixture's manifest id.
 *
 * The node type (`server/`) and the UI descriptors (`ui/`) both name it, and
 * neither may import the other's entry: a browser bundle must not pull the
 * server entry in, so the shared constant lives in its own module here.
 */
export const counterPluginId = "dbrainx.counter";
