import { expect, test } from "@playwright/test";
import { APP, key, login, RENDER } from "./helpers";

// HTML versions and the storage screen (design.md 4.9).
const API = "http://api.localhost:8789/api/v1";
const auth = (role: "EDITOR" | "VIEWER") => ({ Authorization: `Bearer ${key(role)}` });
const html = (label: string) => `<!DOCTYPE html><meta charset="utf-8"><p id=v>${label}</p>`;

test.describe("versions", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "server-side behaviour; run once");

  test("replacing keeps the old HTML; restore, delete and storage screen", async ({ request, page }) => {
    const created = await request.post(`${API}/html?title=${encodeURIComponent("버전 테스트")}`, {
      headers: { ...auth("EDITOR"), "Content-Type": "text/html" },
      data: html("v1"),
    });
    expect(created.status()).toBe(201);
    const { document_key: docKey } = await created.json();
    const replaced = await request.put(`${API}/html/${docKey}/source`, {
      headers: { ...auth("EDITOR"), "Content-Type": "text/html" },
      data: html("v2"),
    });
    expect(replaced.status()).toBe(200);

    const versions = await (await request.get(`${API}/html/${docKey}/versions`, { headers: auth("VIEWER") })).json();
    expect(versions.versions.map((v: { seq: number; current: boolean }) => [v.seq, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(versions.versions[1].render_url).toBe(`${RENDER}/${docKey}/v/1`);

    // The render URL shows the current HTML; /v/1 the previous one.
    await login(page, "EDITOR");
    await page.goto(`${RENDER}/${docKey}`);
    await expect(page.locator("#v")).toHaveText("v2");
    await page.goto(`${RENDER}/${docKey}/v/1`);
    await expect(page.locator("#v")).toHaveText("v1");
    expect((await page.goto(`${RENDER}/${docKey}/v/9`))?.status()).toBe(404);

    // Source of a previous version stays text/plain on the admin host.
    const source = await page.request.get(`${APP}/html/${docKey}/v/1/source`);
    expect(source.headers()["content-type"]).toContain("text/plain");
    expect(await source.text()).toBe(html("v1"));

    // Restore v1: a new v3 pointing at v1's HTML.
    await page.goto(`${APP}/html/${docKey}`);
    const list = page.locator("#versions li");
    await expect(list).toHaveCount(2);
    await expect(list.first().getByRole("button", { name: "복원" })).toHaveCount(0);
    page.once("dialog", (d) => d.accept());
    await list.nth(1).getByRole("button", { name: "복원" }).click();
    await expect(page.getByText("버전을 복원했습니다")).toBeVisible();
    await expect(list).toHaveCount(3);
    await expect(list.first()).toContainText("v3");
    await expect(list.first()).toContainText("v1 복원");
    await page.goto(`${RENDER}/${docKey}`);
    await expect(page.locator("#v")).toHaveText("v1");

    // Delete v2 from the detail page; the current version has no delete button.
    await page.goto(`${APP}/html/${docKey}`);
    await expect(list.first().getByRole("button", { name: /삭제/ })).toHaveCount(0);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "v2 삭제" }).click();
    await expect(page.getByText("버전을 지웠습니다")).toBeVisible();
    await expect(list).toHaveCount(2);
    expect((await page.goto(`${RENDER}/${docKey}/v/2`))?.status()).toBe(404);

    // v1 shares its HTML with the current v3, so deleting it frees nothing.
    await page.goto(`${APP}/storage`);
    const row = page.locator("li", { hasText: "버전 테스트" });
    await expect(row).toContainText("v1");
    await expect(row).toContainText("지워도 공간이 늘지 않음");
    await row.getByRole("checkbox").check();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "선택한 버전 지우기" }).click();
    await expect(page.getByText("이전 버전 1개를 지웠습니다")).toBeVisible();
    // The shared blob must survive: the current version still renders.
    await page.goto(`${RENDER}/${docKey}`);
    await expect(page.locator("#v")).toHaveText("v1");

    // The list page shows storage usage.
    await page.goto(`${APP}/html`);
    await expect(page.getByRole("link", { name: /저장 공간 .* 자세히 보기/ })).toBeVisible();

    // Deleting the document removes every version.
    await page.goto(`${APP}/html/${docKey}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "삭제", exact: true }).first().click();
    await expect(page.getByText("문서를 삭제했습니다.")).toBeVisible();
    expect((await request.get(`${API}/html/${docKey}/versions`, { headers: auth("VIEWER") })).status()).toBe(404);
  });

  test("a current version cannot be deleted, even by a forged request", async ({ request, page }) => {
    const created = await request.post(`${API}/html?title=${encodeURIComponent("현재 버전 보호")}`, {
      headers: { ...auth("EDITOR"), "Content-Type": "text/html" },
      data: html("only"),
    });
    const { document_key: docKey } = await created.json();
    await login(page, "EDITOR");
    await page.goto(`${APP}/html/${docKey}`);
    const csrf = await page.locator('input[name="_csrf"]').first().inputValue();
    const res = await page.request.post(`${APP}/html/${docKey}/v/1/delete`, {
      form: { _csrf: csrf },
      headers: { Origin: APP },
    });
    expect(res.status()).toBe(400);
    await page.goto(`${RENDER}/${docKey}`);
    await expect(page.locator("#v")).toHaveText("only");
  });

  test("viewers see versions but cannot restore or delete", async ({ request, page }) => {
    const created = await request.post(`${API}/html?title=${encodeURIComponent("열람자 버전")}`, {
      headers: { ...auth("EDITOR"), "Content-Type": "text/html" },
      data: html("a"),
    });
    const { document_key: docKey } = await created.json();
    await request.put(`${API}/html/${docKey}/source`, {
      headers: { ...auth("EDITOR"), "Content-Type": "text/html" },
      data: html("b"),
    });
    await login(page, "VIEWER");
    await page.goto(`${APP}/html/${docKey}`);
    await expect(page.locator("#versions li")).toHaveCount(2);
    await expect(page.locator("#versions").getByRole("button")).toHaveCount(0);
    await page.goto(`${APP}/storage`);
    await expect(page.getByRole("button", { name: "선택한 버전 지우기" })).toHaveCount(0);
  });
});

// The cap itself is covered by packages/documents/test; here the server's
// 507 is simulated to check what the editor sees (design.md 4.9).
test("a full store shows how to free space and keeps the form", async ({ page }) => {
  await login(page, "EDITOR");
  await page.route(`${APP}/uploads`, (route) => route.fulfill({ status: 507, json: { error: "storage_full" } }));
  await page.goto(`${APP}/html/new`);
  await page.locator("#html-file").setInputFiles({ name: "full.html", mimeType: "text/html", buffer: Buffer.from(html("x")) });
  await page.getByLabel(/^제목/).fill("가득 참");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText(/저장 공간이 부족합니다/)).toBeVisible();
  await expect(page).toHaveURL(`${APP}/html/new`);
  await expect(page.getByLabel(/^제목/)).toHaveValue("가득 참");
  await expect(page.getByRole("button", { name: "저장" })).toBeEnabled();
});
