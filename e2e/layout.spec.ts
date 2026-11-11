import { expect, test, type Page } from "@playwright/test";
import { APP, key, login, RENDER } from "./helpers";

// Every page keeps the same left edge (no width jumps between pages), and the
// top bar fits on a phone (docs/ui.md §3). Error pages are centered instead.
const API = "http://api.localhost:8789/api/v1";

async function someDocument() {
  const res = await fetch(`${API}/html?${new URLSearchParams({ title: `레이아웃 ${Date.now()}` })}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key("EDITOR")}`, "Content-Type": "text/html" },
    body: "<!DOCTYPE html><p>x",
  });
  return ((await res.json()) as { document_key: string }).document_key;
}

const leftOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().left));

test("pages share one left edge, the header's", async ({ page }) => {
  const docKey = await someDocument();
  await login(page, "EDITOR");
  const edges: Record<string, number> = {};
  for (const [name, path] of [
    ["list", "/html?project=default"],
    ["detail", `/html/${docKey}`],
    ["edit", `/html/${docKey}/edit`],
    ["new", "/html/new?project=default"],
    ["storage", "/storage"],
  ] as const) {
    await page.goto(APP + path);
    // The first block of the page (its h1) against the logo.
    edges[name] = await leftOf(page, "main > *, main > div > *");
    expect(edges[name], name).toBe(await leftOf(page, "header a"));
  }
});

test("the top bar fits on a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  await login(page, "EDITOR");
  await page.goto(`${APP}/html?project=default`);
  const box = await page.evaluate(() => {
    const logo = document.querySelector("header a")!.getBoundingClientRect();
    const right = document.querySelector("header > div > div")!.getBoundingClientRect();
    return { gap: right.left - logo.right, rightEdge: right.right, width: window.innerWidth, height: right.height };
  });
  expect(box.gap).toBeGreaterThan(0);
  expect(box.rightEdge).toBeLessThanOrEqual(box.width);
  expect(box.height).toBeLessThanOrEqual(40); // one line
  await expect(page.getByRole("link", { name: /도움말/ })).toBeVisible();
  await context.close();
});

// Horizontal center of the error card against the viewport's.
const offCenter = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - document.documentElement.clientWidth / 2);
  });

test("error pages are centered, with and without the top bar", async ({ page }) => {
  const missing = "/html/AAAAAAAAAAAAAAAAAAAAAA";
  await page.goto(`${APP}/no-such-page`);
  await expect(page.getByRole("heading", { name: "문서를 찾을 수 없습니다" })).toBeVisible();
  expect(await offCenter(page, "main > div")).toBeLessThanOrEqual(1);

  await login(page, "EDITOR");
  await page.goto(APP + missing);
  await expect(page.getByRole("heading", { name: "문서를 찾을 수 없습니다" })).toBeVisible();
  expect(await offCenter(page, "main > div")).toBeLessThanOrEqual(1);

  // The render host's own 404 is a page too, with a way back.
  const res = await page.goto(`${RENDER}/AAAAAAAAAAAAAAAAAAAAAA`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "문서를 찾을 수 없습니다" })).toBeVisible();
  await expect(page.getByRole("link", { name: "render-box 목록으로" })).toHaveAttribute("href", `${APP}/html`);
  expect(await offCenter(page, "main")).toBeLessThanOrEqual(1);
});
