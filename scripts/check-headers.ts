// Post-deploy check against the production hosts (design.md 9.4). Reads the
// origins from each app's wrangler.toml, so run it after `pnpm deploy:prod`.
// Uses node:https instead of fetch: fetch merges repeated headers and hides
// whether a response carried one CSP header or two.
//   pnpm check:headers
import { request } from "node:https";
import { readFileSync } from "node:fs";

type Raw = { status: number; headers: [string, string][] };

function get(url: string, headers: Record<string, string> = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers }, (res) => {
      const raw: [string, string][] = [];
      for (let i = 0; i < res.rawHeaders.length; i += 2) raw.push([res.rawHeaders[i].toLowerCase(), res.rawHeaders[i + 1]]);
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: raw }));
    });
    req.on("error", reject);
    req.end();
  });
}

const all = (r: Raw, name: string) => r.headers.filter(([k]) => k === name).map(([, v]) => v);
const one = (r: Raw, name: string) => all(r, name)[0];

function origin(app: string, name: string): string {
  const toml = readFileSync(`apps/${app}/wrangler.toml`, "utf8");
  const value = new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m").exec(toml)?.[1];
  if (!value) throw new Error(`${name} not found in apps/${app}/wrangler.toml`);
  return value;
}

const APP = origin("admin", "APP_ORIGIN");
const RENDER = origin("render", "RENDER_ORIGIN");
const API = origin("api", "API_ORIGIN");

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

for (const base of [APP, RENDER, API]) {
  const r = await get(`${base}/healthz`);
  check(`${base}/healthz is 200`, r.status === 200, `status ${r.status}`);
}

// A render-host 404 is built outside the document route and must still be
// sandboxed.
const render404 = await get(`${RENDER}/__check/not-found`);
const renderCsp = all(render404, "content-security-policy");
check("render 404 has exactly one CSP", renderCsp.length === 1, `${renderCsp.length} found`);
check("render CSP is sandboxed", /(^|;\s*)sandbox\b/.test(renderCsp[0] ?? ""), renderCsp[0]);
check("render CSP has no allow-same-origin", !(renderCsp[0] ?? "").includes("allow-same-origin"));
check("render has HSTS", one(render404, "strict-transport-security") !== undefined);

// Admin pages carry CSRF tokens next to reflected input; the edge must not
// compress them (design.md 7.4).
const login = await get(`${APP}/login`, { "Accept-Encoding": "gzip, br" });
check("admin /login is 200", login.status === 200, `status ${login.status}`);
check("admin /login has exactly one CSP", all(login, "content-security-policy").length === 1);
check("admin /login is not compressed", one(login, "content-encoding") === undefined, one(login, "content-encoding"));
check("admin has HSTS", one(login, "strict-transport-security") !== undefined);
check("admin form-action allows render origin", (one(login, "content-security-policy") ?? "").includes(RENDER));

// The admin host must not serve the render CSP, and vice versa.
check("admin CSP is not the render CSP", !(one(login, "content-security-policy") ?? "").includes("sandbox"));

const mcpGet = await get(`${API}/mcp`);
check("api GET /mcp is 405", mcpGet.status === 405, `status ${mcpGet.status}`);
const restNoKey = await get(`${API}/api/v1/html`);
check("api REST without key is 401", restNoKey.status === 401, `status ${restNoKey.status}`);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
