import { releaseBlobStatements } from "./repository";

// HTML versions of a document (design.md 4.9). The current version is the
// highest seq; it can be restored from but never deleted.

export type VersionRow = {
  id: number;
  seq: number;
  blobId: number;
  htmlSize: number;
  restoredFrom: number | null;
  createdByName: string;
  createdAt: number;
};

export type PreviousVersionRow = VersionRow & {
  documentKey: string;
  title: string;
  // Bytes deleting this version alone would free: 0 when another version or
  // the document still uses the same blob.
  freesBytes: number;
};

const COLUMNS = `v.id, v.seq, v.blob_id AS blobId, v.html_size AS htmlSize, v.restored_from AS restoredFrom,
  k.name AS createdByName, v.created_at AS createdAt`;

const NOT_CURRENT = `v.seq < (SELECT MAX(c.seq) FROM html_document_versions c WHERE c.document_id = v.document_id)`;

export async function listVersions(d1: D1Database, documentId: number): Promise<VersionRow[]> {
  const { results } = await d1
    .prepare(
      `SELECT ${COLUMNS} FROM html_document_versions v JOIN access_keys k ON k.id = v.created_by
       WHERE v.document_id = ? ORDER BY v.seq DESC`,
    )
    .bind(documentId)
    .all<VersionRow>();
  return results;
}

export async function findVersion(d1: D1Database, documentId: number, seq: number): Promise<VersionRow | null> {
  return d1
    .prepare(
      `SELECT ${COLUMNS} FROM html_document_versions v JOIN access_keys k ON k.id = v.created_by
       WHERE v.document_id = ? AND v.seq = ?`,
    )
    .bind(documentId, seq)
    .first<VersionRow>();
}

// Every non-current version for the storage screen, ordered by the space
// deleting it would free, so shared blobs (which free nothing) sink.
export async function listPreviousVersions(d1: D1Database, limit = 200): Promise<PreviousVersionRow[]> {
  const { results } = await d1
    .prepare(
      `SELECT ${COLUMNS}, d.document_key AS documentKey, d.title,
              CASE WHEN d.blob_id <> v.blob_id
                    AND (SELECT COUNT(*) FROM html_document_versions s WHERE s.blob_id = v.blob_id) = 1
                   THEN v.html_size ELSE 0 END AS freesBytes
       FROM html_document_versions v
       JOIN html_documents d ON d.id = v.document_id
       JOIN access_keys k ON k.id = v.created_by
       WHERE ${NOT_CURRENT}
       ORDER BY freesBytes DESC, v.html_size DESC, v.created_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<PreviousVersionRow>();
  return results;
}

// Deletes the given versions except current ones (checked in SQL, so a stale
// form cannot remove the HTML a document shows), then the blobs nothing uses.
// Returns how many versions were deleted.
export async function deleteVersions(d1: D1Database, versionIds: number[]): Promise<number> {
  const ids = [...new Set(versionIds)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 500);
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(", ");
  const { results } = await d1
    .prepare(`SELECT v.id, v.blob_id AS blobId FROM html_document_versions v WHERE v.id IN (${marks}) AND ${NOT_CURRENT}`)
    .bind(...ids)
    .all<{ id: number; blobId: number }>();
  if (results.length === 0) return 0;
  const doomed = results.map((r) => r.id);
  await d1.batch([
    d1
      .prepare(`DELETE FROM html_document_versions WHERE id IN (${doomed.map(() => "?").join(", ")})`)
      .bind(...doomed),
    ...[...new Set(results.map((r) => r.blobId))].flatMap((blobId) => releaseBlobStatements(d1, blobId)),
  ]);
  return doomed.length;
}
