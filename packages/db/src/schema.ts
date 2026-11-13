import { sql } from "drizzle-orm";
import { customType, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Chunk bytes are read and written through chunks.ts; this type only shapes
// the migration (BLOB column) without depending on Node's Buffer.
const bytes = customType<{ data: Uint8Array; driverData: ArrayBuffer }>({
  dataType: () => "blob",
});

// Timestamps are Unix epoch milliseconds (design.md 6).

export const accessKeys = sqliteTable("access_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  // Manages every project's documents without memberships; set only by CLI
  // (design.md 3.9, D-38).
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  revokedAt: integer("revoked_at"),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
});

export type Role = "EDITOR" | "VIEWER";

// A document belongs to one project; a key has a role per project
// (design.md 3.9, 6.7).
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const keyProjects = sqliteTable(
  "key_projects",
  {
    keyId: integer("key_id")
      .notNull()
      .references(() => accessKeys.id),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    role: text("role", { enum: ["EDITOR", "VIEWER"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.projectId] }), index("key_projects_project_id_idx").on(t.projectId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    keyId: integer("key_id")
      .notNull()
      .references(() => accessKeys.id),
    host: text("host", { enum: ["APP", "RENDER"] }).notNull(),
    familyId: text("family_id").notNull(),
    csrfToken: text("csrf_token"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("sessions_key_id_idx").on(t.keyId), index("sessions_family_id_idx").on(t.familyId)],
);

export const loginFailures = sqliteTable(
  "login_failures",
  {
    ip: text("ip").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("login_failures_ip_at_idx").on(t.ip, t.at)],
);

export const htmlBlobs = sqliteTable("html_blobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  size: integer("size").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => accessKeys.id),
  createdAt: integer("created_at").notNull(),
});

export const htmlChunks = sqliteTable(
  "html_chunks",
  {
    blobId: integer("blob_id")
      .notNull()
      .references(() => htmlBlobs.id),
    seq: integer("seq").notNull(),
    data: bytes("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blobId, t.seq] })],
);

export type DocumentLink = { label: string; url: string };

export const htmlDocuments = sqliteTable(
  "html_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentKey: text("document_key").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    links: text("links", { mode: "json" }).$type<DocumentLink[]>().notNull().default(sql`'[]'`),
    blobId: integer("blob_id")
      .notNull()
      .references(() => htmlBlobs.id),
    // No foreign key: SQLite cannot ALTER TABLE ADD a NOT NULL column with
    // one, so the code keeps it pointing at projects.id (design.md 6.7).
    projectId: integer("project_id").notNull().default(0),
    htmlSize: integer("html_size").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by")
      .notNull()
      .references(() => accessKeys.id),
    updatedBy: integer("updated_by")
      .notNull()
      .references(() => accessKeys.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("html_documents_updated_at_idx").on(t.updatedAt),
    index("html_documents_blob_id_idx").on(t.blobId),
    index("html_documents_project_id_idx").on(t.projectId),
  ],
);

// Every HTML a document has had, including the current one (the highest seq).
// Restoring adds a row that points at an older blob; blobs never change, so
// they can be shared (design.md 4.9, 6.6).
export const htmlDocumentVersions = sqliteTable(
  "html_document_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: integer("document_id")
      .notNull()
      .references(() => htmlDocuments.id),
    seq: integer("seq").notNull(),
    blobId: integer("blob_id")
      .notNull()
      .references(() => htmlBlobs.id),
    htmlSize: integer("html_size").notNull(),
    restoredFrom: integer("restored_from"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => accessKeys.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("html_document_versions_document_seq_unique").on(t.documentId, t.seq),
    index("html_document_versions_blob_id_idx").on(t.blobId),
  ],
);

// Memos on a document, like comments: any member of its project may write
// one, including viewers (design.md 4.10). Plain text; version_seq is the
// HTML version that was current when it was written.
export const documentComments = sqliteTable(
  "document_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: integer("document_id")
      .notNull()
      .references(() => htmlDocuments.id),
    keyId: integer("key_id")
      .notNull()
      .references(() => accessKeys.id),
    versionSeq: integer("version_seq").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at"),
  },
  (t) => [index("document_comments_document_id_idx").on(t.documentId, t.id)],
);
