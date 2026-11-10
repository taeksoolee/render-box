import { expect, test } from "@playwright/test";
import { APP, login } from "./helpers";

// Help and source links (D-36). The local HELP_URL comes from wrangler.toml.
const GUIDE = "https://github.com/taeksoolee/render-box/blob/main/docs/guide.md";

test("login, top bar and footer link to the guide and the source", async ({ page }) => {
  await page.goto(`${APP}/login`);
  await expect(page.getByRole("link", { name: /사용 안내/ })).toHaveAttribute("href", GUIDE);
  await expect(page.getByRole("link", { name: "render-box · GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/taeksoolee/render-box",
  );

  await login(page, "EDITOR");
  const help = page.getByRole("banner").getByRole("link", { name: /도움말/ });
  await expect(help).toHaveAttribute("href", GUIDE);
  await expect(help).toHaveAttribute("target", "_blank");
});
