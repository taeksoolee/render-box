import { clientIp, findActiveKey, isLoginLocked, recordLoginFailure, type ActiveKey } from "@render-box/auth";
import { canonicalOrigin } from "@render-box/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";
import { apiError, rest } from "./rest";
import { callTool, isToolName, listTools, MAX_MCP_HTML_BYTES } from "./tools";

// API Worker for clients other than the browser (design.md 11):
// - POST /mcp: remote MCP server over Streamable HTTP, stateless: every POST
//   carries one JSON-RPC message and gets one JSON response (no SSE, no
//   session id).
// - /api/v1/*: REST API for scripts and CI.
// Both authenticate with the user's own access key as a Bearer token.

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
// JSON escaping can roughly double the HTML; leave room for the envelope.
const MAX_REQUEST_BYTES = MAX_MCP_HTML_BYTES * 2 + 64 * 1024;

const INSTRUCTIONS = [
  "render-box는 기획자가 만든 HTML을 팀원(개발자·디자이너)에게 공유하는 팀 도구다.",
  "upload_html로 올리면 render_url이 나온다. 이 주소를 사용자에게 알려 주면 된다. 팀원은 로그인 후 새 창에서 본다.",
  "문서는 프로젝트(예: tamna)에 속한다. 키가 편집할 수 있는 프로젝트가 여럿이면 upload_html에 project를 넣는다. 어느 프로젝트인지 모르면 사용자에게 묻는다.",
  "같은 폴더의 이미지·스크립트 파일은 함께 올라가지 않는다. 이미지는 data: URL(base64)이나 https 주소로 HTML 안에 넣는다.",
  "HTML은 1MB까지 올릴 수 있다. 더 큰 파일(10MB까지)은 웹 화면이나 REST API(POST /api/v1/html)로 올리도록 안내한다.",
  "문서 삭제는 웹 화면에서만 할 수 있다.",
].join("\n");

type RpcId = string | number | null;
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

type AuthFailure = { status: 401 | 429; message: string };

// Wrong keys count toward the same lockout as web login.
async function authenticate(c: Context<{ Bindings: Env; Variables: { key: ActiveKey } }>): Promise<ActiveKey | AuthFailure> {
  const ip = clientIp(c.req.raw);
  if (await isLoginLocked(c.env.DB, ip)) {
    return { status: 429, message: "키 인증 실패가 너무 많습니다. 30초 뒤에 다시 시도해 주세요." };
  }
  const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
  const key = token ? await findActiveKey(c.env.DB, token) : null;
  if (!key) {
    if (token) {
      await recordLoginFailure(c.env.DB, ip);
      console.log(JSON.stringify({ event: "api_auth_failed", ip, path: new URL(c.req.url).pathname }));
    }
    return {
      status: 401,
      message: "render-box 접근 키가 없거나 올바르지 않습니다. Authorization: Bearer rb_... 헤더를 확인해 주세요.",
    };
  }
  return key;
}

const authHeaders = (f: AuthFailure): Record<string, string> =>
  f.status === 401 ? { "WWW-Authenticate": 'Bearer realm="render-box"' } : {};

const touchKey = (env: Env, key: ActiveKey) =>
  env.DB.prepare("UPDATE access_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), key.id).run();

const app = new Hono<{ Bindings: Env; Variables: { key: ActiveKey } }>();

app.use("*", canonicalOrigin((env: Env) => env.API_ORIGIN));
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

app.get("/healthz", (c) => c.text("ok"));

// MCP clients, curl and CI send no Origin. A web page that does (including a
// sandboxed render-box document) must not drive these endpoints.
const foreignOrigin = (c: Context) => {
  const origin = c.req.header("Origin");
  return origin !== undefined && origin !== (c.env as Env).API_ORIGIN;
};

app.use("/api/*", async (c, next) => {
  if (foreignOrigin(c)) return apiError(c, 403, "origin_not_allowed", "브라우저 페이지에서는 이 API를 쓸 수 없습니다.");
  const key = await authenticate(c);
  if ("status" in key) {
    return c.json({ error: { code: key.status === 401 ? "unauthorized" : "locked", message: key.message } }, key.status, authHeaders(key));
  }
  c.set("key", key);
  await touchKey(c.env, key);
  await next();
});
app.route("/api/v1", rest);
app.all("/api/*", (c) => apiError(c, 404, "not_found", "없는 API 경로입니다. 지금 버전은 /api/v1 입니다."));

app.all("/mcp", async (c, next) => {
  if (c.req.method !== "POST") return c.text("Method Not Allowed", 405, { Allow: "POST" });
  if (foreignOrigin(c)) return c.json(rpcError(null, -32600, "Origin not allowed"), 403);
  await next();
});

app.post(
  "/mcp",
  bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: (c) => c.json(rpcError(null, -32600, "요청이 너무 큽니다. HTML은 1MB까지 올릴 수 있습니다."), 413),
  }),
  async (c) => {
    const key = await authenticate(c);
    if ("status" in key) return c.json(rpcError(null, -32001, key.message), key.status, authHeaders(key));

    let msg: unknown;
    try {
      msg = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, "Parse error"), 400);
    }
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      return c.json(rpcError(null, -32600, "Invalid Request: one JSON-RPC message per POST"), 400);
    }
    const { jsonrpc, id, method, params } = msg as { jsonrpc?: unknown; id?: RpcId; method?: unknown; params?: any };
    if (jsonrpc !== "2.0" || typeof method !== "string") {
      return c.json(rpcError(id ?? null, -32600, "Invalid Request"), 400);
    }
    // Notifications (no id) and client responses need no reply.
    if (id === undefined) return c.body(null, 202);

    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion;
        return c.json(
          rpcResult(id, {
            protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "render-box", title: "render-box", version: "0.1.0" },
            instructions: INSTRUCTIONS,
          }),
        );
      }
      case "ping":
        return c.json(rpcResult(id, {}));
      case "tools/list":
        return c.json(rpcResult(id, { tools: listTools(key) }));
      case "tools/call": {
        const name = params?.name;
        if (!isToolName(name)) return c.json(rpcError(id, -32602, `Unknown tool: ${String(name)}`));
        console.log(JSON.stringify({ event: "mcp_tool", tool: name, keyId: key.id }));
        await touchKey(c.env, key);
        return c.json(rpcResult(id, await callTool({ env: c.env, key }, name, params?.arguments)));
      }
      default:
        return c.json(rpcError(id, -32601, `Method not found: ${method}`));
    }
  },
);

export default app;
