import { expect, test } from "@playwright/test";
import { APP, createDocument, login, RENDER } from "./helpers";

test("editor uploads a file and anyone logged in can open it in a new window", async ({ page, context }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);

  const html =
    "<!DOCTYPE html><html><head><title>AI 프로토타입</title></head><body><h1>안녕</h1>" +
    "<script src='js/app.js'></script>" +
    "<script>localStorage.setItem('k','stored');document.body.dataset.storage=localStorage.getItem('k')</script>" +
    "</body></html>";
  await page.locator("#html-file").setInputFiles({ name: "proto.html", mimeType: "text/html", buffer: Buffer.from(html) });

  // Title autofill and the relative-path warning (design.md 4.6).
  await expect(page.getByLabel(/^제목/)).toHaveValue("AI 프로토타입");
  await expect(page.getByText("저장은 할 수 있지만")).toBeVisible();
  await expect(page.getByText("예: js/app.js")).toBeVisible();

  await page.getByRole("button", { name: "링크 추가" }).click();
  await page.getByLabel("링크 1 이름").fill("기획서");
  await page.getByLabel("링크 1 주소").fill("https://example.com/spec");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.getByText("저장했습니다")).toBeVisible();
  await expect(page.getByRole("link", { name: /기획서/ })).toHaveAttribute("href", "https://example.com/spec");

  const [render] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "새 창에서 보기" }).click(),
  ]);
  await render.waitForLoadState();
  expect(render.url()).toMatch(new RegExp(`^${RENDER}/[0-9A-Za-z]{22}$`));
  await expect(render.locator("h1")).toHaveText("안녕");
  // In-memory storage shim keeps localStorage working in the sandbox.
  await expect(render.locator("body")).toHaveAttribute("data-storage", "stored");
});

test("viewer can read but not edit", async ({ page }) => {
  await login(page, "VIEWER");
  await expect(page.getByRole("link", { name: "새 HTML 등록" })).toHaveCount(0);
  const res = await page.goto(`${APP}/html/new`);
  expect(res?.status()).toBe(403);
  await expect(page.getByText("편집 권한이 필요합니다")).toBeVisible();
});

test("rendering URL without a session goes through login and back", async ({ browser, page }) => {
  await login(page, "EDITOR");
  const documentKey = await createDocument(page, "핸드오프", "<!DOCTYPE html><p id=ok>ok</p>");

  const fresh = await browser.newContext();
  const p = await fresh.newPage();
  await p.goto(`${RENDER}/${documentKey}`);
  await expect(p).toHaveURL(/\/login\?next=/);
  await expect(p.getByText("문서를 보려면 먼저 로그인하세요.")).toBeVisible();
  await p.getByLabel("접근 키").fill(process.env.RB_VIEWER_KEY!);
  await p.getByRole("button", { name: "로그인" }).click();
  await expect(p).toHaveURL(`${RENDER}/${documentKey}`);
  await expect(p.locator("#ok")).toHaveText("ok");
  await fresh.close();
});
