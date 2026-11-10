// Runs the admin and render Workers locally with DEV_MODE off and checks the
// code paths that only production takes. Dev mode skips them, so neither the
// e2e suite nor `pnpm dev` exercises them: missing the ASSETS binding once
// took the admin down with a 500 on every request (D-39).
//
//   pnpm check:prod-mode
//
// No Cloudflare account and no D1 data needed: only pages that work without a
// session are requested, against a throwaway local state.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "http://localhost:8797";
const RENDER = "http://localhost:8798";
const state = mkdtempSync(join(tmpdir(), "render-box-prod-mode-"));
const children: ChildProcess[] = [];

function start(app: "admin" | "render", port: number, inspector: number) {
  const child = spawn(
    "pnpm",
    [
      "exec", "wrangler", "dev",
      "--persist-to", state,
      "--port", String(port),
      "--inspector-port", String(inspector),
      "--var", "DEV_MODE:0",
      "--var", `APP_ORIGIN:${ADMIN}`,
      "--var", `RENDER_ORIGIN:${RENDER}`,
    ],
    { cwd: new URL(`../apps/${app}/`, import.meta.url), stdio: ["ignore", "ignore", "pipe"], detached: true },
  );
  let log = "";
  child.stderr!.on("data", (d) => (log += d));
  child.on("exit", (code) => {
    if (code && !stopping) {
      console.error(`${app} exited with ${code}\n${log.slice(-2000)}`);
      process.exit(1);
    }
  });
  children.push(child);
}

let stopping = false;
function stop() {
  stopping = true;
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
  rmSync(state, { recursive: true, force: true });
}
process.on("SIGINT", () => (stop(), process.exit(130)));

async function waitFor(url: string) {
  for (let i = 0; i < 240; i++) {
    try {
      await fetch(url);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

try {
  start("admin", 8797, 9240);
  start("render", 8798, 9241);
  await Promise.all([waitFor(`${ADMIN}/healthz`), waitFor(`${RENDER}/healthz`)]);

  // Admin: pages render, and link the content-hashed static files.
  const health = await fetch(`${ADMIN}/healthz`);
  check("admin /healthz is 200", health.status === 200, `status ${health.status}`);
  const login = await fetch(`${ADMIN}/login`);
  const html = await login.text();
  check("admin /login is 200", login.status === 200, `status ${login.status}`);
  check("admin sends HSTS outside dev", login.headers.has("strict-transport-security"));
  const css = /href="(\/static\/h\/app\.[0-9a-f]{12}\.css)"/.exec(html)?.[1];
  const js = /src="(\/static\/h\/app\.[0-9a-f]{12}\.js)"/.exec(html)?.[1];
  check("admin links hashed CSS and JS (manifest loaded)", !!css && !!js, "plain /static/ paths in the page");
  if (css) {
    const res = await fetch(ADMIN + css);
    check("hashed CSS is served", res.status === 200, `status ${res.status}`);
    check("hashed CSS is immutable", /immutable/.test(res.headers.get("cache-control") ?? ""), res.headers.get("cache-control") ?? "");
  }
  const plain = await fetch(`${ADMIN}/static/app.css`);
  check("plain CSS is not long-cached", !/immutable/.test(plain.headers.get("cache-control") ?? ""));

  // Render: the production CSP allows https only (dev also allows http).
  const r404 = await fetch(`${RENDER}/__check/not-found`);
  const csp = r404.headers.get("content-security-policy") ?? "";
  check("render CSP is sandboxed", /(^|;\s*)sandbox\b/.test(csp), csp);
  check("render CSP allows no plain http", !/\shttp:/.test(csp), csp);
} catch (err) {
  console.error(err);
  failed++;
} finally {
  stop();
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nprod-mode checks passed");
