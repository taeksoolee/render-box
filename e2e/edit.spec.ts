import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { APP, createDocument, login, RENDER } from "./helpers";

// Runs SQL against the local D1 the dev servers use (same as scripts/key.ts).
function sql(command: string) {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", "../../.wrangler/state", "--command", command],
    { cwd: new URL("../apps/admin/", import.meta.url), stdio: "ignore" },
  );
}

test("edit replaces the HTML and keeps the URL", async ({ page, context }) => {
  await login(page, "EDITOR");
  const documentKey = await createDocument(page, "수정 전", "<!DOCTYPE html><p id=v>v1</p>");

  await page.getByRole("link", { name: "수정" }).first().click();
  await expect(page.getByRole("heading", { name: "문서 수정" })).toBeVisible();
  await page.getByLabel(/^제목/).fill("수정 후");
  await page.locator("#html-file").setInputFiles({
    name: "v2.html",
    mimeType: "text/html",
    buffer: Buffer.from("<!DOCTYPE html><p id=v>v2</p>"),
  });
  await expect(page.getByText("교체 예정")).toBeVisible();
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page).toHaveURL(new RegExp(`/html/${documentKey}`));
  await expect(page.getByRole("heading", { name: "수정 후" })).toBeVisible();
  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  await expect(render.locator("#v")).toHaveText("v2");
});

test("concurrent edit gets 409 and keeps my input", async ({ browser, page }) => {
  await login(page, "EDITOR");
  const documentKey = await createDocument(page, "충돌", "<!DOCTYPE html><p>x</p>");

  // Two editors open the edit form on the same version.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await login(otherPage, "EDITOR");
  await page.goto(`${APP}/html/${documentKey}/edit`);
  await otherPage.goto(`${APP}/html/${documentKey}/edit`);

  await otherPage.getByLabel(/^제목/).fill("상대가 먼저");
  await otherPage.getByRole("button", { name: "저장" }).click();
  await expect(otherPage.getByText("저장했습니다")).toBeVisible();

  await page.getByLabel(/^제목/).fill("내 제목");
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/html/${documentKey}`)),
    page.getByRole("button", { name: "저장" }).click(),
  ]);
  expect(res.status()).toBe(409);
  await expect(page.getByText("다른 사람이 먼저 수정했습니다")).toBeVisible();
  await expect(page.getByLabel(/^제목/)).toHaveValue("내 제목");

  // Saving again on purpose overwrites with my content.
  await page.getByRole("button", { name: "내 내용으로 다시 저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();
  await expect(page.getByRole("heading", { name: "내 제목" })).toBeVisible();
  await other.close();
});

test("EUC-KR file is converted to UTF-8", async ({ page, context }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);
  // "안녕" in EUC-KR is BE C8 B3 E7.
  const html = Buffer.concat([
    Buffer.from('<!DOCTYPE html><html><head><meta charset="euc-kr"><title>euc</title></head><body><p id=t>'),
    Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]),
    Buffer.from("</p></body></html>"),
  ]);
  await page.locator("#html-file").setInputFiles({ name: "euc.html", mimeType: "text/html", buffer: html });
  await expect(page.getByText("EUC-KR 파일을 UTF-8로 변환했습니다.")).toBeVisible();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();

  const documentKey = new URL(page.url()).pathname.split("/").pop()!;
  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  await expect(render.locator("#t")).toHaveText("안녕");
});

test("paste mode saves pasted HTML", async ({ page, context }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);
  await page.getByText("직접 붙여넣기").click();
  await page.getByLabel("HTML 코드").fill("<!DOCTYPE html><html><head><title>붙여넣기</title></head><body><p id=p>pasted</p></body></html>");
  await expect(page.getByText(/붙여넣은 내용 ·/)).toBeVisible();
  await page.getByLabel(/^제목/).fill("붙여넣기 문서");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();

  const documentKey = new URL(page.url()).pathname.split("/").pop()!;
  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  await expect(render.locator("#p")).toHaveText("pasted");
});

test("logout ends both the admin and the render session", async ({ page, context }) => {
  await login(page, "VIEWER");
  const anyDoc = await page.locator("a[href^='/html/']").first().getAttribute("href");
  const documentKey = anyDoc!.split("/").pop()!;
  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  await expect(render).toHaveURL(`${RENDER}/${documentKey}`);

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(`${APP}/login`);
  await page.goto(`${APP}/html`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await render.goto(`${RENDER}/${documentKey}`);
  await expect(render).toHaveURL(/\/login\?next=/);
});

test("expired session sends the user back to login", async ({ page, context }) => {
  await login(page, "VIEWER");
  // Expire only this browser's session; other workers share the same key.
  const cookie = (await context.cookies(APP)).find((c) => c.name.endsWith("rb_app"))!;
  const id = createHash("sha256").update(cookie.value).digest("hex");
  sql(`UPDATE sessions SET expires_at = 0 WHERE id = '${id}'`);
  await page.goto(`${APP}/html`);
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("mobile layout has no horizontal scroll", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ko-KR" });
  const page = await context.newPage();
  await login(page, "EDITOR");
  for (const path of ["/html", "/html/new"]) {
    await page.goto(`${APP}${path}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto(`${APP}/html`);
  await page.locator("a[href^='/html/']:not([href='/html/new']):visible").first().click();
  await expect(page).toHaveURL(/\/html\/[0-9A-Za-z]{22}$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "detail").toBeLessThanOrEqual(0);
  await context.close();
});
