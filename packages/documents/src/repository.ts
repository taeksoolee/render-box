import type { DocumentLink } from "@render-box/db";
import { generateDocumentKey, isDocumentKey } from "@render-box/shared";

export type DocumentRecord = {
  id: number;
  documentKey: string;
  title: string;
  description: string | null;
  links: DocumentLink[];
  blobId: number;
  projectId: number;
  projectSlug: string;
  projectName: string;
  htmlSize: number;
  version: number;
  createdByName: string;
  createdAt: number;
  updatedByName: string;
  updatedAt: number;
};

export type DocumentListRow = {
  documentKey: string;
  projectSlug: string;
  title: string;
  description: string | null;
  linkCount: number;
  commentCount: number;
  htmlSize: number;
  updatedByName: string;
  updatedAt: number;
};

export async function findDocument(d1: D1Database, documentKey: string): Promise<DocumentRecord | null> {
  if (!isDocumentKey(documentKey)) return null;
  const row = await d1
    .prepare(
      `SELECT d.id, d.document_key AS documentKey, d.title, d.description, d.links, d.blob_id AS blobId,
              d.project_id AS projectId, p.slug AS projectSlug, p.name AS projectName,
              d.html_size AS htmlSize, d.version, d.created_at AS createdAt, d.updated_at AS updatedAt,
              ck.name AS createdByName, uk.name AS updatedByName
       FROM html_documents d
       JOIN projects p ON p.id = d.project_id
       JOIN access_keys ck ON ck.id = d.created_by
       JOIN access_keys uk ON uk.id = d.updated_by
       WHERE d.document_key = ?`,
    )
    .bind(documentKey)
    .first<Omit<DocumentRecord, "links"> & { links: string }>();
  if (!row) return null;
  return { ...row, links: JSON.parse(row.links) as DocumentLink[] };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// Title substring or document key prefix, newest first (design.md 4.7), only
// within the given projects (design.md 3.9).
export async function listDocuments(
  d1: D1Database,
  opts: { q: string; page: number; pageSize: number; projectIds: number[] },
): Promise<{ rows: DocumentListRow[]; total: number }> {
  if (opts.projectIds.length === 0) return { rows: [], total: 0 };
  const like = `%${escapeLike(opts.q)}%`;
  const inProjects = `d.project_id IN (${opts.projectIds.map(() => "?").join(", ")})`;
  const where = `${inProjects} AND (? = '' OR d.title LIKE ? ESCAPE '\\' OR substr(d.document_key, 1, length(?)) = ?)`;
  const binds = [...opts.projectIds, opts.q, like, opts.q, opts.q];
  const [countRow, rows] = await Promise.all([
    d1.prepare(`SELECT COUNT(*) AS n FROM html_documents d WHERE ${where}`).bind(...binds).first<{ n: number }>(),
    d1
      .prepare(
        `SELECT d.document_key AS documentKey, p.slug AS projectSlug, d.title, d.description,
                json_array_length(d.links) AS linkCount, d.html_size AS htmlSize,
                (SELECT COUNT(*) FROM document_comments c WHERE c.document_id = d.id) AS commentCount,
                k.name AS updatedByName, d.updated_at AS updatedAt
         FROM html_documents d JOIN access_keys k ON k.id = d.updated_by JOIN projects p ON p.id = d.project_id
         WHERE ${where}
         ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, opts.pageSize, (opts.page - 1) * opts.pageSize)
      .all<DocumentListRow>(),
  ]);
  return { rows: rows.results, total: countRow?.n ?? 0 };
}

export async function insertDocument(
  d1: D1Database,
  input: {
    title: string;
    description: string;
    links: DocumentLink[];
    blob: { id: number; size: number };
    projectId: number;
    keyId: number;
    now?: number;
  },
): Promise<string> {
  const now = input.now ?? Date.now();
  // The document and its version 1 go in one transaction (design.md 4.9).
  const insert = (documentKey: string) =>
    d1.batch([
      d1
        .prepare(
          `INSERT INTO html_documents
             (document_key, title, description, links, blob_id, project_id, html_size, version, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .bind(documentKey, input.title, input.description || null, JSON.stringify(input.links), input.blob.id,
          input.projectId, input.blob.size, input.keyId, input.keyId, now, now),
      d1
        .prepare(
          `INSERT INTO html_document_versions (document_id, seq, blob_id, html_size, created_by, created_at)
           SELECT id, 1, blob_id, html_size, created_by, created_at FROM html_documents WHERE document_key = ?`,
        )
        .bind(documentKey),
    ]);

  // One retry on the (practically impossible) key collision (design.md 4.1).
  let documentKey = generateDocumentKey();
  try {
    await insert(documentKey);
  } catch (err) {
    if (!String(err).includes("UNIQUE")) throw err;
    documentKey = generateDocumentKey();
    await insert(documentKey);
  }
  return documentKey;
}

// Optimistic update: false when someone saved a newer version first. A new
// blob replaces the HTML and becomes the next version; without one the current
// HTML is kept (design.md 4.8, 4.9). The previous blob stays as a version.
export async function updateDocument(
  d1: D1Database,
  input: {
    id: number;
    version: number;
    title: string;
    description: string;
    links: DocumentLink[];
    blob: { id: number; size: number } | null;
    // seq of the version being restored, when the blob is an older one.
    restoredFrom?: number;
    keyId: number;
    now?: number;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const update = d1
    .prepare(
      `UPDATE html_documents
       SET title = ?, description = ?, links = ?, blob_id = COALESCE(?, blob_id), html_size = COALESCE(?, html_size),
           version = version + 1, updated_by = ?, updated_at = ?
       WHERE id = ? AND version = ?
       RETURNING id`,
    )
    .bind(input.title, input.description || null, JSON.stringify(input.links), input.blob?.id ?? null,
      input.blob?.size ?? null, input.keyId, now, input.id, input.version);
  if (!input.blob) return (await update.first<{ id: number }>()) !== null;

  // Same transaction: the version row is added only if the UPDATE above won,
  // which is when the row now carries exactly what it just wrote.
  const addVersion = d1
    .prepare(
      `INSERT INTO html_document_versions (document_id, seq, blob_id, html_size, restored_from, created_by, created_at)
       SELECT d.id, COALESCE((SELECT MAX(v.seq) FROM html_document_versions v WHERE v.document_id = d.id), 0) + 1,
              ?, ?, ?, ?, ?
       FROM html_documents d
       WHERE d.id = ? AND d.version = ? AND d.blob_id = ? AND d.updated_by = ? AND d.updated_at = ?`,
    )
    .bind(input.blob.id, input.blob.size, input.restoredFrom ?? null, input.keyId, now,
      input.id, input.version + 1, input.blob.id, input.keyId, now);
  const [updated] = await d1.batch<{ id: number }>([update, addVersion]);
  return (updated?.results.length ?? 0) > 0;
}

// Deletes the chunks and blob only when no document or version points at it
// any more. Safe to run for a blob that is still shared: it then does nothing.
export function releaseBlobStatements(d1: D1Database, blobId: number): D1PreparedStatement[] {
  const unused = `NOT EXISTS (SELECT 1 FROM html_documents WHERE blob_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM html_document_versions WHERE blob_id = ?1)`;
  return [
    d1.prepare(`DELETE FROM html_chunks WHERE blob_id = ?1 AND ${unused}`).bind(blobId),
    d1.prepare(`DELETE FROM html_blobs WHERE id = ?1 AND ${unused}`).bind(blobId),
  ];
}

// The document, all its versions and memos, and the blobs nothing else uses.
export async function deleteDocument(d1: D1Database, documentId: number): Promise<void> {
  const { results } = await d1
    .prepare(
      `SELECT DISTINCT blob_id AS blobId FROM html_document_versions WHERE document_id = ?1
       UNION SELECT blob_id FROM html_documents WHERE id = ?1`,
    )
    .bind(documentId)
    .all<{ blobId: number }>();
  await d1.batch([
    d1.prepare("DELETE FROM document_comments WHERE document_id = ?").bind(documentId),
    d1.prepare("DELETE FROM html_document_versions WHERE document_id = ?").bind(documentId),
    d1.prepare("DELETE FROM html_documents WHERE id = ?").bind(documentId),
    ...results.flatMap((r) => releaseBlobStatements(d1, r.blobId)),
  ]);
}
