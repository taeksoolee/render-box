// HTML bodies are stored as 1MB BLOB rows (design.md 4.2). Raw D1 statements
// are used here because drizzle's buffer mode depends on Node's Buffer.

export const CHUNK_SIZE = 1024 * 1024;
export const MAX_HTML_BYTES = 10 * 1024 * 1024;

export async function insertChunk(d1: D1Database, blobId: number, seq: number, data: Uint8Array): Promise<void> {
  await d1.prepare("INSERT INTO html_chunks (blob_id, seq, data) VALUES (?, ?, ?)").bind(blobId, seq, data).run();
}

export async function getChunk(d1: D1Database, blobId: number, seq: number): Promise<Uint8Array | null> {
  const data = await d1
    .prepare("SELECT data FROM html_chunks WHERE blob_id = ? AND seq = ?")
    .bind(blobId, seq)
    .first<ArrayBuffer | number[]>("data");
  if (data == null) return null;
  return Array.isArray(data) ? Uint8Array.from(data) : new Uint8Array(data);
}

export function deleteBlobStatements(d1: D1Database, blobId: number): D1PreparedStatement[] {
  return [
    d1.prepare("DELETE FROM html_chunks WHERE blob_id = ?").bind(blobId),
    d1.prepare("DELETE FROM html_blobs WHERE id = ?").bind(blobId),
  ];
}

// Streams a stored blob chunk by chunk; `transformFirst` lets the caller
// modify only the first chunk (render-time script injection, design.md 5.1).
export function blobStream(
  d1: D1Database,
  blobId: number,
  transformFirst?: (chunk: Uint8Array) => Uint8Array,
): ReadableStream<Uint8Array> {
  let seq = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await getChunk(d1, blobId, seq);
      if (!chunk) {
        if (seq === 0 && transformFirst) controller.enqueue(transformFirst(new Uint8Array()));
        controller.close();
        return;
      }
      controller.enqueue(seq === 0 && transformFirst ? transformFirst(chunk) : chunk);
      seq += 1;
    },
  });
}
