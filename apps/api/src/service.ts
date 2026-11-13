import { canEdit, editsAny, type ActiveKey, type Membership } from "@render-box/auth";
import { blobStream, deleteBlobStatements, MAX_HTML_BYTES } from "@render-box/db";
import {
  addComment,
  deleteOrphanBlobs,
  findDocument,
  hasErrors,
  insertDocument,
  listComments,
  listDocuments,
  listVersions,
  MAX_COMMENT_CHARS,
  readCommentBody,
  STORAGE_FULL_MESSAGE,
  storageLimits,
  storeUpload,
  updateDocument,
  UploadError,
  validateDocumentFields,
  type DocumentErrors,
  type DocumentFields,
  type DocumentRecord,
  type LinkRow,
} from "@render-box/documents";
import type { Env } from "./env";

// Document operations shared by the MCP tools and the REST API (design.md 11).
// Callers pass HTML as a byte stream; storeUpload enforces the 10MB limit.

export const PAGE_SIZE = 20;

// Expected failures (bad input, not found, conflict). MCP reports them as a
// tool result with isError; REST maps `status` to the HTTP status.
export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 412 | 413 | 422 | 507,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Ctx = { env: Env; key: ActiveKey };
export type LinkInput = { label?: string; url?: string };
export type FieldsInput = { title?: string; description?: string; links?: LinkInput[] };

const NOT_FOUND = "문서를 찾을 수 없습니다. 목록에서 문서 키를 확인해 주세요.";
const FORBIDDEN = "이 프로젝트의 편집 권한(EDITOR)이 있는 키만 문서를 올리거나 고칠 수 있습니다.";

// Editor in at least one project; the document's own project is checked on
// each write (design.md 3.9).
export function requireEditor(ctx: Ctx) {
  if (!editsAny(ctx.key.projects)) throw new ServiceError(403, "forbidden", FORBIDDEN);
}

const slugList = (ps: Membership[]) => ps.map((p) => p.slug).join(", ") || "없음";

// The project a new document goes into: the one named, or the only project
// this key edits.
function targetProject(ctx: Ctx, slug: string | undefined): Membership {
  const editable = ctx.key.projects.filter((p) => p.role === "EDITOR");
  if (slug === undefined || slug === "") {
    if (editable.length === 1) return editable[0]!;
    throw new ServiceError(400, "project_required", `올릴 프로젝트를 project로 지정해 주세요. 편집할 수 있는 프로젝트: ${slugList(editable)}`);
  }
  const project = ctx.key.projects.find((p) => p.slug === slug);
  if (!project) throw new ServiceError(404, "project_not_found", `속하지 않았거나 없는 프로젝트입니다: ${slug}. 속한 프로젝트: ${slugList(ctx.key.projects)}`);
  if (project.role !== "EDITOR") throw new ServiceError(403, "forbidden", FORBIDDEN);
  return project;
}

const urls = (env: Env, key: string) => ({
  render_url: `${env.RENDER_ORIGIN}/${key}`,
  admin_url: `${env.APP_ORIGIN}/html/${key}`,
});

const normalizeDescription = (s: string) => s.replace(/\r\n/g, "\n").trim();
const toLinkRows = (links: LinkInput[]): LinkRow[] =>
  links.map((l) => ({ label: (l.label ?? "").trim(), url: (l.url ?? "").trim() }));

function checkFields(fields: DocumentFields) {
  const { errors, links } = validateDocumentFields(fields);
  if (hasErrors(errors)) throw new ServiceError(400, "invalid_fields", describeErrors(errors, fields.links));
  return links;
}

function describeErrors(errors: DocumentErrors, rows: LinkRow[]): string {
  const lines = [errors.title, errors.description, errors.links].filter(Boolean) as string[];
  rows.forEach((row, i) => {
    if (row.error) lines.push(`링크 ${i + 1}: ${row.error}`);
  });
  return lines.join("\n");
}

// `declaredSize` is the Content-Length when known, so a full store is refused
// before reading the body (design.md 4.9).
async function storeHtml(ctx: Ctx, body: ReadableStream<Uint8Array>, declaredSize?: number) {
  await deleteOrphanBlobs(ctx.env.DB, ctx.key.id);
  try {
    return await storeUpload(ctx.env.DB, body, ctx.key.id, {
      limitBytes: storageLimits(ctx.env).limit,
      declaredSize,
    });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    if (err.message === "storage_full") throw new ServiceError(507, "storage_full", STORAGE_FULL_MESSAGE);
    if (err.message === "too_large") {
      throw new ServiceError(413, "too_large", `HTML이 ${MAX_HTML_BYTES / 1024 / 1024}MB를 넘습니다.`);
    }
    if (err.message === "empty") throw new ServiceError(422, "empty", "HTML 내용이 비어 있습니다.");
    throw new ServiceError(422, "nul_byte", "HTML에 NUL 문자가 들어 있습니다.");
  }
}

// Documents of projects this key is not in look exactly like missing ones.
async function loadDocument(ctx: Ctx, documentKey: string): Promise<DocumentRecord> {
  const doc = await findDocument(ctx.env.DB, documentKey);
  if (!doc || !ctx.key.projects.some((p) => p.projectId === doc.projectId)) {
    throw new ServiceError(404, "not_found", NOT_FOUND);
  }
  return doc;
}

export type HtmlInput = { body: ReadableStream<Uint8Array>; size?: number };

export async function createHtml(
  ctx: Ctx,
  input: { title: string; description?: string; links?: LinkInput[]; project?: string },
  html: HtmlInput,
) {
  requireEditor(ctx);
  const project = targetProject(ctx, input.project);
  const title = input.title.trim();
  const description = normalizeDescription(input.description ?? "");
  const links = checkFields({ title, description, links: toLinkRows(input.links ?? []) });
  const blob = await storeHtml(ctx, html.body, html.size);
  const key = await insertDocument(ctx.env.DB, { title, description, links, blob, projectId: project.projectId, keyId: ctx.key.id });
  return { document_key: key, project: project.slug, title, ...urls(ctx.env, key), html_size: blob.size, version: 1 };
}

// Fields left undefined keep their current value. `expectedVersion` comes from
// If-Match; without it the update applies to whatever version was just read.
export async function updateHtml(
  ctx: Ctx,
  documentKey: string,
  input: FieldsInput,
  html: HtmlInput | null,
  expectedVersion?: number,
) {
  requireEditor(ctx);
  const doc = await loadDocument(ctx, documentKey);
  if (!canEdit(ctx.key.projects, doc.projectId)) throw new ServiceError(403, "forbidden", FORBIDDEN);
  if (expectedVersion !== undefined && expectedVersion !== doc.version) {
    throw new ServiceError(412, "version_mismatch", conflictMessage(doc.version));
  }
  const fields = {
    title: input.title !== undefined ? input.title.trim() : doc.title,
    description: input.description !== undefined ? normalizeDescription(input.description) : (doc.description ?? ""),
    links: input.links !== undefined ? toLinkRows(input.links) : doc.links.map((l) => ({ ...l })),
  };
  const links = checkFields(fields);
  const blob = html ? await storeHtml(ctx, html.body, html.size) : null;

  const updated = await updateDocument(ctx.env.DB, {
    id: doc.id,
    version: doc.version,
    title: fields.title,
    description: fields.description,
    links,
    blob,
    keyId: ctx.key.id,
  });
  if (!updated) {
    if (blob) await ctx.env.DB.batch(deleteBlobStatements(ctx.env.DB, blob.id));
    throw new ServiceError(409, "conflict", "다른 사람이 방금 이 문서를 수정했습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.");
  }
  // The previous HTML stays as a version (design.md 4.9).
  return {
    document_key: doc.documentKey,
    project: doc.projectSlug,
    title: fields.title,
    ...urls(ctx.env, doc.documentKey),
    html_size: blob?.size ?? doc.htmlSize,
    html_replaced: blob !== null,
    version: doc.version + 1,
  };
}

const conflictMessage = (current: number) =>
  `문서가 그 사이 수정되었습니다 (현재 버전 ${current}). 최신 내용을 확인한 뒤 다시 시도해 주세요.`;

// All projects this key is in, or just the one named.
export async function listHtml(ctx: Ctx, input: { query?: string; page?: number; project?: string }) {
  const page = input.page ?? 1;
  let projects = ctx.key.projects;
  if (input.project) {
    projects = projects.filter((p) => p.slug === input.project);
    if (projects.length === 0) {
      throw new ServiceError(404, "project_not_found", `속하지 않았거나 없는 프로젝트입니다: ${input.project}. 속한 프로젝트: ${slugList(ctx.key.projects)}`);
    }
  }
  const { rows, total } = await listDocuments(ctx.env.DB, {
    q: (input.query ?? "").trim().slice(0, 200),
    page,
    pageSize: PAGE_SIZE,
    projectIds: projects.map((p) => p.projectId),
  });
  return {
    total,
    page,
    page_count: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    documents: rows.map((r) => ({
      document_key: r.documentKey,
      project: r.projectSlug,
      title: r.title,
      render_url: `${ctx.env.RENDER_ORIGIN}/${r.documentKey}`,
      html_size: r.htmlSize,
      comment_count: r.commentCount,
      updated_by: r.updatedByName,
      updated_at: new Date(r.updatedAt).toISOString(),
    })),
  };
}

export async function getHtml(ctx: Ctx, documentKey: string) {
  const doc = await loadDocument(ctx, documentKey);
  return {
    info: {
      document_key: doc.documentKey,
      project: doc.projectSlug,
      title: doc.title,
      description: doc.description ?? "",
      links: doc.links,
      ...urls(ctx.env, doc.documentKey),
      html_size: doc.htmlSize,
      version: doc.version,
      created_by: doc.createdByName,
      created_at: new Date(doc.createdAt).toISOString(),
      updated_by: doc.updatedByName,
      updated_at: new Date(doc.updatedAt).toISOString(),
    },
    source: () => blobStream(ctx.env.DB, doc.blobId),
  };
}

export async function listHtmlVersions(ctx: Ctx, documentKey: string) {
  const doc = await loadDocument(ctx, documentKey);
  const versions = await listVersions(ctx.env.DB, doc.id);
  return {
    document_key: doc.documentKey,
    versions: versions.map((v, i) => ({
      seq: v.seq,
      current: i === 0,
      render_url: i === 0 ? `${ctx.env.RENDER_ORIGIN}/${doc.documentKey}` : `${ctx.env.RENDER_ORIGIN}/${doc.documentKey}/v/${v.seq}`,
      html_size: v.htmlSize,
      restored_from: v.restoredFrom,
      created_by: v.createdByName,
      created_at: new Date(v.createdAt).toISOString(),
    })),
  };
}

// Memos (design.md 4.10): any member may read and add, viewers included.
// Editing and deleting stay in the web screen.
export async function listHtmlComments(ctx: Ctx, documentKey: string) {
  const doc = await loadDocument(ctx, documentKey);
  const comments = await listComments(ctx.env.DB, doc.id);
  return {
    document_key: doc.documentKey,
    comments: comments.map((m) => ({
      id: m.id,
      author: m.authorName,
      // HTML version (seq in /versions) that was current when written.
      html_version: m.versionSeq,
      body: m.body,
      created_at: new Date(m.createdAt).toISOString(),
      updated_at: m.updatedAt ? new Date(m.updatedAt).toISOString() : null,
    })),
  };
}

export async function addHtmlComment(ctx: Ctx, documentKey: string, body: string) {
  const doc = await loadDocument(ctx, documentKey);
  const text = readCommentBody(body);
  if (!text) {
    throw new ServiceError(400, "invalid_fields", `메모는 비어 있을 수 없고, ${MAX_COMMENT_CHARS.toLocaleString("en-US")}자까지 쓸 수 있습니다.`);
  }
  await addComment(ctx.env.DB, { documentId: doc.id, keyId: ctx.key.id, body: text });
  return { ...(await listHtmlComments(ctx, documentKey)), admin_url: `${ctx.env.APP_ORIGIN}/html/${doc.documentKey}#comments` };
}
