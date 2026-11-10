import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { APP, key, RENDER } from "./helpers";

// Project isolation on all three hosts (design.md 3.9). Creates its own
// projects and keys on the local D1 through the CLI, so the shared test keys
// stay as they are.
const API = "http://api.localhost:8789/api/v1";
const MCP = "http://api.localhost:8789/mcp";
const html = (label: string) => `<!DOCTYPE html><meta charset="utf-8"><p id=v>${label}</p>`;

const cli = (...args: string[]) => execFileSync("pnpm", ["-s", ...args], { encoding: "utf8" });
const newKey = (name: string, project: string, role: "EDITOR" | "VIEWER") =>
  /rb_[0-9A-Za-z]{32}/.exec(cli("key", "create", "--name", name, "--project", project, "--role", role))![0];

const run = Date.now().toString(36);
const OTHER = `e2e-${run}`;
let outsider: string; // EDITOR in OTHER only
let multi: string; // EDITOR in default, VIEWER in OTHER

test.describe("projects", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "server-side rules; run once");

  test.beforeAll(() => {
    cli("project", "create", OTHER, "--name", `격리 테스트 ${run}`);
    outsider = newKey(`outsider-${run}`, OTHER, "EDITOR");
    multi = newKey(`multi-${run}`, "default", "EDITOR");
    cli("project", "grant", multi.slice(0, 8), OTHER, "--role", "VIEWER");
  });

  async function loginWith(page: Page, value: string) {
    await page.goto(`${APP}/login`);
    await page.getByLabel("접근 키").fill(value);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(`${APP}/html`);
  }

  async function upload(value: string, title: string, project?: string) {
    const q = new URLSearchParams({ title, ...(project ? { project } : {}) });
    return fetch(`${API}/html?${q}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "text/html" },
      body: html(title),
    });
  }

  test("documents of other projects look missing everywhere", async ({ page, request }) => {
    const res = await upload(key("EDITOR"), "기본 프로젝트 문서");
    expect(res.status).toBe(201);
    const { document_key: docKey, project } = await res.json();
    expect(project).toBe("default");

    // API: not in the list, 404 on read, 404 on write.
    const auth = { Authorization: `Bearer ${outsider}` };
    const list = await (await request.get(`${API}/html`, { headers: auth })).json();
    expect(list.documents.map((d: { document_key: string }) => d.document_key)).not.toContain(docKey);
    expect((await request.get(`${API}/html/${docKey}`, { headers: auth })).status()).toBe(404);
    expect((await request.patch(`${API}/html/${docKey}`, { headers: auth, data: { title: "x" } })).status()).toBe(404);

    // Render host: knowing the URL is not enough.
    await loginWith(page, outsider);
    expect((await page.goto(`${RENDER}/${docKey}`))?.status()).toBe(404);
    expect((await page.goto(`${RENDER}/${docKey}/v/1`))?.status()).toBe(404);

    // Admin host: detail, source and edit all 404 like a missing document.
    for (const path of [`/html/${docKey}`, `/html/${docKey}/source`, `/html/${docKey}/edit`]) {
      expect((await page.goto(`${APP}${path}`))?.status()).toBe(404);
    }
    const csrf = await page.locator('input[name="_csrf"]').first().inputValue();
    const del = await page.request.post(`${APP}/html/${docKey}/delete`, { form: { _csrf: csrf }, headers: { Origin: APP } });
    expect(del.status()).toBe(404);

    // The owner still sees it.
    expect((await request.get(`${API}/html/${docKey}`, { headers: { Authorization: `Bearer ${key("VIEWER")}` } })).status()).toBe(200);
  });

  test("a key with several projects picks one to upload into and switches in the top bar", async ({ page }) => {
    // Editor in one project only (default): the project may be left out.
    // Viewer in OTHER: uploading there is refused.
    expect((await upload(multi, "프로젝트 생략")).status).toBe(201);
    const viewerOnly = await upload(multi, "열람만 가능", OTHER);
    expect(viewerOnly.status).toBe(403);

    // MCP: tools/list still shows the editor tools; upload into OTHER is a tool error.
    const call = await fetch(MCP, {
      method: "POST",
      headers: { Authorization: `Bearer ${multi}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "upload_html", arguments: { project: OTHER, title: "x", html: html("x") } },
      }),
    });
    expect((await call.json()).result.isError).toBe(true);

    // OTHER's documents are visible (read-only) after switching projects.
    const theirs = await (await upload(outsider, "다른 프로젝트 문서")).json();
    await loginWith(page, multi);
    await page.goto(`${APP}/html?project=default`);
    await expect(page.locator("header [data-project]")).toHaveAttribute("data-project", "default");
    await page.locator("header summary").click();
    await page.getByRole("link", { name: new RegExp(`격리 테스트 ${run}`) }).click();
    await expect(page.locator("header [data-project]")).toHaveAttribute("data-project", OTHER);
    await expect(page.getByRole("link", { name: "다른 프로젝트 문서", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /새 HTML 등록/ })).toHaveCount(0);

    // The choice is remembered; viewers cannot open the new form there.
    await page.goto(`${APP}/html`);
    await expect(page.locator("header [data-project]")).toHaveAttribute("data-project", OTHER);
    expect((await page.goto(`${APP}/html/new`))?.status()).toBe(403);
    await page.goto(`${APP}/html/${theirs.document_key}`);
    await expect(page.getByRole("link", { name: "수정" })).toHaveCount(0);
    await page.goto(`${RENDER}/${theirs.document_key}`);
    await expect(page.locator("#v")).toHaveText("다른 프로젝트 문서");
  });

  test("removing a membership applies to the next request", async ({ page }) => {
    const value = newKey(`leaver-${run}`, OTHER, "VIEWER");
    const doc = await (await upload(outsider, "곧 못 보게 될 문서")).json();
    await loginWith(page, value);
    await page.goto(`${RENDER}/${doc.document_key}`);
    await expect(page.locator("#v")).toHaveText("곧 못 보게 될 문서");

    cli("project", "revoke", value.slice(0, 8), OTHER);
    expect((await page.goto(`${RENDER}/${doc.document_key}`))?.status()).toBe(404);
    await page.goto(`${APP}/html`);
    await expect(page.getByText("속한 프로젝트가 없습니다")).toBeVisible();
  });

  test("moving a document keeps its render URL", async ({ page }) => {
    const doc = await (await upload(key("EDITOR"), "옮길 문서")).json();
    cli("project", "move", doc.document_key, OTHER);
    await loginWith(page, outsider);
    await page.goto(`${RENDER}/${doc.document_key}`);
    await expect(page.locator("#v")).toHaveText("옮길 문서");
  });

  test("an admin key manages every project's documents, including new projects", async ({ page, request }) => {
    const admin = /rb_[0-9A-Za-z]{32}/.exec(cli("key", "create", "--name", `admin-${run}`, "--admin"))![0];
    const later = `e2e-later-${run}`;
    cli("project", "create", later, "--name", `나중 프로젝트 ${run}`);
    const theirs = await (await upload(outsider, "남이 만든 문서")).json();

    // Not a member anywhere, yet it reads and edits OTHER's document...
    const auth = { Authorization: `Bearer ${admin}` };
    expect((await request.get(`${API}/html/${theirs.document_key}`, { headers: auth })).status()).toBe(200);
    const patched = await request.patch(`${API}/html/${theirs.document_key}`, { headers: auth, data: { title: "관리자가 고침" } });
    expect(patched.status()).toBe(200);
    // ...and uploads into a project created after it was made admin.
    expect((await upload(admin, "새 프로젝트에 올림", later)).status).toBe(201);

    await loginWith(page, admin);
    await page.goto(`${APP}/html?project=${OTHER}`);
    await expect(page.locator("header [data-project]")).toContainText("관리자");
    await page.goto(`${APP}/html/${theirs.document_key}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "삭제", exact: true }).first().click();
    await expect(page.getByText("문서를 삭제했습니다.")).toBeVisible();

    // Turning admin off applies to the next request.
    cli("key", "admin", admin.slice(0, 8), "off");
    expect((await request.get(`${API}/html?project=${OTHER}`, { headers: auth })).status()).toBe(404);
    await page.goto(`${APP}/html`);
    await expect(page.getByText("속한 프로젝트가 없습니다")).toBeVisible();
  });
});
