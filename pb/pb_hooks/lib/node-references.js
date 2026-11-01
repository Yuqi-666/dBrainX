// SPDX-License-Identifier: AGPL-3.0-only

// Node references to a stored blob, and their cleanup.
//
// Deleting a `files` row deletes the bytes, so every node that points at those
// bytes has to lose the link in the same request. A node never copies the file;
// it stores the resource's address inside `content`, the only type payload
// since `0000000011_dynamic_engine.js`, and that address carries the record id
// as a path segment in every form it is written in:
//
//     /api/files/files/<recordId>/<generated name>
//     /pb/session/<hash>/api/files/files/<recordId>/<generated name>
//     https://<host>/api/files/files/<recordId>/<generated name>
//
// so the deleted row is found by searching `content` (and the shared `cover`
// and `icon` columns) for `/<recordId>/`. The id, not the whole address, is the
// stable part: the host, the prefix and the generated name change between reads.
//
// The hook repairs the stored record only. An open client applies the same
// update locally (`packages/utils/src/resource-references.ts`), so the two
// must produce the same shape when a node type gains a file field.
//
// This is best effort by design: the resource is already deleted, so a node
// that cannot be saved is logged and the remaining nodes, and the
// derived-artifact cleanup that follows, still run.

// The fields a node can hold a file address in. `content`, `cover` and `icon`
// are JSON columns; PocketBase's `~` filter also matches inside a JSON document
// (a JSON string value is searched as text).
var REFERENCE_FILTER =
  "content ~ {:needle} || cover ~ {:needle} || icon ~ {:needle}";

/**
 * Normalizes a JSON column value.
 *
 * Depending on the field type and the runtime, a JSON value arrives either
 * decoded (a plain object, array or string) or as its raw JSON bytes, which the
 * JS runtime exposes as a byte-like array. Both forms are reduced to the same
 * decoded value here, so no matcher has to care.
 */
function decodeJson(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // A raw JSON document may be exposed as its own text; a plain string (a
    // media node's URL, for example) must stay untouched.
    var first = value.charAt(0);
    if (first === "{" || first === "[" || first === '"') {
      try {
        return JSON.parse(value);
      } catch (_) {
        return value;
      }
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value) || typeof value.length === "number") {
    var text = "";
    var bytes = value.length > 0;
    for (var index = 0; index < value.length; index += 1) {
      var byte = value[index];
      if (
        typeof byte !== "number" ||
        byte < 0 ||
        byte > 255 ||
        Math.floor(byte) !== byte
      ) {
        bytes = false;
        break;
      }
      text += String.fromCharCode(byte);
    }
    if (bytes) {
      try {
        return JSON.parse(text);
      } catch (_) {
        return value;
      }
    }
  }
  return value;
}

/** True when any string inside `value` contains `needle`. */
function containsNeedleInValue(value, needle) {
  if (typeof value === "string") return value.indexOf(needle) >= 0;
  if (Array.isArray(value)) {
    for (var index = 0; index < value.length; index += 1) {
      if (containsNeedleInValue(value[index], needle)) return true;
    }
    return false;
  }
  if (value !== null && typeof value === "object") {
    for (var key in value) {
      if (containsNeedleInValue(value[key], needle)) return true;
    }
  }
  return false;
}

/**
 * Reads a node's `content` payload.
 *
 * The column is JSON, so PocketBase normally returns it decoded. A record
 * written by a hook that used `getString` holds serialized text, and the goja
 * runtime can expose a JSON field as its raw bytes; `decodeJson` normalizes all
 * three. Anything that is not a JSON object is reported as `valid: false` so
 * the caller can skip the node instead of writing a broken payload back.
 */
function readContent(record) {
  var value = decodeJson(record.get("content"));
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { value: value, valid: true };
  }
  return { value: null, valid: false };
}

/** A shallow copy, so a saved payload does not mutate the loaded record. */
function copyContent(content) {
  var next = {};
  for (var key in content) next[key] = content[key];
  return next;
}

/** True when `content[key]` is a stored address of the deleted record. */
function pointsAt(content, key, needle) {
  var value = content[key];
  return typeof value === "string" && value.indexOf(needle) >= 0;
}

/** True for the node types whose `content.url` is a stored file address. */
function isMediaNodeType(nodeType) {
  return (
    nodeType === "image" ||
    nodeType === "pdf" ||
    nodeType === "video" ||
    nodeType === "audio" ||
    nodeType === "webpage"
  );
}

/** True for the node types whose payload is read here at all. */
function readsContent(nodeType) {
  return (
    isMediaNodeType(nodeType) ||
    nodeType === "website" ||
    nodeType === "rich-text" ||
    nodeType === "text"
  );
}

/**
 * Copies a rich-text document, removing what points at the deleted record.
 *
 * An image block is dropped: the picture is its only meaning. An Excalidraw
 * block keeps its inline scene (`data`), the user's diagram, and loses the
 * preview address and the attachment bookkeeping. Everything else is walked
 * and copied unchanged, so a paragraph that merely mentions the address keeps
 * its text.
 *
 * The result is `{ value, changed }`; `drop` marks an element the parent array
 * must remove.
 */
function stripDocument(value, needle) {
  if (Array.isArray(value)) {
    var changed = false;
    var next = [];
    for (var index = 0; index < value.length; index += 1) {
      var item = stripDocument(value[index], needle);
      if (item.drop) {
        changed = true;
        continue;
      }
      if (item.changed) changed = true;
      next.push(item.value);
    }
    return changed
      ? { value: next, changed: true }
      : { value: value, changed: false };
  }

  if (value !== null && typeof value === "object") {
    var attrs = value.attrs;
    if (attrs !== null && typeof attrs === "object") {
      if (value.type === "image" && containsNeedleInValue(attrs.src, needle)) {
        return { value: null, changed: true, drop: true };
      }
      if (
        value.type === "excalidraw" &&
        containsNeedleInValue(attrs.src, needle)
      ) {
        var clearedAttrs = {};
        for (var attrKey in attrs) clearedAttrs[attrKey] = attrs[attrKey];
        clearedAttrs.src = "";
        delete clearedAttrs.attachmentId;
        delete clearedAttrs.size;
        var clearedBlock = {};
        for (var blockKey in value) clearedBlock[blockKey] = value[blockKey];
        clearedBlock.attrs = clearedAttrs;
        return { value: clearedBlock, changed: true };
      }
    }

    var keysChanged = false;
    var nextObject = {};
    for (var key in value) {
      var child = stripDocument(value[key], needle);
      if (child.drop) {
        keysChanged = true;
        continue;
      }
      if (child.changed) keysChanged = true;
      nextObject[key] = child.value;
    }
    return keysChanged
      ? { value: nextObject, changed: true }
      : { value: value, changed: false };
  }

  return { value: value, changed: false };
}

/**
 * The `content` of a media node after the deleted address is cleared.
 *
 * The emptied payload keeps the type's own default shape (see
 * `plugins/builtin/types/single/*.ts`), so the next read still satisfies the
 * type schema instead of handing the mapper a partial object. Only what belongs
 * to the deleted file is cleared: a poster or playlist that points at another
 * live record keeps its address, and the timeline, location, shooting time and
 * source stay, because they are the user's data rather than the file's.
 *
 * Returns `{ value, changed }`; `changed` is false when nothing here pointed at
 * the deleted record, including a payload that carries no `url` at all.
 */
function clearMediaContent(nodeType, content, needle) {
  var next = copyContent(content);
  var changed = false;
  var lostFile = pointsAt(content, "url", needle);

  if (lostFile) {
    next.url = "";
    changed = true;
  }
  if (nodeType === "image" && lostFile) {
    next.width = 0;
    next.height = 0;
    next.fileSize = 0;
    // The annotation layer is drawn on the removed payload.
    delete next.annotations;
  }
  if (nodeType === "pdf" && lostFile) {
    next.pageCount = 0;
    next.fileSize = 0;
    // The annotation layer is drawn on the removed payload.
    delete next.annotations;
  }
  if ((nodeType === "video" || nodeType === "audio") && lostFile) {
    next.duration = 0;
    next.fileSize = 0;
  }
  if (nodeType === "webpage" && lostFile) {
    next.fileSize = 0;
  }
  // The poster of a PDF or video and a video playlist are separate rows; a
  // deleted one clears only its own address. A video keeps `timestamps`: the
  // timeline is the user's work, not part of the file.
  if (
    (nodeType === "pdf" || nodeType === "video") &&
    pointsAt(content, "coverUrl", needle)
  ) {
    next.coverUrl = "";
    changed = true;
  }
  if (nodeType === "video" && pointsAt(content, "hlsUrl", needle)) {
    next.hlsUrl = "";
    changed = true;
  }
  return { value: next, changed: changed };
}

/**
 * Clears the reference from one node and saves it.
 *
 * Only the field that actually contains the deleted record is cleared; a node
 * that points at another live resource in the same payload keeps that address.
 */
function detachNode(e, record, needle) {
  var changed = false;
  var nodeType = record.getString("nodeType");

  // Every node type can carry a library image as its cover or icon.
  var cover = decodeJson(record.get("cover"));
  if (
    cover !== null &&
    typeof cover === "object" &&
    cover.kind === "image" &&
    containsNeedleInValue(cover.url, needle)
  ) {
    record.set("cover", null);
    changed = true;
  }
  var icon = decodeJson(record.get("icon"));
  if (
    icon !== null &&
    typeof icon === "object" &&
    icon.kind === "image" &&
    containsNeedleInValue(icon.value, needle)
  ) {
    record.set("icon", null);
    changed = true;
  }

  var content = null;
  if (readsContent(nodeType)) {
    var stored = readContent(record);
    content = stored.value;
    if (!stored.valid) {
      // A malformed payload is a corrupted record, not a reason to abort the
      // request: the file is already deleted and the other nodes still need
      // their addresses cleared.
      console.warn(
        "[node-references] skipping node " +
          record.id +
          " (" +
          nodeType +
          "): content is not a JSON object",
      );
    } else if (isMediaNodeType(nodeType)) {
      if (typeof content.url !== "string") {
        // The address is the field the cleanup keys on. Without it the payload
        // is left alone, but a poster or playlist that does point at the
        // deleted record is still cleared below.
        console.warn(
          "[node-references] skipping node " +
            record.id +
            " (" +
            nodeType +
            "): content has no url",
        );
      }
      var cleared = clearMediaContent(nodeType, content, needle);
      if (cleared.changed) {
        record.set("content", cleared.value);
        changed = true;
      }
    } else if (nodeType === "website") {
      if (pointsAt(content, "faviconUrl", needle)) {
        var nextWebsite = copyContent(content);
        delete nextWebsite.faviconUrl;
        record.set("content", nextWebsite);
        changed = true;
      }
    } else {
      // A rich-text and a text node keep their Tiptap document inside
      // `content.docs`: rich-text as the block map plus `referencedNodes`,
      // text as the block map alone. Every other key stays as it was.
      var docs = content.docs;
      if (docs !== null && typeof docs === "object") {
        var stripped = stripDocument(docs, needle);
        if (stripped.changed) {
          var nextDocument = copyContent(content);
          nextDocument.docs = stripped.value;
          record.set("content", nextDocument);
          changed = true;
        }
      }
    }
  }

  if (!changed) return false;
  e.app.save(record);
  return true;
}

/**
 * Clears every reference to the deleted `files` record from the nodes.
 *
 * Runs after the delete succeeded. A failed read or a node that cannot be saved
 * is logged and skipped so the remaining nodes, and the derived-artifact
 * cleanup that follows, still run.
 */
function detachNodeReferences(e) {
  var recordId = e.record && e.record.id;
  if (!recordId) return;
  var needle = "/" + recordId + "/";

  var nodes;
  try {
    nodes = e.app.findRecordsByFilter("nodes", REFERENCE_FILTER, "", 0, 0, {
      needle: needle,
    });
  } catch (error) {
    console.warn(
      "[node-references] could not read the nodes that reference " +
        recordId +
        ": " +
        error,
    );
    return;
  }

  for (var index = 0; index < nodes.length; index += 1) {
    var node = nodes[index];
    if (!node) continue;
    try {
      detachNode(e, node, needle);
    } catch (error) {
      console.warn(
        "[node-references] could not clear node " +
          node.id +
          " of " +
          recordId +
          ": " +
          error,
      );
    }
  }
}

module.exports = {
  REFERENCE_FILTER: REFERENCE_FILTER,
  decodeJson: decodeJson,
  containsNeedleInValue: containsNeedleInValue,
  readContent: readContent,
  stripDocument: stripDocument,
  clearMediaContent: clearMediaContent,
  detachNode: detachNode,
  detachNodeReferences: detachNodeReferences,
};
