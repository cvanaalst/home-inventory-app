// PURE conflict-resolution logic for two-way Drive sync. No imports, no
// DOM, no I/O — sync.js owns the network calls and calls into this module
// with plain in-memory arrays. Unit-tested FIRST, before sync.js exists
// (BLUEPRINT.md §7): a merge bug is silent and irreversible once it has
// shipped a write back to Drive, so this is the highest-stakes pure module
// in the app.

/** Resolves the two copies of ONE record (by id) into the winner.
 * A tombstone ALWAYS wins over a live record, regardless of timestamps —
 * otherwise a concurrent edit on another device could resurrect something
 * this device deleted, and the delete would never propagate. Between two
 * records in the same state (both live or both tombstoned), the newer
 * updatedAt wins (last-write-wins). */
export function resolveRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTomb = !!a.deletedAt;
  const bTomb = !!b.deletedAt;
  if (aTomb !== bTomb) return aTomb ? a : b;
  return (b.updatedAt || "") > (a.updatedAt || "") ? b : a;
}

/** Merges two full item sets by id. `stats` describes what this merge is
 * about to CHANGE on the local device (i.e. what the caller should log) —
 * not a global count of differences between the sets. */
export function mergeItemSets(local, remote) {
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);

  const merged = [];
  const stats = { added: 0, updated: 0, deleted: 0 };

  for (const id of ids) {
    const l = localById.get(id) || null;
    const r = remoteById.get(id) || null;
    const winner = resolveRecord(l, r);
    merged.push(winner);

    if (!l) {
      stats.added++;
    } else if (winner.updatedAt !== l.updatedAt) {
      if (winner.deletedAt && !l.deletedAt) stats.deleted++;
      else stats.updated++;
    }
  }

  return { merged, stats };
}

/** A Drive media filename is "<mediaId>__<originalFilename>" — the prefix
 * before the FIRST "__" is the id, so reconciliation never has to trust or
 * parse the (user-controlled, possibly weird) original filename. */
function extractMediaId(filename) {
  const idx = filename.indexOf("__");
  return idx === -1 ? filename : filename.slice(0, idx);
}

/** Computes the four media actions a sync needs to perform, from the
 * merged record set plus what currently exists locally/remotely. Every
 * decision is driven by which mediaIds are still REFERENCED by a live
 * (non-deleted) record in `merged` — not by what happens to exist in
 * either store, which is what makes deletions propagate correctly.
 *
 * Deliberately NOT gated on the local blob still existing: local deletion
 * purges the blob within seconds, so waiting for it to still be present
 * before deleting the Drive copy would orphan that file on Drive forever
 * (a real, silent storage leak — BLUEPRINT.md §7). */
export function computeMediaActions(merged, localMediaIds, remoteMediaNames) {
  const wanted = new Set();
  for (const record of merged) {
    if (record.deletedAt) continue;
    for (const att of record.attachments || []) {
      if (att.mediaId) wanted.add(att.mediaId);
    }
  }

  const localSet = new Set(localMediaIds);
  const remoteByMediaId = new Map();
  for (const name of remoteMediaNames) remoteByMediaId.set(extractMediaId(name), name);
  const remoteSet = new Set(remoteByMediaId.keys());

  const toUpload = [...wanted].filter((id) => localSet.has(id) && !remoteSet.has(id));
  const toDownload = [...wanted].filter((id) => remoteSet.has(id) && !localSet.has(id));
  const toDeleteLocal = [...localSet].filter((id) => !wanted.has(id));
  const toDeleteRemoteNames = [...remoteSet].filter((id) => !wanted.has(id)).map((id) => remoteByMediaId.get(id));

  return { toUpload, toDownload, toDeleteLocal, toDeleteRemoteNames };
}
