import { beforeEach, describe, expect, it } from "vitest";
import { addComment, deleteComment, deleteDocument, findDocument, insertDocument, listComments, listDocuments, storeUpload, updateDocument } from "../src";
import { count, createTestD1, streamOf, type TestD1 } from "./d1-sqlite";

// Memo SQL against the real migrations (design.md 4.10): ownership checks,
// version tagging, counts, and cleanup when the document goes.

let d1: TestD1;
let author: number;
let other: number;
let projectId: number;

const newKey = (name: string) =>
  Number(
    d1.sqlite
      .prepare("INSERT INTO access_keys (name, key_hash, key_prefix, created_at) VALUES (?, ?, 'rb_x', 0) RETURNING id")
      .get(name, `h-${name}`)!.id,
  );

beforeEach(() => {
  d1 = createTestD1();
  author = newKey("author");
  other = newKey("other");
  projectId = Number(d1.sqlite.prepare("INSERT INTO projects (slug, name, created_at) VALUES ('p', 'P', 0) RETURNING id").get()!.id);
});

async function newDocument() {
  const html = "<p>x";
  const blob = await storeUpload(d1, streamOf(html), author, { limitBytes: 10_000, declaredSize: html.length });
  const key = await insertDocument(d1, { title: "doc", description: "", links: [], blob, projectId, keyId: author });
  return (await findDocument(d1, key))!;
}

describe("memos", () => {
  it("tags the current HTML version and lists oldest first with the author's name", async () => {
    const doc = await newDocument();
    await addComment(d1, { documentId: doc.id, keyId: author, body: "first", now: 1 });
    const blob = await storeUpload(d1, streamOf("<p>v2"), author, { limitBytes: 10_000, declaredSize: 5 });
    await updateDocument(d1, { id: doc.id, version: doc.version, title: "doc", description: "", links: [], blob, keyId: author });
    await addComment(d1, { documentId: doc.id, keyId: other, body: "second", now: 2 });
    expect((await listComments(d1, doc.id)).map((m) => [m.body, m.versionSeq, m.authorName])).toEqual([
      ["first", 1, "author"],
      ["second", 2, "other"],
    ]);
    const { rows } = await listDocuments(d1, { q: "", page: 1, pageSize: 20, projectIds: [projectId] });
    expect(rows[0]!.commentCount).toBe(2);
  });

  it("only the author deletes their memo unless anyAuthor; another document's id does nothing", async () => {
    const doc = await newDocument();
    const second = await newDocument();
    await addComment(d1, { documentId: doc.id, keyId: author, body: "mine" });
    const [memo] = await listComments(d1, doc.id);
    expect(await deleteComment(d1, { id: memo!.id, documentId: doc.id, keyId: other, anyAuthor: false })).toBe(false);
    expect(await deleteComment(d1, { id: memo!.id, documentId: second.id, keyId: author, anyAuthor: true })).toBe(false);
    expect(await deleteComment(d1, { id: memo!.id, documentId: doc.id, keyId: other, anyAuthor: true })).toBe(true);
    expect(await listComments(d1, doc.id)).toEqual([]);
  });

  it("deleting a document removes its memos (foreign keys stay satisfied)", async () => {
    const doc = await newDocument();
    await addComment(d1, { documentId: doc.id, keyId: other, body: "bye" });
    await deleteDocument(d1, doc.id);
    expect(count(d1, "document_comments")).toBe(0);
    expect(count(d1, "html_documents")).toBe(0);
  });
});
