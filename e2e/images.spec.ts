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

test("local <img src> blocks saving until every file is chosen, then inlines them", async ({ page, context }) => {
  await login(page, "EDITOR");
  await page.goto(`${APP}/html/new`);
  await page.locator("#html-file").setInputFiles({ name: "doc.html", mimeType: "text/html", buffer: Buffer.from(HTML) });

  // Only markup <img> with local paths: not https, comments or script strings.
  const rows = page.locator("[data-image-row]");
  await expect(page.getByText("HTML에 들어갈 이미지 파일을 선택해 주세요")).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("images/logo.png");
  await expect(rows.nth(1)).toContainText("photo.png");

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("이미지 2개의 파일을 선택해야 저장할 수 있습니다.")).toBeVisible();
  await expect(page).toHaveURL(`${APP}/html/new`);

  // One path by its own picker, the other by name through the bulk picker.
  await page.getByLabel("images/logo.png 이미지 파일 선택").setInputFiles(png("anything.png"));
  await expect(rows.nth(0)).toContainText("anything.png");
  await page.locator("[data-image-bulk]").setInputFiles([png("photo.png"), png("unused.png")]);
  await expect(rows.nth(1)).toContainText("photo.png");
  await expect(page.getByText("연결하지 못한 파일: unused.png")).toBeVisible();

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다")).toBeVisible();
  const documentKey = new URL(page.url()).pathname.split("/").pop()!;

  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  for (const id of ["a", "b", "c"]) {
    const img = render.locator(`#${id}`);
    await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);
  }
  await expect(render.locator("#ext")).toHaveAttribute("src", "https://example.com/x.png");

  // Script and comment text stay byte-for-byte.
  const source = await (await context.request.get(`${APP}/html/${documentKey}/source`)).text();
  expect(source).toContain(`<!-- <img src="commented.png"> -->`);
  expect(source).toContain(`'<img src="' + 'built.png">'`);
});
