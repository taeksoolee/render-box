import { expect, test, type Page } from "@playwright/test";
import { APP, key, login } from "./helpers";

// hx-boost and proximity prefetch in the admin (app.js "navigation" and
// "prefetch"). A window marker tells a body swap from a full page load.
const API = "http://api.localhost:8789/api/v1";
const html = (label: string) => `<!DOCTYPE html><meta charset="utf-8"><p id=v>${label}</p>`;

async function upload(title: string) {
  const res = await fetch(`${API}/html?${new URLSearchParams({ title })}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key("EDITOR")}`, "Content-Type": "text/html" },
    body: html(title),
  });
  return ((await res.json()) as { document_key: string }).document_key;
}

const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __rb: number }).__rb = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __rb?: number }).__rb === 1);

// Documents of the current project are listed newest first.
async function listWith(page: Page, title: string) {
  await page.goto(`${APP}/html?project=default&q=${encodeURIComponent(title)}`);
  return page.locator("table tbody tr", { hasText: title });
}

test("links swap the page without a full load; Back reloads", async ({ page }) => {
  const title = `부스트 ${Date.now()}`;
  const docKey = await upload(title);
  await login(page, "EDITOR");
  const row = await listWith(page, title);
  await mark(page);
  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(`${APP}/html/${docKey}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page).toHaveTitle(`${title} · render-box`);
  expect(await marked(page)).toBe(true);
  await expect(page.locator("#main")).toBeFocused();

  // No history cache: Back loads the list page again.
  await page.goBack();
  await expect(page).toHaveURL(/\/html\?project=default/);
  await expect(page.locator("table tbody tr", { hasText: title })).toBeVisible();
  expect(await marked(page)).toBe(false);
});

test("the upload form is a full load (its JS binds window listeners)", async ({ page }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html?project=default`);
  await mark(page);
  await page.getByRole("link", { name: /새 HTML 등록/ }).click();
  await expect(page).toHaveURL(/\/html\/new/);
  expect(await marked(page)).toBe(false);
});

test("cancelling a delete confirm sends nothing on a boosted page", async ({ page }) => {
  const title = `삭제 취소 ${Date.now()}`;
  const docKey = await upload(title);
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/${docKey}`);
  const posts: string[] = [];
  page.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "삭제", exact: true }).first().click();
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});

test("a boosted link to a missing document shows the 404 page", async ({ page }) => {
  const docKey = await upload(`사라질 문서 ${Date.now()}`);
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/${docKey}`);
  const csrf = await page.locator('input[name="_csrf"]').first().inputValue();
  await page.request.post(`${APP}/html/${docKey}/delete`, { form: { _csrf: csrf }, headers: { Origin: APP } });

  // A link to it from a page opened before the delete.
  await page.goto(`${APP}/html?project=default`);
  await page.evaluate((k) => {
    const a = document.createElement("a");
    a.href = `/html/${k}`;
    a.textContent = "오래된 링크";
    document.querySelector("main")!.append(a);
    (window as unknown as { htmx: { process(e: Element): void } }).htmx.process(a);
  }, docKey);
  await mark(page);
  await page.getByRole("link", { name: "오래된 링크" }).click();
  await expect(page.getByRole("heading", { name: "문서를 찾을 수 없습니다" })).toBeVisible();
  expect(await marked(page)).toBe(true);
});

test.describe("prefetch", () => {
  test("the pointer near a row fetches its page; the click uses it without a new request", async ({ page }) => {
    const title = `프리페치 ${Date.now()}`;
    const docKey = await upload(title);
    await login(page, "EDITOR");
    const row = await listWith(page, title);
    const detail = `${APP}/html/${docKey}`;
    const fetched: string[] = [];
    page.on("request", (r) => r.url() === detail && fetched.push(r.method()));

    // Just outside the row (the click area), inside the 32px margin.
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + 100, box.y - 6);
    await page.mouse.move(box.x + 102, box.y - 6);
    await expect.poll(() => fetched.length).toBe(1);

    await mark(page);
    await row.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(detail);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(fetched).toEqual(["GET"]);
    expect(await marked(page)).toBe(true);
    // The swapped page works: its copy button and forms are bound.
    await expect(page.locator("#versions")).toBeVisible();
  });

  test("project menu links are never prefetched", async ({ page }) => {
    await login(page, "EDITOR");
    await page.goto(`${APP}/html?project=default`);
    const projectRequests: string[] = [];
    page.on("request", (r) => r.url().includes("?project=") && projectRequests.push(r.url()));
    for (const a of await page.locator("[data-no-prefetch] a").all()) {
      const b = await a.boundingBox();
      if (b) await page.mouse.move(b.x + 5, b.y + 5);
    }
    await page.locator("header").hover();
    await page.waitForTimeout(300);
    expect(projectRequests).toEqual([]);
  });
});
