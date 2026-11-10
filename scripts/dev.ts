// Starts the Workers one after another. Each one opens the shared local D1
// file at startup, and starting them at the same moment fails with
// SQLITE_BUSY, so the next app waits until the previous one answers /healthz.
import { spawn, type ChildProcess } from "node:child_process";

const APPS = [
  { name: "render", url: "http://render.localhost:8788/healthz" },
  { name: "admin", url: "http://app.localhost:8787/healthz" },
  { name: "api", url: "http://api.localhost:8789/healthz" },
];

// Each app runs in its own process group: pnpm does not pass signals on to
// wrangler and workerd, so stopping only the direct child left them holding
// the ports. Signalling the group (-pid) stops all of them.
const children: ChildProcess[] = [];
const stop = () => {
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function prefix(name: string, stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) {
  let rest = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
}

async function waitFor(url: string, child: ChildProcess) {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`${url}: process exited`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

for (const app of APPS) {
  const child = spawn("pnpm", ["--filter", `@render-box/${app.name}`, "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  prefix(app.name, child.stdout!, process.stdout);
  prefix(app.name, child.stderr!, process.stderr);
  child.on("exit", (code) => {
    console.error(`[${app.name}] exited with ${code}`);
    stop();
  });
  await waitFor(app.url, child);
  console.log(`[dev] ${app.name} ready`);
}
console.log("[dev] admin http://app.localhost:8787 · render http://render.localhost:8788 · api http://api.localhost:8789 (MCP /mcp, REST /api/v1)");
