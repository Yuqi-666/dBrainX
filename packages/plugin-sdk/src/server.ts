// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Server-only helpers.
 *
 * This is the only entry that may import a Node builtin. The browser entries
 * (`.`, `./ui`, `./types`) must never reach this file, so keep it out of their
 * import graph.
 */

import { createHash } from "node:crypto"

/**
 * Deterministic `uuidv5` for event ids (§4.5.2: `uuidv5(aggregateId|updated|
 * eventType|payloadHash|runKey)`), implemented with `node:crypto` so no
 * third-party UUID package is added. RFC 4122 name-based UUID, version 5
 * (SHA-1), variant RFC 4122.
 */

/** RFC 4122 namespace: fully-qualified domain names. */
export const UUID_NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
/** RFC 4122 namespace: URLs. */
export const UUID_NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"
/** RFC 4122 namespace: ISO object identifiers. */
export const UUID_NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8"
/** RFC 4122 namespace: X.500 distinguished names. */
export const UUID_NAMESPACE_X500 = "6ba7b814-9dad-11d1-80b4-00c04fd430c8"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * RFC 4122 version 5 UUID of `name` in `namespace`.
 *
 * The same `(namespace, name)` pair always yields the same id, which is what
 * lets the event log de-duplicate a compensation replay on `eventId`.
 */
export function uuidv5(
  name: string,
  namespace: string = UUID_NAMESPACE_URL,
): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("uuidv5: `name` must be a non-empty string")
  }
  const namespaceBytes = parseUuid(namespace)
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
  input.set(namespaceBytes, 0)
  input.set(nameBytes, namespaceBytes.length)

  const hash = createHash("sha1").update(input).digest()
  // Version 5 in the high nibble of time_hi_and_version, RFC 4122 variant in
  // the two most significant bits of clock_seq_hi_and_reserved.
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

function parseUuid(uuid: string): Uint8Array {
  if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) {
    throw new TypeError(`uuidv5: namespace "${String(uuid)}" is not a UUID`)
  }
  const hex = uuid.replace(/-/g, "")
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
