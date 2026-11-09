import type { ActiveKey } from "@render-box/auth";
import { blobStream, deleteBlobStatements } from "@render-box/db";
import {
  deleteOrphanBlobs,
  findDocument,
  hasErrors,
  insertDocument,
  listDocuments,
  storeUpload,
  updateDocument,
  UploadError,
  validateDocumentFields,
  type DocumentErrors,
  type DocumentFields,
  type LinkRow,
} from "@render-box/documents";
import { z } from "zod";
import type { Env } from "./env";

// AI clients send the whole HTML inside one JSON-RPC message, which the
// Worker must parse; keep it well under the web upload limit so parsing stays
// within the free plan's CPU budget (design.md 11).
export const MAX_MCP_HTML_BYTES = 1024 * 1024;
const PAGE_SIZE = 20;

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// Expected failures (bad input, not found, conflict) reported back to the AI
// as a tool result so it can fix the call, not as a protocol error.
export class ToolError extends Error {}

type Ctx = { env: Env; key: ActiveKey };

const link = z.object({
  label: z.string().optional().describe("링크 이름 (예: 기획서). 비우면 사이트 주소로 표시"),
  url: z.string().describe("http:// 또는 https:// 주소"),
});

const documentKey = z.string().describe("문서 키 (22자). upload_html이나 list_html 결과의 document_key");

const schemas = {
  upload_html: z.object({
    title: z.string().describe("문서 제목 (최대 200자)"),
    html: z
      .string()
      .describe(
        "완성된 HTML 문서 전체. 같은 폴더의 이미지·스크립트 파일은 함께 올라가지 않으므로 이미지는 data: URL(base64)이나 https 주소로 넣는다. 최대 1MB",
      ),
    description: z.string().optional().describe("설명 (최대 2,000자, 줄바꿈 유지)"),
    links: z.array(link).optional().describe("관련 링크 (최대 10개)"),
  }),
  update_html: z.object({
    document_key: documentKey,
    title: z.string().optional().describe("바꿀 제목. 빼면 그대로"),
    html: z.string().optional().describe("바꿀 HTML 전체. 빼면 지금 HTML을 유지. 주소는 바뀌지 않는다"),
    description: z.string().optional().describe("바꿀 설명. 빼면 그대로, 빈 문자열이면 지움"),
    links: z.array(link).optional().describe("바꿀 링크 목록 전체. 빼면 그대로, 빈 배열이면 모두 지움"),
  }),
  list_html: z.object({
    query: z.string().optional().describe("제목 일부 또는 문서 키 앞부분"),
    page: z.number().int().min(1).optional().describe("페이지 (1부터, 한 페이지 20개)"),
  }),
  get_html: z.object({
    document_key: documentKey,
    include_source: z.boolean().optional().describe("true면 HTML 원본도 함께 돌려줌 (1MB 이하일 때)"),
  }),
};

type ToolName = keyof typeof schemas;

const toolMeta: Record<
  ToolName,
  { title: string; description: string; editorOnly: boolean; annotations: Record<string, boolean> }
> = {
  upload_html: {
    title: "HTML 올리기",
    description:
      "HTML 문서를 render-box에 새로 올리고, 팀원이 새 창에서 볼 수 있는 렌더링 URL(render_url)을 돌려준다. 올린 뒤 render_url을 사용자에게 알려 준다.",
    editorOnly: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  update_html: {
    title: "HTML 수정",
    description:
      "이미 올린 문서의 HTML이나 제목·설명·링크를 바꾼다. 넘긴 항목만 바뀌고 렌더링 URL은 그대로다.",
    editorOnly: true,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  list_html: {
    title: "문서 목록",
    description: "render-box에 올라온 문서를 최근 수정 순으로 찾는다.",
    editorOnly: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_html: {
    title: "문서 보기",
    description: "문서 하나의 정보(제목, 설명, 링크, 렌더링 URL)와, 원하면 HTML 원본을 가져온다.",
    editorOnly: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};

function inputSchema(schema: z.ZodType) {
  const { $schema: _, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

// Tools this key may call; VIEWER keys only see the read-only ones.
export function listTools(key: ActiveKey) {
  return (Object.keys(schemas) as ToolName[])
    .filter((name) => key.role === "EDITOR" || !toolMeta[name].editorOnly)
    .map((name) => ({
      name,
      title: toolMeta[name].title,
      description: toolMeta[name].description,
      inputSchema: inputSchema(schemas[name]),
      annotations: toolMeta[name].annotations,
    }));
}

export function isToolName(name: unknown): name is ToolName {
  return typeof name === "string" && Object.hasOwn(schemas, name);
}

export async function callTool(ctx: Ctx, name: ToolName, args: unknown): Promise<ToolResult> {
  if (toolMeta[name].editorOnly && ctx.key.role !== "EDITOR") {
    throw new ToolError("편집 권한(EDITOR)이 있는 키만 문서를 올리거나 고칠 수 있습니다.");
  }
  const parsed = schemas[name].safeParse(args ?? {});
  if (!parsed.success) {
    throw new ToolError(`입력값이 올바르지 않습니다: ${z.prettifyError(parsed.error)}`);
  }
  switch (name) {
    case "upload_html":
      return uploadHtml(ctx, parsed.data as z.infer<(typeof schemas)["upload_html"]>);
    case "update_html":
      return updateHtml(ctx, parsed.data as z.infer<(typeof schemas)["update_html"]>);
    case "list_html":
      return listHtml(ctx, parsed.data as z.infer<(typeof schemas)["list_html"]>);
    case "get_html":
      return getHtml(ctx, parsed.data as z.infer<(typeof schemas)["get_html"]>);
  }
}

function result(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

const urls = (env: Env, key: string) => ({
  render_url: `${env.RENDER_ORIGIN}/${key}`,
  admin_url: `${env.APP_ORIGIN}/html/${key}`,
});

const toLinkRows = (links: { label?: string; url: string }[]): LinkRow[] =>
  links.map((l) => ({ label: (l.label ?? "").trim(), url: l.url.trim() }));

function checkFields(fields: DocumentFields) {
  const { errors, links } = validateDocumentFields(fields);
  if (hasErrors(errors)) throw new ToolError(describeErrors(errors, fields.links));
  return links;
}

function describeErrors(errors: DocumentErrors, rows: LinkRow[]): string {
  const lines = [errors.title, errors.description, errors.links].filter(Boolean) as string[];
  rows.forEach((row, i) => {
    if (row.error) lines.push(`링크 ${i + 1}: ${row.error}`);
  });
  return lines.join("\n");
}

async function storeHtml(ctx: Ctx, html: string) {
  const bytes = new TextEncoder().encode(html);
  if (bytes.length > MAX_MCP_HTML_BYTES) {
    throw new ToolError(
      `HTML이 1MB를 넘습니다 (${(bytes.length / 1024 / 1024).toFixed(1)}MB). 이미지 크기를 줄이거나, 큰 파일은 웹 화면에서 올려 주세요.`,
    );
  }
  await deleteOrphanBlobs(ctx.env.DB, ctx.key.id);
  try {
    return await storeUpload(ctx.env.DB, new Response(bytes).body!, ctx.key.id);
  } catch (err) {
    if (err instanceof UploadError) {
      throw new ToolError(err.message === "empty" ? "HTML 내용이 비어 있습니다." : "HTML에 NUL 문자가 들어 있습니다.");
    }
    throw err;
  }
}

async function uploadHtml(ctx: Ctx, input: z.infer<(typeof schemas)["upload_html"]>): Promise<ToolResult> {
  const links = checkFields({
    title: input.title.trim(),
    description: (input.description ?? "").replace(/\r\n/g, "\n").trim(),
    links: toLinkRows(input.links ?? []),
  });
  const blob = await storeHtml(ctx, input.html);
  const key = await insertDocument(ctx.env.DB, {
    title: input.title.trim(),
    description: (input.description ?? "").replace(/\r\n/g, "\n").trim(),
    links,
    blob,
    keyId: ctx.key.id,
  });
  return result({ document_key: key, title: input.title.trim(), ...urls(ctx.env, key), html_size: blob.size });
}

async function updateHtml(ctx: Ctx, input: z.infer<(typeof schemas)["update_html"]>): Promise<ToolResult> {
  const doc = await findDocument(ctx.env.DB, input.document_key);
  if (!doc) throw new ToolError("문서를 찾을 수 없습니다. list_html로 문서 키를 확인해 주세요.");

  const fields = {
    title: input.title !== undefined ? input.title.trim() : doc.title,
    description:
      input.description !== undefined ? input.description.replace(/\r\n/g, "\n").trim() : (doc.description ?? ""),
    links: input.links !== undefined ? toLinkRows(input.links) : doc.links.map((l) => ({ ...l })),
  };
  const links = checkFields(fields);
  const blob = input.html !== undefined ? await storeHtml(ctx, input.html) : null;

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
    throw new ToolError("다른 사람이 방금 이 문서를 수정했습니다. get_html로 최신 내용을 확인한 뒤 다시 시도해 주세요.");
  }
  if (blob) await ctx.env.DB.batch(deleteBlobStatements(ctx.env.DB, doc.blobId));
  return result({
    document_key: doc.documentKey,
    title: fields.title,
    ...urls(ctx.env, doc.documentKey),
    html_replaced: blob !== null,
  });
}

async function listHtml(ctx: Ctx, input: z.infer<(typeof schemas)["list_html"]>): Promise<ToolResult> {
  const page = input.page ?? 1;
  const { rows, total } = await listDocuments(ctx.env.DB, {
    q: (input.query ?? "").trim().slice(0, 200),
    page,
    pageSize: PAGE_SIZE,
  });
  return result({
    total,
    page,
    page_count: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    documents: rows.map((r) => ({
      document_key: r.documentKey,
      title: r.title,
      render_url: `${ctx.env.RENDER_ORIGIN}/${r.documentKey}`,
      updated_by: r.updatedByName,
      updated_at: new Date(r.updatedAt).toISOString(),
    })),
  });
}

async function getHtml(ctx: Ctx, input: z.infer<(typeof schemas)["get_html"]>): Promise<ToolResult> {
  const doc = await findDocument(ctx.env.DB, input.document_key);
  if (!doc) throw new ToolError("문서를 찾을 수 없습니다. list_html로 문서 키를 확인해 주세요.");
  const data: Record<string, unknown> = {
    document_key: doc.documentKey,
    title: doc.title,
    description: doc.description ?? "",
    links: doc.links,
    ...urls(ctx.env, doc.documentKey),
    html_size: doc.htmlSize,
    created_by: doc.createdByName,
    created_at: new Date(doc.createdAt).toISOString(),
    updated_by: doc.updatedByName,
    updated_at: new Date(doc.updatedAt).toISOString(),
  };
  if (input.include_source) {
    data.html =
      doc.htmlSize > MAX_MCP_HTML_BYTES
        ? null
        : await new Response(blobStream(ctx.env.DB, doc.blobId)).text();
    if (data.html === null) data.html_note = "HTML이 1MB를 넘어 원본은 웹 화면의 소스 보기에서 확인해 주세요.";
  }
  return result(data);
}
