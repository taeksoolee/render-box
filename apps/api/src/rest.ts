import type { ActiveKey } from "@render-box/auth";
import { MAX_HTML_BYTES } from "@render-box/db";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Env } from "./env";
import {
  createHtml,
  getHtml,
  listHtml,
  listHtmlVersions,
  ServiceError,
  updateHtml,
  type Ctx,
  type HtmlInput,
  type LinkInput,
} from "./service";

// REST API for scripts and CI (design.md 11.4). HTML travels as the raw
// request body and is stored in 1MB chunks without decoding, so the web
// upload limit (10MB) applies, unlike MCP's 1MB.

type Rest = { Bindings: Env; Variables: { key: ActiveKey } };

export const apiError = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

const ctx = (c: Context<Rest>): Ctx => ({ env: c.env, key: c.get("key") });

const etag = (version: number) => `"${version}"`;

// If-Match: "3" (W/ prefix tolerated). Absent means "whatever is current".
function ifMatch(c: Context<Rest>): number | undefined | null {
  const raw = c.req.header("If-Match");
  if (raw === undefined || raw.trim() === "*") return undefined;
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(raw);
  return m ? Number(m[1]) : null;
}

// "이름|https://..." or just "https://...".
function parseLink(value: string): LinkInput {
  const bar = value.indexOf("|");
  return bar === -1 ? { url: value } : { label: value.slice(0, bar), url: value.slice(bar + 1) };
}

function htmlBody(c: Context<Rest>): HtmlInput {
  const header = c.req.header("Content-Length");
  if (header !== undefined && Number(header) > MAX_HTML_BYTES) {
    throw new ServiceError(413, "too_large", `HTML이 ${MAX_HTML_BYTES / 1024 / 1024}MB를 넘습니다.`);
  }
  if (header === "0" || !c.req.raw.body) throw new ServiceError(422, "empty", "HTML 내용이 비어 있습니다.");
  const size = Number(header);
  return { body: c.req.raw.body, size: Number.isFinite(size) ? size : undefined };
}

const patchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  links: z.array(z.object({ label: z.string().optional(), url: z.string().optional() })).optional(),
});

export const rest = new Hono<Rest>();

rest.onError((err, c) => {
  if (err instanceof ServiceError) return apiError(c, err.status, err.code, err.message);
  throw err;
});

rest.get("/html", async (c) => {
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  return c.json(await listHtml(ctx(c), { query: c.req.query("q"), page, project: c.req.query("project") }));
});

rest.post("/html", async (c) => {
  const title = c.req.query("title");
  if (title === undefined) {
    return apiError(c, 400, "invalid_fields", "title 쿼리 파라미터로 제목을 넣어 주세요. 예: /api/v1/html?title=회원가입");
  }
  const doc = await createHtml(
    ctx(c),
    {
      title,
      description: c.req.query("description"),
      links: c.req.queries("link")?.map(parseLink),
      project: c.req.query("project"),
    },
    htmlBody(c),
  );
  return c.json(doc, 201, { Location: `/api/v1/html/${doc.document_key}`, ETag: etag(doc.version) });
});

rest.get("/html/:key", async (c) => {
  const { info } = await getHtml(ctx(c), c.req.param("key"));
  return c.json(info, 200, { ETag: etag(info.version) });
});

rest.get("/html/:key/versions", async (c) => c.json(await listHtmlVersions(ctx(c), c.req.param("key"))));

rest.get("/html/:key/source", async (c) => {
  const { info, source } = await getHtml(ctx(c), c.req.param("key"));
  // Stored bytes as uploaded, never rendered on this origin.
  return c.body(source(), 200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${info.document_key}.html"`,
    "Content-Security-Policy": "sandbox",
    "Content-Length": String(info.html_size),
    ETag: etag(info.version),
  });
});

rest.put("/html/:key/source", async (c) => {
  const expected = ifMatch(c);
  if (expected === null) return apiError(c, 400, "bad_if_match", 'If-Match는 "버전 번호" 형식이어야 합니다. 예: If-Match: "3"');
  const doc = await updateHtml(ctx(c), c.req.param("key"), {}, htmlBody(c), expected);
  return c.json(doc, 200, { ETag: etag(doc.version) });
});

rest.patch(
  "/html/:key",
  bodyLimit({ maxSize: 64 * 1024, onError: (c) => apiError(c, 413, "too_large", "요청이 너무 큽니다.") }),
  async (c) => {
    const expected = ifMatch(c);
    if (expected === null) return apiError(c, 400, "bad_if_match", 'If-Match는 "버전 번호" 형식이어야 합니다. 예: If-Match: "3"');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "bad_json", "본문은 JSON이어야 합니다. 예: {\"title\": \"새 제목\"}");
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return apiError(c, 400, "invalid_fields", z.prettifyError(parsed.error));
    const doc = await updateHtml(ctx(c), c.req.param("key"), parsed.data, null, expected);
    return c.json(doc, 200, { ETag: etag(doc.version) });
  },
);

rest.all("*", (c) => apiError(c, 404, "not_found", "없는 API 경로입니다."));
