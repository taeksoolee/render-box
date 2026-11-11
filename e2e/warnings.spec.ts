import { expect, test } from "@playwright/test";
import { APP, key, login } from "./helpers";

// Code that reads an iframe's document directly cannot work in the rendered
// page (opaque origins): warn on upload, never block (design.md 4.6, D-40).
const MCP = "http://api.localhost:8789/mcp";
const withFrameAccess = `<!DOCTYPE html><meta charset="utf-8"><title>iframe 설명</title>
<iframe id="fr"></iframe>
<script>fr.srcdoc = "<p id=t>x</p>"; fr.addEventListener("load", () => { const d = fr.contentDocument; d.getElementById("t"); });</script>`;

test("the upload form warns about direct iframe access and still saves", async ({ page }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new?project=default`);
  await page.locator("#html-file").setInputFiles({ name: "frame.html", mimeType: "text/html", buffer: Buffer.from(withFrameAccess) });
  const warning = page.locator("[data-warning-list] li", { hasText: "postMessage" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("fr.contentDocument");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();
});

test("a file without it gets no such warning", async ({ page }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new?project=default`);
  const ok = withFrameAccess.replace("fr.contentDocument", "null");
  await page.locator("#html-file").setInputFiles({ name: "ok.html", mimeType: "text/html", buffer: Buffer.from(ok) });
  await expect(page.getByLabel(/^제목/)).toHaveValue("iframe 설명");
  await expect(page.locator("[data-warning-list] li", { hasText: "postMessage" })).toHaveCount(0);
});

test.describe("MCP", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "server-side only; run once");

  async function upload(html: string) {
    const res = await fetch(MCP, {
      method: "POST",
      headers: { Authorization: `Bearer ${key("EDITOR")}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "upload_html", arguments: { project: "default", title: "MCP 경고", html } },
      }),
    });
    return (await res.json()).result as { isError?: boolean; structuredContent: Record<string, unknown> };
  }

  test("upload_html saves and returns the warning for the AI to fix", async () => {
    const result = await upload(withFrameAccess);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.render_url).toBeTruthy();
    expect(result.structuredContent.warnings).toEqual([
      expect.objectContaining({ code: "frame_access", examples: ["fr.contentDocument"] }),
    ]);
    const clean = await upload(withFrameAccess.replace("fr.contentDocument", "null"));
    expect(clean.structuredContent.warnings).toBeUndefined();
  });
});
