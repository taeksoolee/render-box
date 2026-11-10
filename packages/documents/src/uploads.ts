import { CHUNK_SIZE, deleteBlobStatements, insertChunk, MAX_HTML_BYTES } from "@render-box/db";
import { usedBytes } from "./storage";

export class UploadError extends Error {
  constructor(
    readonly status: 413 | 422 | 507,
    message: string,
  ) {
    super(message);
  }
}

const ORPHAN_AGE_MS = 60 * 60 * 1000;

// Not the current HTML of a document, nor kept as a version (design.md 4.9).
const UNATTACHED = `NOT EXISTS (SELECT 1 FROM html_documents d WHERE d.blob_id = b.id)
         AND NOT EXISTS (SELECT 1 FROM html_document_versions v WHERE v.blob_id = b.id)`;

// Blobs uploaded but never attached to a document are removed the next time
// the same user uploads, instead of by a cron job (design.md 4.3).
export async function deleteOrphanBlobs(d1: D1Database, keyId: number, now = Date.now()): Promise<void> {
  const { results } = await d1
    .prepare(
      `SELECT id FROM html_blobs b
       WHERE b.created_by = ? AND b.created_at < ?
         AND ${UNATTACHED}`,
    )
    .bind(keyId, now - ORPHAN_AGE_MS)
    .all<{ id: number }>();
  if (results.length === 0) return;
  await d1.batch(results.flatMap((r) => deleteBlobStatements(d1, r.id)));
}

// Splits the request body into 1MB rows without decoding it, so CPU time stays
// flat regardless of size (design.md 4.3). `limitBytes` caps total storage:
// checked against the declared length before reading, and again while
// reading for bodies without one (design.md 4.9).
export async function storeUpload(
  d1: D1Database,
  body: ReadableStream<Uint8Array>,
  keyId: number,
  opts: { limitBytes: number; declaredSize?: number; now?: number },
): Promise<{ id: number; size: number }> {
  const used = await usedBytes(d1);
  if (used + (opts.declaredSize ?? 1) > opts.limitBytes) {
    await body.cancel().catch(() => {});
    throw new UploadError(507, "storage_full");
  }
  const now = opts.now ?? Date.now();
  const blob = await d1
    .prepare("INSERT INTO html_blobs (size, created_by, created_at) VALUES (0, ?, ?) RETURNING id")
    .bind(keyId, now)
    .first<{ id: number }>();
  if (!blob) throw new Error("failed to create blob");

  const reader = body.getReader();
  const buffer = new Uint8Array(CHUNK_SIZE);
  let filled = 0;
  let seq = 0;
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_HTML_BYTES) throw new UploadError(413, "too_large");
      if (used + size > opts.limitBytes) throw new UploadError(507, "storage_full");
      if (value.indexOf(0) !== -1) throw new UploadError(422, "nul_byte");
      let offset = 0;
      while (offset < value.length) {
        const n = Math.min(CHUNK_SIZE - filled, value.length - offset);
        buffer.set(value.subarray(offset, offset + n), filled);
        filled += n;
        offset += n;
        if (filled === CHUNK_SIZE) {
          await insertChunk(d1, blob.id, seq++, buffer.slice(0, filled));
          filled = 0;
        }
      }
    }
    if (filled > 0) await insertChunk(d1, blob.id, seq++, buffer.slice(0, filled));
    if (size === 0) throw new UploadError(422, "empty");
    await d1.prepare("UPDATE html_blobs SET size = ? WHERE id = ?").bind(size, blob.id).run();
    return { id: blob.id, size };
  } catch (err) {
    await reader.cancel().catch(() => {});
    await d1.batch(deleteBlobStatements(d1, blob.id));
    throw err;
  }
}

// An upload may be attached only by the user who uploaded it, and only once.
export async function findAttachableBlob(
  d1: D1Database,
  blobId: number,
  keyId: number,
): Promise<{ id: number; size: number } | null> {
  return d1
    .prepare(
      `SELECT id, size FROM html_blobs b
       WHERE b.id = ? AND b.created_by = ? AND b.size > 0
         AND ${UNATTACHED}`,
    )
    .bind(blobId, keyId)
    .first<{ id: number; size: number }>();
}
