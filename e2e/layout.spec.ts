import { expect, test, type Page } from "@playwright/test";
import { APP, key, login } from "./helpers";

// Every page keeps the same left edge (no width jumps between pages), and the
// top bar fits on a phone (docs/ui.md §3).
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
    ["404", "/html/AAAAAAAAAAAAAAAAAAAAAA"],
  ] as const) {
    await page.goto(APP + path);
    // The first block of the page (h1, or the error card) against the logo.
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
