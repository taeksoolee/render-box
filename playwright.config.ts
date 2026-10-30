import { defineConfig } from "@playwright/test";

// Runs against `pnpm dev` (admin :8787, render :8788). Keys come from
// RB_EDITOR_KEY / RB_VIEWER_KEY (create them with `pnpm key create`).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { browserName: "chromium", locale: "ko-KR" },
});
