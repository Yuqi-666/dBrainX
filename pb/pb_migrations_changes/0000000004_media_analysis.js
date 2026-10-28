// SPDX-License-Identifier: AGPL-3.0-only

// A PDF parse and a video HLS package are expensive and they produce extra
// stored blobs (a cover, a playlist, its segments). Until now the result lived
// only on the node that uploaded the file: a second node referencing the same
// resource parsed it again and stored a second set of artifacts. The result is
// now cached on the resource record itself, once, and every reference reuses it.
//
// The cache fields are widened on the `files` collection:
//
//   * `pageCount`, `width`, `height`, `duration` — the measurements the node
//               would otherwise re-derive;
//   * `coverUrl`, `hlsUrl` — the stored artifact a node points at;
//   * `derivedFrom` — the id of the resource an artifact belongs to (a PDF
//               cover, an HLS playlist, its segments, a poster). The library
//               lists only resources without it, and deleting a resource
//               deletes its artifacts.
//
// Existing databases already hold both kinds of row, so the migration links
// them where it can:
//
//   1. a media node already carries the analysis of its file (page count,
//      duration, cover, playlist URL), so it is copied onto the resource;
//   2. the cover and the playlist it names are marked as artifacts of that
//      resource;
//   3. a video's segments share the resource's stored name stem
//      (`clip_ab12cd34ef.mp4` → `clip_ab12cd34ef.00000.ts`), which links the
//      rest, including artifacts whose node is already gone.
//
// A cover of a PDF whose node no longer exists has no link back to its
// resource; it stays a plain record the owner can delete from the library. The
// backfill is best effort by design: re-running an analysis once is cheap
// compared with a migration that guesses wrong.
/// <reference path="../pb_data/types.d.ts" />

const VIDEO_EXTENSIONS = [
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "mpg",
  "mpeg",
  "ogv",
  "3gp",
];

const ANALYSIS_FIELDS = [
  "pageCount",
  "width",
  "height",
  "duration",
  "coverUrl",
  "hlsUrl",
  "derivedFrom",
];

function extensionOf(fileName) {
  const name = String(fileName || "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function stemOf(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function isVideoName(fileName) {
  return VIDEO_EXTENSIONS.indexOf(extensionOf(fileName)) >= 0;
}

/**
 * The name a file was uploaded under.
 *
 * PocketBase stores a blob as `<stem>_<ten random lower-case alphanumerics>`
 * followed by the extension the upload named, so `clip.mp4` lands as
 * `clip_8t42ajydsz.mp4` and `clip.cover.jpg` as
 * `clip_8t42ajydsz.cover.jpg`. Removing that suffix is what makes the source
 * name and its artifacts comparable.
 */
function storedName(fileName) {
  return String(fileName || "").replace(/_[a-z0-9]{10}(?=\.)/, "");
}

/** True for the names this server gives the artifacts of a video. */
function isVideoArtifactName(fileName) {
  const name = storedName(fileName);
  if (extensionOf(name) === "m3u8") return true;
  if (/\.cover\.jpg$/.test(name)) return true;
  return /\.\d{5}\.ts$/.test(name);
}

/**
 * The stored-name stem an artifact shares with its source video.
 *
 * The source is `<stem>.<ext>`, while its artifacts are `<stem>.m3u8`,
 * `<stem>.00000.ts` and `<stem>.cover.jpg`. Only the playlist stem is the plain
 * stem of the file name; a segment and a cover carry a suffix of their own, so
 * it is removed here before the stem is compared.
 */
function artifactStem(fileName) {
  const name = storedName(fileName);
  const segment = /^(.*)\.\d{5}\.ts$/.exec(name);
  if (segment) return segment[1];
  const cover = /^(.*)\.cover\.jpg$/.exec(name);
  if (cover) return cover[1];
  return stemOf(name);
}

/**
 * Record id of the stored file an address points at.
 *
 * The address is `/api/files/<collection>/<record>/<name>`; a desktop address
 * may carry a prefix (`/pb`, `/session/<id>`) in front of it, which the pattern
 * simply ignores.
 */
function recordIdFromUrl(url) {
  const match = /\/api\/files\/[A-Za-z0-9_]+\/([A-Za-z0-9]+)\//.exec(
    String(url || ""),
  );
  return match ? match[1] : "";
}

/**
 * The blob address of a node.
 *
 * A JSON field comes back as the raw JSON text, exposed as a byte-like value
 * (`"/api/files/<collection>/<record>/<name>"` including the quotes); a plain
 * text field comes back as a string. Both are searched for the file address, so
 * a bare URL and an object-shaped content (`{"url": "..."}`) both resolve.
 */
function contentUrl(record) {
  const content = record.get("content");
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content.length === "number") {
    let text = "";
    for (let index = 0; index < content.length; index += 1) {
      text += String.fromCharCode(content[index]);
    }
    return text;
  }
  if (typeof content.get === "function") {
    const url = content.get("url");
    return typeof url === "string" ? url : "";
  }
  return "";
}

function addAnalysisFields(collection) {
  collection.fields.add(
    new NumberField({ name: "pageCount", min: 0, onlyInt: true }),
  );
  collection.fields.add(
    new NumberField({ name: "width", min: 0, onlyInt: true }),
  );
  collection.fields.add(
    new NumberField({ name: "height", min: 0, onlyInt: true }),
  );
  collection.fields.add(new NumberField({ name: "duration", min: 0 }));
  collection.fields.add(new TextField({ name: "coverUrl", max: 1000 }));
  collection.fields.add(new TextField({ name: "hlsUrl", max: 1000 }));
  collection.fields.add(new TextField({ name: "derivedFrom", max: 100 }));
}

function removeAnalysisFields(collection) {
  for (const name of ANALYSIS_FIELDS) {
    collection.fields.removeByName(name);
  }
}

/**
 * The rule an existing database must carry after this migration.
 *
 * A rename and the analysis cache are the only updates an owner may make. The
 * fields that decide what is stored and who owns it stay pinned, exactly as in
 * the base schema (`0000000001_base_schema.js`, which new databases use
 * instead of this file).
 */
function ownerUpdateRule(auth) {
  return (
    auth +
    " && ownerId = @request.auth.id" +
    " && @request.body.ownerId:changed = false" +
    " && @request.body.workspaceId:changed = false" +
    " && @request.body.size:changed = false" +
    " && @request.body.mimeType:changed = false" +
    " && @request.body.file:changed = false" +
    " && @request.body.derivedFrom:changed = false"
  );
}

/** The rule this migration replaces, restored on a rollback. */
function previousUpdateRule(auth) {
  return (
    auth +
    " && ownerId = @request.auth.id" +
    " && @request.body.ownerId:changed = false" +
    " && @request.body.workspaceId:changed = false" +
    " && @request.body.size:changed = false" +
    " && @request.body.mimeType:changed = false" +
    " && @request.body.file:changed = false"
  );
}

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("files");
    addAnalysisFields(collection);
    const auth = '@request.auth.id != ""';
    collection.updateRule = ownerUpdateRule(auth);
    app.save(collection);

    const files = app.findAllRecords("files").filter(Boolean);
    const byId = {};
    const videoStemOwners = {};
    for (const record of files) {
      byId[record.id] = record;
      const fileName = record.getString("file");
      if (isVideoName(fileName)) {
        videoStemOwners[stemOf(storedName(fileName))] = record.id;
      }
    }

    // Marks one artifact row as belonging to `sourceId`. The source row itself,
    // an empty id and a row that already names a source are left alone.
    const linkArtifact = (record, sourceId) => {
      if (!record || !sourceId || record.id === sourceId) return;
      if (record.getString("derivedFrom")) return;
      record.set("derivedFrom", sourceId);
      app.save(record);
    };

    const nodes = app.findAllRecords("nodes").filter(Boolean);
    for (const node of nodes) {
      const nodeType = node.getString("nodeType");
      if (
        nodeType !== "pdf" &&
        nodeType !== "video" &&
        nodeType !== "image" &&
        nodeType !== "audio"
      ) {
        continue;
      }

      const sourceId = recordIdFromUrl(contentUrl(node));
      const source = sourceId ? byId[sourceId] : undefined;
      if (!source) continue;

      let changed = false;
      if (nodeType === "pdf") {
        const pageCount = node.getFloat("pageCount");
        if (pageCount > 0) {
          source.set("pageCount", pageCount);
          changed = true;
        }
        const coverUrl = node.getString("coverUrl");
        if (coverUrl) {
          source.set("coverUrl", coverUrl);
          changed = true;
          linkArtifact(byId[recordIdFromUrl(coverUrl)], sourceId);
        }
      } else if (nodeType === "video") {
        const duration = node.getFloat("duration");
        if (duration > 0) {
          source.set("duration", duration);
          changed = true;
        }
        const coverUrl = node.getString("coverUrl");
        if (coverUrl) {
          source.set("coverUrl", coverUrl);
          changed = true;
          linkArtifact(byId[recordIdFromUrl(coverUrl)], sourceId);
        }
        const hlsUrl = node.getString("hlsUrl");
        if (hlsUrl) {
          source.set("hlsUrl", hlsUrl);
          changed = true;
          linkArtifact(byId[recordIdFromUrl(hlsUrl)], sourceId);
        }
      } else if (nodeType === "image") {
        const width = node.getFloat("width");
        const height = node.getFloat("height");
        if (width > 0 && height > 0) {
          source.set("width", width);
          source.set("height", height);
          changed = true;
        }
      } else {
        const duration = node.getFloat("duration");
        if (duration > 0) {
          source.set("duration", duration);
          changed = true;
        }
      }

      if (changed) app.save(source);
    }

    // Video artifacts whose node is gone still share the resource's stored name
    // stem, which links them without any node.
    for (const record of files) {
      const fileName = record.getString("file");
      if (!isVideoArtifactName(fileName)) continue;
      linkArtifact(record, videoStemOwners[artifactStem(fileName)]);
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("files");
    const auth = '@request.auth.id != ""';
    collection.updateRule = previousUpdateRule(auth);
    removeAnalysisFields(collection);
    app.save(collection);
  },
);
