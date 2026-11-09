import type { DocumentLink } from "@render-box/db";
import { generateDocumentKey, isDocumentKey } from "@render-box/shared";

export type DocumentRecord = {
  id: number;
  documentKey: string;
  title: string;
  description: string | null;
  links: DocumentLink[];
  blobId: number;
  htmlSize: number;
  version: number;
  createdByName: string;
  createdAt: number;
  updatedByName: string;
  updatedAt: number;
};

export type DocumentListRow = {
  documentKey: string;
  title: string;
  description: string | null;
  linkCount: number;
  htmlSize: number;
  updatedByName: string;
  updatedAt: number;
};

export async function findDocument(d1: D1Database, documentKey: string): Promise<DocumentRecord | null> {
  if (!isDocumentKey(documentKey)) return null;
  const row = await d1
    .prepare(
      `SELECT d.id, d.document_key AS documentKey, d.title, d.description, d.links, d.blob_id AS blobId,
              d.html_size AS htmlSize, d.version, d.created_at AS createdAt, d.updated_at AS updatedAt,
              ck.name AS createdByName, uk.name AS updatedByName
       FROM html_documents d
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

// Title substring or document key prefix, newest first (design.md 4.7).
export async function listDocuments(
  d1: D1Database,
  opts: { q: string; page: number; pageSize: number },
): Promise<{ rows: DocumentListRow[]; total: number }> {
  const like = `%${escapeLike(opts.q)}%`;
  const where = `(? = '' OR d.title LIKE ? ESCAPE '\\' OR substr(d.document_key, 1, length(?)) = ?)`;
  const binds = [opts.q, like, opts.q, opts.q];
  const [countRow, rows] = await Promise.all([
    d1.prepare(`SELECT COUNT(*) AS n FROM html_documents d WHERE ${where}`).bind(...binds).first<{ n: number }>(),
    d1
      .prepare(
        `SELECT d.document_key AS documentKey, d.title, d.description,
                json_array_length(d.links) AS linkCount, d.html_size AS htmlSize,
                k.name AS updatedByName, d.updated_at AS updatedAt
         FROM html_documents d JOIN access_keys k ON k.id = d.updated_by
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
    keyId: number;
    now?: number;
  },
): Promise<string> {
  const now = input.now ?? Date.now();
  const insert = (documentKey: string) =>
    d1
      .prepare(
        `INSERT INTO html_documents
           (document_key, title, description, links, blob_id, html_size, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .bind(documentKey, input.title, input.description || null, JSON.stringify(input.links), input.blob.id,
        input.blob.size, input.keyId, input.keyId, now, now)
      .run();

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
// blob replaces the HTML; without one the current HTML is kept (design.md 4.8).
export async function updateDocument(
  d1: D1Database,
  input: {
    id: number;
    version: number;
    title: string;
    description: string;
    links: DocumentLink[];
    blob: { id: number; size: number } | null;
    keyId: number;
    now?: number;
  },
): Promise<boolean> {
  const updated = await d1
    .prepare(
      `UPDATE html_documents
       SET title = ?, description = ?, links = ?, blob_id = COALESCE(?, blob_id), html_size = COALESCE(?, html_size),
           version = version + 1, updated_by = ?, updated_at = ?
       WHERE id = ? AND version = ?
       RETURNING id`,
    )
    .bind(input.title, input.description || null, JSON.stringify(input.links), input.blob?.id ?? null,
      input.blob?.size ?? null, input.keyId, input.now ?? Date.now(), input.id, input.version)
    .first<{ id: number }>();
  return updated !== null;
}
