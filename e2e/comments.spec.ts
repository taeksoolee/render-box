import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP, key, login } from "./helpers";

// Memos on a document (design.md 4.10): viewers write too, authors edit their
// own, editors delete any; all checked on the server as well.
const API = "http://api.localhost:8789/api/v1";

async function upload(title: string) {
  const res = await fetch(`${API}/html?${new URLSearchParams({ title })}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key("EDITOR")}`, "Content-Type": "text/html" },
    body: "<!DOCTYPE html><p>memo",
  });
  return ((await res.json()) as { document_key: string }).document_key;
}

async function as(browser: Browser, role: "EDITOR" | "VIEWER") {
  const page = await (await browser.newContext()).newPage();
  await login(page, role);
  return page;
}

const memos = (page: Page) => page.locator("[data-comment]");
const csrf = (page: Page) => page.locator('input[name="_csrf"]').first().inputValue();

async function write(page: Page, docKey: string, text: string) {
  await page.goto(`${APP}/html/${docKey}`);
  await page.getByPlaceholder("이 문서에 대한 의견을 남겨 주세요").fill(text);
  await page.getByRole("button", { name: "메모 남기기" }).click();
  await expect(memos(page).filter({ hasText: text.split("\n")[0]! })).toBeVisible();
}

test("a viewer writes a memo; the author edits it; the list counts it", async ({ browser }) => {
  const title = `메모 ${Date.now()}`;
  const docKey = await upload(title);
  const viewer = await as(browser, "VIEWER");

  await write(viewer, docKey, "버튼 색이 너무 연해요\n두 번째 줄");
  const memo = memos(viewer).last();
  await expect(memo.locator("[data-comment-body]")).toHaveText("버튼 색이 너무 연해요\n두 번째 줄");
  await expect(memo).toContainText("v1");
  await expect(viewer.locator("#comments h2")).toContainText("1");

  await memo.getByText("수정", { exact: true }).click();
  await memo.locator("textarea").fill("버튼 색을 진하게 해 주세요");
  await memo.getByRole("button", { name: "저장" }).click();
  await expect(memos(viewer).last().locator("[data-comment-body]")).toHaveText("버튼 색을 진하게 해 주세요");
  await expect(memos(viewer).last()).toContainText("(수정됨)");

  await viewer.goto(`${APP}/html?project=default&q=${encodeURIComponent(title)}`);
  const row = viewer.locator("table tbody tr", { hasText: title });
  await expect(row.locator("td").nth(1)).toHaveText("1");
});

test("editors delete any memo; others cannot edit or delete what is not theirs", async ({ browser }) => {
  const docKey = await upload(`메모 권한 ${Date.now()}`);
  const editor = await as(browser, "EDITOR");
  const viewer = await as(browser, "VIEWER");
  await write(editor, docKey, `편집자 메모 ${Date.now()}`);
  await write(viewer, docKey, `뷰어 메모 ${Date.now()}`);

  // Viewer: no buttons on the editor's memo, and forged requests do nothing.
  await viewer.reload();
  const editorMemo = memos(viewer).first();
  await expect(editorMemo.getByRole("button", { name: "삭제" })).toHaveCount(0);
  await expect(editorMemo.getByText("수정", { exact: true })).toHaveCount(0);
  const id = (await editorMemo.getAttribute("id"))!.replace("comment-", "");
  const token = await csrf(viewer);
  const forged = { form: { _csrf: token, body: "가로챔" }, headers: { Origin: APP } };
  await viewer.request.post(`${APP}/html/${docKey}/comments/${id}`, forged);
  await viewer.request.post(`${APP}/html/${docKey}/comments/${id}/delete`, forged);
  await viewer.reload();
  await expect(memos(viewer)).toHaveCount(2);
  await expect(memos(viewer).first()).not.toContainText("가로챔");

  // Editor: can delete the viewer's memo, but not edit it.
  await editor.reload();
  const viewerMemo = memos(editor).last();
  await expect(viewerMemo.getByText("수정", { exact: true })).toHaveCount(0);
  editor.once("dialog", (d) => d.accept());
  await viewerMemo.getByRole("button", { name: "삭제" }).click();
  await expect(memos(editor)).toHaveCount(1);
});

test("an empty memo is refused with a message in the memo section", async ({ browser }) => {
  const docKey = await upload(`빈 메모 ${Date.now()}`);
  const viewer = await as(browser, "VIEWER");
  await viewer.goto(`${APP}/html/${docKey}`);
  const res = await viewer.request.post(`${APP}/html/${docKey}/comments`, {
    form: { _csrf: await csrf(viewer), body: "   \n " },
    headers: { Origin: APP },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(303);
  await viewer.goto(APP + res.headers()["location"]);
  await expect(viewer.locator("#comments").getByText("메모를 저장하지 못했습니다")).toBeVisible();
  await expect(memos(viewer)).toHaveCount(0);
});

test("deleting a document with memos works", async ({ browser }) => {
  const title = `메모 있는 문서 ${Date.now()}`;
  const docKey = await upload(title);
  const editor = await as(browser, "EDITOR");
  await write(editor, docKey, "지워질 메모");
  editor.once("dialog", (d) => d.accept());
  await editor.getByRole("button", { name: "삭제", exact: true }).first().click();
  await expect(editor).toHaveURL(/deleted=1/);
  expect((await editor.goto(`${APP}/html/${docKey}`))?.status()).toBe(404);
});

test("AI and scripts read and add memos (MCP, REST); edits stay on the web", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "server-side only; run once");
  const docKey = await upload(`AI 메모 ${Date.now()}`);
  const viewer = await as(browser, "VIEWER");
  await write(viewer, docKey, "제목을 더 크게");

  // MCP, as a viewer: reads the memo, adds one under its own key name.
  const transport = new StreamableHTTPClientTransport(new URL("http://api.localhost:8789/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${key("VIEWER")}` } },
  });
  const client = new Client({ name: "render-box-e2e", version: "1.0.0" });
  await client.connect(transport);
  const listed = (await client.callTool({ name: "list_comments", arguments: { document_key: docKey } }))
    .structuredContent as { comments: { body: string; html_version: number }[] };
  expect(listed.comments).toMatchObject([{ body: "제목을 더 크게", html_version: 1 }]);
  const added = await client.callTool({ name: "add_comment", arguments: { document_key: docKey, body: "AI: 반영했습니다" } });
  expect(added.isError).toBeFalsy();
  const empty = await client.callTool({ name: "add_comment", arguments: { document_key: docKey, body: "  " } });
  expect(empty.isError).toBe(true);
  await client.close();

  // REST.
  const auth = { Authorization: `Bearer ${key("EDITOR")}` };
  const post = await fetch(`${API}/html/${docKey}/comments`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "스크립트 메모" }),
  });
  expect(post.status).toBe(201);
  const got = (await (await fetch(`${API}/html/${docKey}/comments`, { headers: auth })).json()) as { comments: { body: string }[] };
  expect(got.comments.map((m) => m.body)).toEqual(["제목을 더 크게", "AI: 반영했습니다", "스크립트 메모"]);
  expect((await fetch(`${API}/html/${"A".repeat(22)}/comments`, { headers: auth })).status).toBe(404);

  // All three show on the detail page, the MCP one as the viewer's own.
  await viewer.reload();
  await expect(memos(viewer)).toHaveCount(3);
  await expect(memos(viewer).nth(1).getByText("수정", { exact: true })).toHaveCount(1);
});
