import { expect, test } from "@playwright/test";
import { key, login, RENDER } from "./helpers";

const API = "http://api.localhost:8789/api/v1";
const auth = (role: "EDITOR" | "VIEWER") => ({ Authorization: `Bearer ${key(role)}` });

test.describe("REST API", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "server-side only; run once");

  test("editor creates, replaces and patches; bytes and render URL survive", async ({ request, page, context }) => {
    // EUC-KR bytes ("안" = BE C8) must come back untouched: the body is stored raw.
    const html = Buffer.concat([
      Buffer.from('<!DOCTYPE html><meta charset="euc-kr"><p id=v>v1 '),
      Buffer.from([0xbe, 0xc8]),
      Buffer.from("</p>"),
    ]);
    const title = "REST 업로드";
    const created = await request.post(
      `${API}/html?title=${encodeURIComponent(title)}&description=${encodeURIComponent("CI가 올림")}` +
        `&link=${encodeURIComponent("기획서|https://example.com/spec")}&link=${encodeURIComponent("https://example.com/b")}`,
      { headers: { ...auth("EDITOR"), "Content-Type": "text/html" }, data: html },
    );
    expect(created.status()).toBe(201);
    expect(created.headers().etag).toBe('"1"');
    const doc = await created.json();
    expect(doc).toMatchObject({ title, version: 1, html_size: html.length, render_url: `${RENDER}/${doc.document_key}` });
    expect(created.headers().location).toBe(`/api/v1/html/${doc.document_key}`);

    const info = await (await request.get(`${API}/html/${doc.document_key}`, { headers: auth("VIEWER") })).json();
    expect(info).toMatchObject({
      description: "CI가 올림",
      links: [
        { label: "기획서", url: "https://example.com/spec" },
        { label: "", url: "https://example.com/b" },
      ],
    });
    const source = await request.get(`${API}/html/${doc.document_key}/source`, { headers: auth("VIEWER") });
    expect(source.headers()["content-disposition"]).toContain("attachment");
    expect(Buffer.compare(await source.body(), html)).toBe(0);

    // Replace HTML with the version just read; a stale If-Match is refused.
    const put = await request.put(`${API}/html/${doc.document_key}/source`, {
      headers: { ...auth("EDITOR"), "If-Match": '"1"' },
      data: Buffer.from("<!DOCTYPE html><p id=v>v2</p>"),
    });
    expect(put.status()).toBe(200);
    expect(await put.json()).toMatchObject({ version: 2, html_replaced: true, render_url: doc.render_url });
    const stale = await request.put(`${API}/html/${doc.document_key}/source`, {
      headers: { ...auth("EDITOR"), "If-Match": '"1"' },
      data: Buffer.from("<p>lost</p>"),
    });
    expect(stale.status()).toBe(412);
    expect((await stale.json()).error.code).toBe("version_mismatch");

    const patched = await request.patch(`${API}/html/${doc.document_key}`, {
      headers: auth("EDITOR"),
      data: { title: "REST 업로드 (수정)", links: [] },
    });
    expect(await patched.json()).toMatchObject({ version: 3, html_replaced: false, title: "REST 업로드 (수정)" });
    const after = await (await request.get(`${API}/html/${doc.document_key}`, { headers: auth("EDITOR") })).json();
    expect(after).toMatchObject({ description: "CI가 올림", links: [], version: 3 });

    const list = await (await request.get(`${API}/html?q=${encodeURIComponent("REST 업로드")}`, { headers: auth("VIEWER") })).json();
    expect(list.documents.map((d: { document_key: string }) => d.document_key)).toContain(doc.document_key);

    await login(page, "VIEWER");
    const render = await context.newPage();
    await render.goto(doc.render_url);
    await expect(render.locator("#v")).toHaveText("v2");
  });

  test("HTML up to 10MB goes through REST, beyond that is refused", async ({ request }) => {
    const big = Buffer.alloc(3 * 1024 * 1024, "a"); // over MCP's 1MB
    const ok = await request.post(`${API}/html?title=big`, { headers: auth("EDITOR"), data: big });
    expect(ok.status()).toBe(201);
    expect((await ok.json()).html_size).toBe(big.length);

    const tooBig = await request.post(`${API}/html?title=too-big`, {
      headers: auth("EDITOR"),
      data: Buffer.alloc(10 * 1024 * 1024 + 1, "a"),
    });
    expect(tooBig.status()).toBe(413);
    expect((await tooBig.json()).error.code).toBe("too_large");
  });

  test("permissions, input errors and refused callers", async ({ request }) => {
    const denied = await request.post(`${API}/html?title=x`, { headers: auth("VIEWER"), data: "<p>x</p>" });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.message).toContain("편집 권한");

    const noTitle = await request.post(`${API}/html`, { headers: auth("EDITOR"), data: "<p>x</p>" });
    expect(noTitle.status()).toBe(400);
    const badLink = await request.post(`${API}/html?title=x&link=${encodeURIComponent("javascript:alert(1)")}`, {
      headers: auth("EDITOR"),
      data: "<p>x</p>",
    });
    expect(badLink.status()).toBe(400);
    expect((await badLink.json()).error.message).toContain("링크 1:");
    const empty = await request.post(`${API}/html?title=x`, { headers: auth("EDITOR"), data: "" });
    expect(empty.status()).toBe(422);

    expect((await request.get(`${API}/html/${"A".repeat(22)}`, { headers: auth("EDITOR") })).status()).toBe(404);
    expect((await request.get(`${API}/nope`, { headers: auth("EDITOR") })).status()).toBe(404);

    const anonymous = await request.get(`${API}/html`);
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["www-authenticate"]).toContain("Bearer");
    const fromPage = await request.get(`${API}/html`, { headers: { ...auth("EDITOR"), Origin: RENDER } });
    expect(fromPage.status()).toBe(403);
  });
});
