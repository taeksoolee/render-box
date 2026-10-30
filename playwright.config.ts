import { defineConfig, devices } from "@playwright/test";

// Runs against `pnpm dev` (admin :8787, render :8788). Keys come from
// RB_EDITOR_KEY / RB_VIEWER_KEY (create them with `pnpm key create`).
// WebKit stands in for Safari. One worker: locally both Workers share one
// SQLite file and parallel writes intermittently fail with SQLITE_BUSY-like
// D1 errors ("Failed to get session commit token"); production D1 does not.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: { locale: "ko-KR" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], locale: "ko-KR" } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], locale: "ko-KR" } },
    { name: "webkit", use: { ...devices["Desktop Safari"], locale: "ko-KR" } },
  ],
});
