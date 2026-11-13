import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { key, login, RENDER } from "./helpers";

const MCP = "http://api.localhost:8789/mcp";

// The official SDK client is the compatibility check (design.md 11).
function connect(accessKey: string) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP), {
    requestInit: { headers: { Authorization: `Bearer ${accessKey}` } },
  });
  const client = new Client({ name: "render-box-e2e", version: "1.0.0" });
  return client.connect(transport).then(() => client);
}

const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0].text;

test.describe("MCP", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "server-side only; run once");

  test("editor uploads and updates through MCP; the render URL works", async ({ page, context }) => {
    const client = await connect(key("EDITOR"));
    expect(client.getServerVersion()?.name).toBe("render-box");
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(["upload_html", "update_html", "list_html", "get_html", "list_comments", "add_comment"]);

    const up = await client.callTool({
      name: "upload_html",
      arguments: {
        title: "MCP 업로드",
        html: "<!DOCTYPE html><html><body><p id=v>v1 한글</p></body></html>",
        description: "AI가 올림",
        links: [{ label: "기획서", url: "https://example.com/spec" }],
      },
    });
    expect(up.isError).toBeFalsy();
    const uploaded = up.structuredContent as { document_key: string; render_url: string };
    expect(uploaded.render_url).toBe(`${RENDER}/${uploaded.document_key}`);

    const upd = await client.callTool({
      name: "update_html",
      arguments: { document_key: uploaded.document_key, html: "<!DOCTYPE html><p id=v>v2</p>" },
    });
    expect(upd.structuredContent).toMatchObject({ render_url: uploaded.render_url, html_replaced: true });

    const got = await client.callTool({
      name: "get_html",
      arguments: { document_key: uploaded.document_key, include_source: true },
    });
    // Fields not passed to update_html stay as they were.
    expect(got.structuredContent).toMatchObject({
      title: "MCP 업로드",
      description: "AI가 올림",
      links: [{ label: "기획서", url: "https://example.com/spec" }],
      html: "<!DOCTYPE html><p id=v>v2</p>",
    });
    const listed = await client.callTool({ name: "list_html", arguments: { query: "MCP 업로드" } });
    expect(text(listed)).toContain(uploaded.document_key);
    await client.close();

    await login(page, "VIEWER");
    const render = await context.newPage();
    await render.goto(uploaded.render_url);
    await expect(render.locator("#v")).toHaveText("v2");
  });

  test("viewer keys only read; bad input comes back as a tool error", async () => {
    const viewer = await connect(key("VIEWER"));
    expect((await viewer.listTools()).tools.map((t) => t.name)).toEqual(["list_html", "get_html", "list_comments", "add_comment"]);
    const denied = await viewer.callTool({ name: "upload_html", arguments: { title: "x", html: "<p>x</p>" } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain("편집 권한");
    await viewer.close();

    const editor = await connect(key("EDITOR"));
    const bad = await editor.callTool({
      name: "upload_html",
      arguments: { title: "", html: "<p>x</p>", links: [{ url: "javascript:alert(1)" }] },
    });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("제목을 입력해 주세요.");
    expect(text(bad)).toContain("링크 1: http:// 또는 https://");

    const big = await editor.callTool({
      name: "upload_html",
      arguments: { title: "big", html: "x".repeat(1024 * 1024 + 1) },
    });
    expect(big.isError).toBe(true);
    expect(text(big)).toContain("1MB를 넘습니다");

    const missing = await editor.callTool({ name: "get_html", arguments: { document_key: "A".repeat(22) } });
    expect(text(missing)).toContain("문서를 찾을 수 없습니다");
    await editor.close();
  });

  test("bad keys and browser origins are refused", async ({ request }) => {
    await expect(connect("rb_wrong")).rejects.toThrow();
    const res = await request.post(MCP, {
      headers: { Authorization: `Bearer ${key("EDITOR")}`, Origin: RENDER },
      data: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(res.status()).toBe(403);
  });
});
