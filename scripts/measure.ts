// Time to first byte of the production admin pages, and where Cloudflare ran
// them (cf-placement / cf-ray colo). For checking D-39: Smart Placement shows
// as "remote-<colo>" once it moves the Worker next to D1, "local-<colo>" while
// it still runs where the request landed.
//
//   pnpm measure                 public endpoints only
//   RB_KEY=rb_... pnpm measure   also the logged-in pages (list, storage)
import { readDeployConfig } from "./lib/remote";

const RUNS = 5;
const origins = readDeployConfig().origins;
if (!origins) throw new Error("render-box.deploy.json has no origins yet. Run `pnpm setup:remote`.");
const { app: APP, render: RENDER, api: API } = origins;

// fetch resolves once the response headers arrive: close to TTFB.
async function ttfb(url: string, headers: Record<string, string> = {}) {
  const start = performance.now();
  const res = await fetch(url, { headers, redirect: "manual" });
  const ms = performance.now() - start;
  await res.arrayBuffer();
  return { ms, res };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function row(label: string, url: string, headers: Record<string, string> = {}) {
  const times: number[] = [];
  let placement = "";
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const { ms, res } = await ttfb(url, headers);
    times.push(ms);
    status = res.status;
    const colo = res.headers.get("cf-ray")?.split("-")[1] ?? "?";
    placement = `${res.headers.get("cf-placement") ?? "-"} (ray ${colo})`;
  }
  const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
  console.log(
    `${label.padEnd(18)} ${String(status).padEnd(4)} median ${fmt(median(times))}  min ${fmt(Math.min(...times))}  max ${fmt(Math.max(...times))}  ${placement}`,
  );
}

console.log(`${new Date().toISOString()}  ${RUNS} runs each\n`);
await row("admin /healthz", `${APP}/healthz`);
await row("admin /login", `${APP}/login`);
await row("render /healthz", `${RENDER}/healthz`);
await row("api /healthz", `${API}/healthz`);

const key = process.env.RB_KEY;
if (key) {
  const res = await fetch(`${APP}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: APP, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key, next: "/html" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`login failed: ${res.status}`);
  await row("admin /html", `${APP}/html`, { Cookie: cookie });
  await row("admin /storage", `${APP}/storage`, { Cookie: cookie });
} else {
  console.log("\n(RB_KEY를 주면 로그인한 화면도 잽니다)");
}
