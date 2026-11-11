import { editsAny, type ActiveKey } from "@render-box/auth";
import { htmlWarnings, type HtmlWarning } from "@render-box/documents";
import { z } from "zod";
import { createHtml, getHtml, listHtml, requireEditor, ServiceError, updateHtml, type Ctx, type HtmlInput } from "./service";

// AI clients send the whole HTML inside one JSON-RPC message, which the
// Worker must parse; keep it well under the web upload limit so parsing stays
// within the free plan's CPU budget (design.md 11).
export const MAX_MCP_HTML_BYTES = 1024 * 1024;

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const link = z.object({
  label: z.string().optional().describe("링크 이름 (예: 기획서). 비우면 사이트 주소로 표시"),
  url: z.string().optional().describe("http:// 또는 https:// 주소. 비우면 이 링크는 저장되지 않음"),
});

const project = z
  .string()
  .optional()
  .describe("프로젝트 slug (예: tamna). 편집할 수 있는 프로젝트가 하나면 빼도 된다. 모르면 list_html 결과의 project를 본다");

const documentKey = z.string().describe("문서 키 (22자). upload_html이나 list_html 결과의 document_key");

const schemas = {
  upload_html: z.object({
    project,
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
    project: z.string().optional().describe("이 프로젝트 slug의 문서만. 빼면 속한 모든 프로젝트"),
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
      "HTML 문서를 render-box에 새로 올리고, 팀원이 새 창에서 볼 수 있는 렌더링 URL(render_url)을 돌려준다. 올린 뒤 render_url을 사용자에게 알려 준다. 결과에 warnings가 있으면 저장은 되었지만 그 부분이 동작하지 않으니, 사용자에게 알리고 내용대로 HTML을 고쳐 update_html로 다시 올린다.",
    editorOnly: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  update_html: {
    title: "HTML 수정",
    description:
      "이미 올린 문서의 HTML이나 제목·설명·링크를 바꾼다. 넘긴 항목만 바뀌고 렌더링 URL은 그대로다. 결과에 warnings가 있으면 그 내용대로 고쳐 다시 올린다.",
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

// Tools this key may call; keys that edit no project only see the read-only
// ones. Each write still checks the document's project (design.md 3.9).
export function listTools(key: ActiveKey) {
  return (Object.keys(schemas) as ToolName[])
    .filter((name) => editsAny(key.projects) || !toolMeta[name].editorOnly)
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
  try {
    if (toolMeta[name].editorOnly) requireEditor(ctx);
    const parsed = schemas[name].safeParse(args ?? {});
    if (!parsed.success) {
      return toolError(`입력값이 올바르지 않습니다: ${z.prettifyError(parsed.error)}`);
    }
    return result(await run(ctx, name, parsed.data));
  } catch (err) {
    // Expected failures go back to the AI as a tool result so it can fix the
    // call, not as a protocol error.
    if (err instanceof ServiceError) return toolError(err.message);
    throw err;
  }
}

async function run(ctx: Ctx, name: ToolName, data: unknown): Promise<Record<string, unknown>> {
  switch (name) {
    case "upload_html": {
      const input = data as z.infer<(typeof schemas)["upload_html"]>;
      return withWarnings(await createHtml(ctx, input, htmlStream(input.html)), input.html);
    }
    case "update_html": {
      const { document_key, html, ...fields } = data as z.infer<(typeof schemas)["update_html"]>;
      return withWarnings(await updateHtml(ctx, document_key, fields, html !== undefined ? htmlStream(html) : null), html);
    }
    case "list_html":
      return listHtml(ctx, data as z.infer<(typeof schemas)["list_html"]>);
    case "get_html": {
      const input = data as z.infer<(typeof schemas)["get_html"]>;
      const { info, source } = await getHtml(ctx, input.document_key);
      if (!input.include_source) return info;
      if (info.html_size > MAX_MCP_HTML_BYTES) {
        return { ...info, html: null, html_note: "HTML이 1MB를 넘어 원본은 웹 화면이나 REST API(/api/v1/html/{key}/source)로 받아 주세요." };
      }
      return { ...info, html: await new Response(source()).text() };
    }
  }
}

// Saved anyway (warnings never block, D-07); the AI reads them and can fix the
// HTML with update_html. Only MCP: its HTML is already a string under 1MB,
// while REST stores up to 10MB without decoding (design.md 11.3).
function withWarnings(result: Record<string, unknown>, html: string | undefined) {
  const warnings = html === undefined ? [] : htmlWarnings(html);
  return warnings.length ? { ...result, warnings } : result;
}

// The whole HTML arrives inside the JSON-RPC message, so the 1MB cap is
// checked here, before storing (design.md 11).
function htmlStream(html: string): HtmlInput {
  const bytes = new TextEncoder().encode(html);
  if (bytes.length > MAX_MCP_HTML_BYTES) {
    throw new ServiceError(
      413,
      "too_large",
      `HTML이 1MB를 넘습니다 (${(bytes.length / 1024 / 1024).toFixed(1)}MB). 이미지 크기를 줄이거나, 큰 파일은 웹 화면이나 REST API로 올려 주세요.`,
    );
  }
  return { body: new Response(bytes).body!, size: bytes.length };
}

// Warnings go first, as sentences, so they show in the chat and are not
// lost in the JSON; the JSON still carries them for the AI.
function result(data: Record<string, unknown>): ToolResult {
  const content: ToolResult["content"] = [];
  const warnings = data.warnings as HtmlWarning[] | undefined;
  if (warnings?.length) {
    content.push({
      type: "text",
      text: [
        "⚠ 저장은 했지만, 렌더링 화면에서 일부가 동작하지 않습니다. 사용자에게 알리고, 아래대로 HTML을 고쳐 update_html로 다시 올리세요.",
        ...warnings.map((w) => `- ${w.message} (해당 코드: ${w.examples.join(", ")})`),
      ].join("\n"),
    });
  }
  content.push({ type: "text", text: JSON.stringify(data, null, 2) });
  return { content, structuredContent: data };
}

function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
