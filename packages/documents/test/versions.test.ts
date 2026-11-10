import { blobStream } from "@render-box/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteDocument,
  deleteOrphanBlobs,
  deleteVersions,
  findAttachableBlob,
  findDocument,
  insertDocument,
  listDocuments,
  listPreviousVersions,
  listVersions,
  projectUsage,
  storageUsage,
  storeUpload,
  updateDocument,
  UploadError,
} from "../src";
import { applyMigration, count, createTestD1, streamOf, type TestD1 } from "./d1-sqlite";

// Storage cap, versions and blob sharing against the real migrations
// (design.md 4.9). Runs on Node's SQLite, so no dev server is needed.

const LIMIT = 1000;
const HOUR = 60 * 60 * 1000;

let d1: TestD1;
let keyId: number;
let projectId: number;

const newProject = (slug: string) =>
  Number(d1.sqlite.prepare("INSERT INTO projects (slug, name, created_at) VALUES (?, ?, 0) RETURNING id").get(slug, slug)!.id);

beforeEach(() => {
  d1 = createTestD1();
  keyId = Number(
    d1.sqlite
      .prepare("INSERT INTO access_keys (name, key_hash, key_prefix, created_at) VALUES ('t', 'h', 'rb_t', 0) RETURNING id")
      .get()!.id,
  );
  projectId = newProject("main");
});

const store = (text: string, opts: { declared?: boolean; now?: number } = {}) =>
  storeUpload(d1, streamOf(text), keyId, {
    limitBytes: LIMIT,
    declaredSize: opts.declared === false ? undefined : new TextEncoder().encode(text).length,
    now: opts.now,
  });

const text = async (blobId: number) => new Response(blobStream(d1, blobId)).text();

async function newDocument(html: string, project = projectId) {
  const blob = await store(html);
  const key = await insertDocument(d1, { title: "doc", description: "", links: [], blob, projectId: project, keyId });
  return (await findDocument(d1, key))!;
}

async function replace(documentKey: string, html: string) {
  const doc = (await findDocument(d1, documentKey))!;
  const blob = await store(html);
  const ok = await updateDocument(d1, { ...fields(doc), blob, keyId });
  expect(ok).toBe(true);
  return blob;
}

const fields = (doc: { id: number; version: number; title: string; description: string | null; links: never[] }) => ({
  id: doc.id,
  version: doc.version,
  title: doc.title,
  description: doc.description ?? "",
  links: doc.links,
});

describe("storage cap", () => {
  it("accepts uploads up to the cap and counts every blob", async () => {
    await store("a".repeat(600));
    await store("b".repeat(400));
    expect((await storageUsage(d1, { limit: LIMIT, warnAt: 800 })).used).toBe(1000);
  });

  it("refuses a body whose declared size would pass the cap, before storing anything", async () => {
    await store("a".repeat(600));
    await expect(store("b".repeat(500))).rejects.toMatchObject({ status: 507, message: "storage_full" });
    expect(count(d1, "html_blobs")).toBe(1);
  });

  it("stops a body without a declared size once it passes the cap, and removes what it stored", async () => {
    await store("a".repeat(600));
    const err = await store("b".repeat(5000), { declared: false }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ status: 507, message: "storage_full" });
    expect(count(d1, "html_blobs")).toBe(1);
    expect(count(d1, "html_chunks")).toBe(1);
  });
});

describe("versions", () => {
  it("creating a document makes version 1", async () => {
    const doc = await newDocument("<p>v1</p>");
    const versions = await listVersions(d1, doc.id);
    expect(versions.map((v) => [v.seq, v.blobId])).toEqual([[1, doc.blobId]]);
  });

  it("replacing keeps the previous HTML as a version and counts it as previous storage", async () => {
    const doc = await newDocument("<p>v1</p>");
    const v2 = await replace(doc.documentKey, "<p>v2!</p>");
    const versions = await listVersions(d1, doc.id);
    expect(versions.map((v) => v.seq)).toEqual([2, 1]);
    expect((await findDocument(d1, doc.documentKey))!.blobId).toBe(v2.id);
    expect(await text(versions[1]!.blobId)).toBe("<p>v1</p>");
    const usage = await storageUsage(d1, { limit: LIMIT, warnAt: 800 });
    expect(usage).toMatchObject({ used: 9 + 10, previous: 9 });
  });

  it("changing only title/description/links adds no version", async () => {
    const doc = await newDocument("<p>v1</p>");
    expect(await updateDocument(d1, { ...fields(doc), title: "new", blob: null, keyId })).toBe(true);
    expect((await listVersions(d1, doc.id)).map((v) => v.seq)).toEqual([1]);
  });

  it("restore points a new version at the old blob without copying it", async () => {
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    const blobsBefore = count(d1, "html_blobs");
    const current = (await findDocument(d1, doc.documentKey))!;
    const v1 = (await listVersions(d1, doc.id))[1]!;
    expect(
      await updateDocument(d1, { ...fields(current), blob: { id: v1.blobId, size: v1.htmlSize }, restoredFrom: 1, keyId }),
    ).toBe(true);
    const versions = await listVersions(d1, doc.id);
    expect(versions.map((v) => [v.seq, v.restoredFrom])).toEqual([
      [3, 1],
      [2, null],
      [1, null],
    ]);
    expect(versions[0]!.blobId).toBe(v1.blobId);
    expect(count(d1, "html_blobs")).toBe(blobsBefore);
    expect((await findDocument(d1, doc.documentKey))!.blobId).toBe(v1.blobId);
  });

  it("a stale update changes nothing and adds no version", async () => {
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    const blob = await store("<p>late</p>");
    expect(await updateDocument(d1, { ...fields(doc), blob, keyId })).toBe(false);
    expect((await listVersions(d1, doc.id)).map((v) => v.seq)).toEqual([2, 1]);
  });

  it("version numbers are not reused after deleting a version", async () => {
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    const v1 = (await listVersions(d1, doc.id))[1]!;
    expect(await deleteVersions(d1, [v1.id], [projectId])).toBe(1);
    await replace(doc.documentKey, "<p>v3</p>");
    expect((await listVersions(d1, doc.id)).map((v) => v.seq)).toEqual([3, 2]);
  });
});

describe("deleting versions", () => {
  it("never deletes the current version", async () => {
    const doc = await newDocument("<p>v1</p>");
    const [current] = await listVersions(d1, doc.id);
    expect(await deleteVersions(d1, [current!.id], [projectId])).toBe(0);
    expect(await text((await findDocument(d1, doc.documentKey))!.blobId)).toBe("<p>v1</p>");
  });

  it("frees a blob only when nothing else uses it", async () => {
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    const current = (await findDocument(d1, doc.documentKey))!;
    const v1 = (await listVersions(d1, doc.id))[1]!;
    await updateDocument(d1, { ...fields(current), blob: { id: v1.blobId, size: v1.htmlSize }, restoredFrom: 1, keyId });

    // v1 shares its blob with the current v3: deleting it frees nothing.
    const previous = await listPreviousVersions(d1, [projectId]);
    expect(previous.map((p) => [p.seq, p.freesBytes])).toEqual([
      [2, 9],
      [1, 0],
    ]);
    expect(await deleteVersions(d1, [v1.id], [projectId])).toBe(1);
    expect(await text((await findDocument(d1, doc.documentKey))!.blobId)).toBe("<p>v1</p>");

    // v2's blob is used by nothing else: its blob and chunks go.
    const v2 = (await listVersions(d1, doc.id)).find((v) => v.seq === 2)!;
    const blobs = count(d1, "html_blobs");
    expect(await deleteVersions(d1, [v2.id], [projectId])).toBe(1);
    expect(count(d1, "html_blobs")).toBe(blobs - 1);
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM html_chunks WHERE blob_id = ?").get(v2.blobId)).toEqual({ n: 0 });
  });

  it("keeps a blob that another previous version still uses", async () => {
    // v1 (A) → v2 (B) → v3 restores v1 (A) → v4 (C): v1 and v3 share A, the
    // document shows C, so only the version check protects A.
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    const v1 = (await listVersions(d1, doc.id))[1]!;
    const current = (await findDocument(d1, doc.documentKey))!;
    await updateDocument(d1, { ...fields(current), blob: { id: v1.blobId, size: v1.htmlSize }, restoredFrom: 1, keyId });
    await replace(doc.documentKey, "<p>v4</p>");

    expect(await deleteVersions(d1, [v1.id], [projectId])).toBe(1);
    const v3 = (await listVersions(d1, doc.id)).find((v) => v.seq === 3)!;
    expect(v3.blobId).toBe(v1.blobId);
    expect(await text(v3.blobId)).toBe("<p>v1</p>");
  });

  it("ignores ids that are not numbers or do not exist", async () => {
    expect(await deleteVersions(d1, [Number.NaN, -1, 999], [projectId])).toBe(0);
  });
});

describe("uploads and versions", () => {
  it("orphan cleanup and attach checks leave versioned blobs alone", async () => {
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    const v1 = (await listVersions(d1, doc.id))[1]!;
    const stray = await store("<p>never saved</p>", { now: Date.now() - 2 * HOUR });

    await deleteOrphanBlobs(d1, keyId);
    expect(await text(v1.blobId)).toBe("<p>v1</p>");
    expect(d1.sqlite.prepare("SELECT id FROM html_blobs WHERE id = ?").get(stray.id)).toBeUndefined();
    // A previous version's blob cannot be attached as a fresh upload.
    expect(await findAttachableBlob(d1, v1.blobId, keyId)).toBeNull();
  });

  it("deleting a document removes all its versions, blobs and chunks", async () => {
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2</p>");
    await deleteDocument(d1, doc.id);
    expect(count(d1, "html_documents")).toBe(0);
    expect(count(d1, "html_document_versions")).toBe(0);
    expect(count(d1, "html_blobs")).toBe(0);
    expect(count(d1, "html_chunks")).toBe(0);
  });
});

describe("projects", () => {
  it("lists only the given projects' documents", async () => {
    const other = newProject("other");
    const mine = await newDocument("<p>mine</p>");
    await newDocument("<p>theirs</p>", other);
    const list = (ids: number[]) => listDocuments(d1, { q: "", page: 1, pageSize: 20, projectIds: ids });
    expect((await list([projectId])).rows.map((r) => [r.documentKey, r.projectSlug])).toEqual([[mine.documentKey, "main"]]);
    expect((await list([projectId, other])).total).toBe(2);
    expect(await list([])).toEqual({ rows: [], total: 0 });
  });

  it("never deletes or lists versions of a project the caller does not edit", async () => {
    const other = newProject("other");
    const theirs = await newDocument("<p>t1</p>", other);
    await replace(theirs.documentKey, "<p>t2</p>");
    const old = (await listVersions(d1, theirs.id))[1]!;
    // A forged form naming another project's version id deletes nothing.
    expect(await deleteVersions(d1, [old.id], [projectId])).toBe(0);
    expect(await listPreviousVersions(d1, [projectId])).toEqual([]);
    expect((await listPreviousVersions(d1, [other])).map((v) => v.id)).toEqual([old.id]);
    expect(await deleteVersions(d1, [old.id], [other])).toBe(1);
  });

  it("counts usage per project, each blob once", async () => {
    const other = newProject("other");
    const doc = await newDocument("<p>v1</p>");
    await replace(doc.documentKey, "<p>v2!</p>");
    await newDocument("<p>xx</p>", other);
    const usage = await projectUsage(d1, [projectId, other, 999]);
    expect([...usage]).toEqual([
      [projectId, 9 + 10],
      [other, 9],
      [999, 0],
    ]);
  });
});

describe("migration 0002", () => {
  it("moves documents and keys, with their roles, into a default project", () => {
    const old = createTestD1({ migrations: ["0000_init.sql", "0001_versions.sql"] });
    old.sqlite.exec(`
      INSERT INTO access_keys (id, name, role, key_hash, key_prefix, created_at) VALUES
        (1, 'e', 'EDITOR', 'h1', 'rb_e', 0), (2, 'v', 'VIEWER', 'h2', 'rb_v', 0);
      INSERT INTO html_blobs (id, size, created_by, created_at) VALUES (7, 3, 1, 0);
      INSERT INTO html_documents (document_key, title, links, blob_id, html_size, created_by, updated_by, created_at, updated_at)
        VALUES ('k', 't', '[]', 7, 3, 1, 1, 0, 0);
    `);
    applyMigration(old.sqlite, "0002_projects.sql");
    const q = (sql: string) => old.sqlite.prepare(sql).all();
    expect(q("SELECT slug, name FROM projects")).toEqual([{ slug: "default", name: "기본" }]);
    expect(q("SELECT key_id, role FROM key_projects ORDER BY key_id")).toEqual([
      { key_id: 1, role: "EDITOR" },
      { key_id: 2, role: "VIEWER" },
    ]);
    expect(q("SELECT project_id FROM html_documents")).toEqual([{ project_id: 1 }]);
    expect(q("PRAGMA table_info(access_keys)").map((c) => (c as { name: string }).name)).not.toContain("role");
  });
});

describe("migration 0001", () => {
  it("backfills each existing document as version 1", async () => {
    const old = createTestD1({ migrations: ["0000_init.sql"] });
    old.sqlite.exec(`
      INSERT INTO access_keys (id, name, role, key_hash, key_prefix, created_at) VALUES (1, 't', 'EDITOR', 'h', 'rb_t', 0);
      INSERT INTO html_blobs (id, size, created_by, created_at) VALUES (7, 3, 1, 123);
      INSERT INTO html_documents (document_key, title, links, blob_id, html_size, created_by, updated_by, created_at, updated_at)
        VALUES ('k', 't', '[]', 7, 3, 1, 1, 0, 0);
    `);
    applyMigration(old.sqlite, "0001_versions.sql");
    expect(old.sqlite.prepare("SELECT seq, blob_id, html_size, created_at FROM html_document_versions").all()).toEqual([
      { seq: 1, blob_id: 7, html_size: 3, created_at: 123 },
    ]);
  });
});
