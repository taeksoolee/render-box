import { expect, test } from "@playwright/test";
import { APP, login, RENDER } from "./helpers";

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });

const HTML = `<!DOCTYPE html><html><head><title>이미지 문서</title></head><body>
<img id="a" src="images/logo.png">
<img id="b" src='images/logo.png' alt="same file twice">
<img id="c" src=photo.png>
<img id="ext" src="https://example.com/x.png">
<!-- <img src="commented.png"> -->
<script>var tpl = '<img src="' + 'built.png">'; var t2 = \`<img src="\${"x"}">\`;</script>
</body></html>`;

test("local <img src> files are inlined; unchosen ones become placeholders", async ({ page, context }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);
  await page.locator("#html-file").setInputFiles({ name: "doc.html", mimeType: "text/html", buffer: Buffer.from(HTML) });

  // Only markup <img> with local paths: not https, comments or script strings.
  const rows = page.locator("[data-image-row]");
  await expect(page.getByText("HTML이 쓰는 이미지 파일을 함께 넣을 수 있습니다")).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("images/logo.png");
  await expect(rows.nth(1)).toContainText("photo.png");

  await expect(page.getByText("이미지 2개 중 0개 선택 · 나머지 2개는 빈 상자로 표시됩니다")).toBeVisible();

  // One path by its own picker; the bulk picker matches by name only.
  await page.getByLabel("images/logo.png 이미지 파일 선택").setInputFiles(png("anything.png"));
  await expect(rows.nth(0)).toContainText("anything.png");
  await page.locator("[data-image-bulk]").setInputFiles([png("unused.png")]);
  await expect(page.getByText("연결하지 못한 파일: unused.png")).toBeVisible();
  await expect(page.getByText("이미지 2개 중 1개 선택 · 나머지 1개는 빈 상자로 표시됩니다")).toBeVisible();

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();
  const documentKey = new URL(page.url()).pathname.split("/").pop()!;

  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  for (const id of ["a", "b"]) {
    const img = render.locator(`#${id}`);
    await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);
  }
  // Not chosen: a grey placeholder box naming the file, not a broken image.
  const placeholder = render.locator("#c");
  await expect(placeholder).toHaveAttribute("src", /^data:image\/svg\+xml;charset=utf-8,.*photo\.png/);
  expect(await placeholder.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(400);
  await expect(render.locator("#ext")).toHaveAttribute("src", "https://example.com/x.png");

  // Script and comment text stay byte-for-byte.
  const source = await (await context.request.get(`${APP}/html/${documentKey}/source`)).text();
  expect(source).toContain(`<!-- <img src="commented.png"> -->`);
  expect(source).toContain(`'<img src="' + 'built.png">'`);
});

// NotReadableError: the file changed or moved after it was picked, or it is a
// cloud-drive placeholder. The form must say so instead of hanging.
test("unreadable files show a retry message", async ({ page }) => {
  await page.addInitScript(() => {
    const broken = (f: Blob) => f instanceof File && f.name.startsWith("broken");
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return broken(this) ? Promise.reject(new DOMException("x", "NotReadableError")) : arrayBuffer.call(this);
    };
    const readAsDataURL = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (f: Blob) {
      if (!broken(f)) return readAsDataURL.call(this, f);
      setTimeout(() => this.onerror?.(new ProgressEvent("error")));
    };
  });
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);

  await page.locator("#html-file").setInputFiles({ name: "broken.html", mimeType: "text/html", buffer: Buffer.from(HTML) });
  await expect(page.getByText("파일을 읽지 못했습니다.")).toBeVisible();
  await expect(page.locator("[data-dropzone]")).toHaveAttribute("data-state", "error");

  await page.locator("#html-file").setInputFiles({ name: "doc.html", mimeType: "text/html", buffer: Buffer.from(HTML) });
  await page.getByLabel("images/logo.png 이미지 파일 선택").setInputFiles(png("broken.png"));
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("broken.png 파일을 읽지 못했습니다.")).toBeVisible();
  // The unreadable file is dropped so the row asks again; nothing was saved.
  await expect(page.locator("[data-image-row]").first()).toContainText("선택하지 않으면 빈 상자로 표시됩니다");
  await expect(page).toHaveURL(`${APP}/html/new`);
  await expect(page.getByRole("button", { name: "저장" })).toBeEnabled();
});

test("image edited on disk after picking is reported (real Chromium error)", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "Chromium raises NotReadableError for files changed after picking");
  const { writeFileSync } = await import("node:fs");
  const path = info.outputPath("logo.png");
  writeFileSync(path, PNG);

  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);
  await page.locator("#html-file").setInputFiles({ name: "doc.html", mimeType: "text/html", buffer: Buffer.from(HTML) });
  await page.getByLabel("images/logo.png 이미지 파일 선택").setInputFiles(path);
  writeFileSync(path, Buffer.concat([PNG, PNG]));
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("logo.png 파일을 읽지 못했습니다.")).toBeVisible();
});
