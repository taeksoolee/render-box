import { expect, type Page } from "@playwright/test";

export const APP = "http://app.localhost:8787";
export const RENDER = "http://render.localhost:8788";

export function key(role: "EDITOR" | "VIEWER"): string {
  const value = process.env[`RB_${role}_KEY`];
  if (!value) throw new Error(`RB_${role}_KEY is not set`);
  return value;
}

export async function login(page: Page, role: "EDITOR" | "VIEWER") {
  await page.goto(`${APP}/login`);
  await page.getByLabel("접근 키").fill(key(role));
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(`${APP}/html`);
}

export async function createDocument(page: Page, title: string, html: string): Promise<string> {
  await page.goto(`${APP}/html/new`);
  await page.locator("#html-file").setInputFiles({ name: "doc.html", mimeType: "text/html", buffer: Buffer.from(html) });
  await page.getByLabel(/^제목/).fill(title);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop()!;
}
