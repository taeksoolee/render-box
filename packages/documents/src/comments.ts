// Memos on a document, shown like comments, oldest first (design.md 4.10).
// Any member of the document's project may write one; the author may edit or
// delete their own, and editors may delete anyone's. Not exposed to REST/MCP.

export const MAX_COMMENT_CHARS = 2000;

export type CommentRow = {
  id: number;
  keyId: number;
  authorName: string;
  versionSeq: number;
  body: string;
  createdAt: number;
  updatedAt: number | null;
};

// Trimmed body, or null when empty or too long. Line breaks are kept; the
// view shows them as written.
export function readCommentBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/\r\n?/g, "\n").trim();
  return body.length > 0 && [...body].length <= MAX_COMMENT_CHARS ? body : null;
}

export async function listComments(d1: D1Database, documentId: number): Promise<CommentRow[]> {
  const { results } = await d1
    .prepare(
      `SELECT c.id, c.key_id AS keyId, k.name AS authorName, c.version_seq AS versionSeq, c.body,
              c.created_at AS createdAt, c.updated_at AS updatedAt
       FROM document_comments c JOIN access_keys k ON k.id = c.key_id
       WHERE c.document_id = ? ORDER BY c.id`,
    )
    .bind(documentId)
    .all<CommentRow>();
  return results;
}

// The version is the document's current one, read in the same statement.
export async function addComment(
  d1: D1Database,
  input: { documentId: number; keyId: number; body: string; now?: number },
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO document_comments (document_id, key_id, version_seq, body, created_at)
       SELECT ?1, ?2, COALESCE((SELECT MAX(seq) FROM html_document_versions WHERE document_id = ?1), 1), ?3, ?4`,
    )
    .bind(input.documentId, input.keyId, input.body, input.now ?? Date.now())
    .run();
}

// Only the author's own memo on this document. False when nothing matched.
export async function updateComment(
  d1: D1Database,
  input: { id: number; documentId: number; keyId: number; body: string; now?: number },
): Promise<boolean> {
  const res = await d1
    .prepare("UPDATE document_comments SET body = ?, updated_at = ? WHERE id = ? AND document_id = ? AND key_id = ?")
    .bind(input.body, input.now ?? Date.now(), input.id, input.documentId, input.keyId)
    .run();
  return res.meta.changes > 0;
}

// The author's own memo, or any memo when `anyAuthor` (an editor of the
// project). Both checks are in SQL. False when nothing matched.
export async function deleteComment(
  d1: D1Database,
  input: { id: number; documentId: number; keyId: number; anyAuthor: boolean },
): Promise<boolean> {
  const res = await d1
    .prepare("DELETE FROM document_comments WHERE id = ? AND document_id = ? AND (? = 1 OR key_id = ?)")
    .bind(input.id, input.documentId, input.anyAuthor ? 1 : 0, input.keyId)
    .run();
  return res.meta.changes > 0;
}
