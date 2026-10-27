// SPDX-License-Identifier: AGPL-3.0-only

// Node references to a stored blob, and their cleanup.
//
// Deleting a `files` row deletes the bytes, so every node that points at those
// bytes has to lose the link in the same request. A node never copies the file;
// it stores the resource's address, and that address carries the record id as
// a path segment in every form it is written in:
//
//     /api/files/files/<recordId>/<generated name>
//     /pb/session/<hash>/api/files/files/<recordId>/<generated name>
//     https://<host>/api/files/files/<recordId>/<generated name>
//
// so the deleted row is found by searching the JSON and plain-text columns for
// `/<recordId>/`. The id, not the whole address, is the stable part: the host,
// the prefix and the generated name change between reads.
//
// The hook repairs the stored record only. An open client applies the same
// update locally (`packages/utils/src/resource-references.ts`), so the two
// must produce the same shape when a node type gains a file field.
//
// This is best effort by design: the resource is already deleted, so a node
// that cannot be saved is logged and the remaining nodes, and the
// derived-artifact cleanup that follows, still run.

// The columns a node can hold a file address in. `content` and `docs` are JSON
// columns; PocketBase's `~` filter also matches inside a JSON document (a JSON
// string value is searched as text).
var REFERENCE_FILTER =
  "content ~ {:needle} || docs ~ {:needle} || coverUrl ~ {:needle}" +
  " || hlsUrl ~ {:needle} || faviconUrl ~ {:needle}" +
  " || cover ~ {:needle} || icon ~ {:needle}";

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

/** True when the plain-text field `name` contains `needle`. */
function textFieldMatches(record, name, needle) {
  var value = record.getString(name);
  return typeof value === "string" && value.indexOf(needle) >= 0;
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
 * The cleared `content` of a text node.
 *
 * A text node stores its document directly in the `content` column, but the
 * wire shape wraps it as `content.docs`; both forms are accepted so the record
 * is fixed no matter which one a build wrote.
 */
function stripTextContent(content, needle) {
  if (content === null || typeof content !== "object") {
    return { value: content, changed: false };
  }
  if (
    content.docs !== null &&
    typeof content.docs === "object" &&
    !Array.isArray(content.docs)
  ) {
    var wrapped = stripDocument(content.docs, needle);
    if (!wrapped.changed) return { value: content, changed: false };
    var next = {};
    for (var key in content) next[key] = content[key];
    next.docs = wrapped.value;
    return { value: next, changed: true };
  }
  return stripDocument(content, needle);
}

/**
 * Clears the reference from one node and saves it.
 *
 * Only the field that actually contains the deleted record is cleared; a node
 * that points at another live resource in the same column keeps that address.
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

  if (
    nodeType === "image" ||
    nodeType === "pdf" ||
    nodeType === "video" ||
    nodeType === "audio" ||
    nodeType === "webpage"
  ) {
    var content = decodeJson(record.get("content"));
    if (containsNeedleInValue(content, needle)) {
      record.set("content", "");
      record.set("fileSize", 0);
      if (nodeType === "image") {
        record.set("width", 0);
        record.set("height", 0);
      }
      if (nodeType === "pdf") record.set("pageCount", 0);
      if (nodeType === "video" || nodeType === "audio")
        record.set("duration", 0);
      // The annotation layer is drawn on the removed payload.
      if (nodeType === "image" || nodeType === "pdf")
        record.set("annotations", null);
      changed = true;
    }
    // The poster of a PDF or video and a video playlist are separate rows; a
    // deleted one clears only its own address. A video keeps `timestamps`: the
    // timeline is the user's work, not part of the file.
    if (nodeType === "pdf" || nodeType === "video") {
      if (textFieldMatches(record, "coverUrl", needle)) {
        record.set("coverUrl", "");
        changed = true;
      }
    }
    if (nodeType === "video" && textFieldMatches(record, "hlsUrl", needle)) {
      record.set("hlsUrl", "");
      changed = true;
    }
  } else if (nodeType === "website") {
    if (textFieldMatches(record, "faviconUrl", needle)) {
      record.set("faviconUrl", "");
      changed = true;
    }
  } else if (nodeType === "rich-text") {
    var docs = decodeJson(record.get("docs"));
    var stripped = stripDocument(docs, needle);
    if (stripped.changed) {
      // `referencedNodes` and every other column stay: they name nodes, not
      // files.
      record.set("docs", stripped.value);
      changed = true;
    }
  } else if (nodeType === "text") {
    var documentContent = stripTextContent(
      decodeJson(record.get("content")),
      needle,
    );
    if (documentContent.changed) {
      record.set("content", documentContent.value);
      changed = true;
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
  stripDocument: stripDocument,
  stripTextContent: stripTextContent,
  detachNode: detachNode,
  detachNodeReferences: detachNodeReferences,
};
