// Production settings live outside git, in render-box.deploy.json (created by
// `pnpm setup:remote`). The committed apps/*/wrangler.toml hold placeholders;
// from them and this file we generate apps/*/wrangler.deploy.toml (also
// ignored), and every remote wrangler command runs with that config.
import { execFileSync, type StdioOptions } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const ROOT = new URL("../../", import.meta.url);
const CONFIG_FILE = new URL("render-box.deploy.json", ROOT);

export const APPS = ["render", "admin", "api"] as const;
export type App = (typeof APPS)[number];

export type DeployConfig = {
  accountId: string;
  databaseId: string;
  // Filled after the first deploy reveals the workers.dev subdomain, or set by
  // hand for custom domains.
  origins?: { app: string; render: string; api: string };
  storageLimitMb?: number;
  storageWarnPercent?: number;
  // Link for the admin "도움말" menu; "" hides it.
  helpUrl?: string;
  // Project slug the admin opens first when the viewer has not picked one.
  defaultProject?: string;
};

export const WORKER_NAMES: Record<App, string> = {
  render: "render-box-render",
  admin: "render-box-admin",
  api: "render-box-api",
};

export function hasDeployConfig() {
  return existsSync(CONFIG_FILE);
}

export function readDeployConfig(): DeployConfig {
  if (!hasDeployConfig()) {
    throw new Error("render-box.deploy.json이 없습니다. 먼저 `pnpm setup:remote`를 실행하세요.");
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as DeployConfig;
}

export function writeDeployConfig(config: DeployConfig) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export const workersDevOrigins = (subdomain: string) => ({
  app: `https://${WORKER_NAMES.admin}.${subdomain}.workers.dev`,
  render: `https://${WORKER_NAMES.render}.${subdomain}.workers.dev`,
  api: `https://${WORKER_NAMES.api}.${subdomain}.workers.dev`,
});

const appDir = (app: App) => new URL(`apps/${app}/`, ROOT);

// Replaces `KEY = "..."` lines; appends to [vars] when a key is missing.
function setVar(toml: string, key: string, value: string): string {
  const line = `${key} = ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  if (re.test(toml)) return toml.replace(re, line);
  return toml.replace(/^\[vars\]\s*$/m, `[vars]\n${line}`);
}

export function writeWranglerConfigs(config: DeployConfig) {
  const origins = config.origins ?? workersDevOrigins("unknown");
  for (const app of APPS) {
    let toml = readFileSync(new URL("wrangler.toml", appDir(app)), "utf8");
    toml = toml.replace(/^database_id\s*=.*$/m, `database_id = ${JSON.stringify(config.databaseId)}`);
    toml = setVar(toml, "APP_ORIGIN", origins.app);
    toml = setVar(toml, "RENDER_ORIGIN", origins.render);
    if (app === "api") toml = setVar(toml, "API_ORIGIN", origins.api);
    if (app !== "render") {
      if (config.storageLimitMb !== undefined) toml = setVar(toml, "STORAGE_LIMIT_MB", String(config.storageLimitMb));
      if (config.storageWarnPercent !== undefined) toml = setVar(toml, "STORAGE_WARN_PERCENT", String(config.storageWarnPercent));
    }
    if (app === "admin" && config.helpUrl !== undefined) toml = setVar(toml, "HELP_URL", config.helpUrl);
    if (app === "admin" && config.defaultProject !== undefined) toml = setVar(toml, "DEFAULT_PROJECT", config.defaultProject);
    const header = "# Generated from wrangler.toml and render-box.deploy.json by scripts/lib/remote.ts. Do not edit.\n";
    writeFileSync(new URL("wrangler.deploy.toml", appDir(app)), header + toml);
  }
}

// Runs wrangler for one app against production. Returns stdout when captured.
export function wrangler(
  app: App,
  args: string[],
  opts: { capture?: boolean; input?: string; accountId?: string } = {},
): string {
  const accountId = opts.accountId ?? (hasDeployConfig() ? readDeployConfig().accountId : undefined);
  const stdio: StdioOptions = [opts.input !== undefined ? "pipe" : "inherit", opts.capture ? "pipe" : "inherit", "inherit"];
  const out = execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: appDir(app),
    encoding: "utf8",
    input: opts.input,
    stdio,
    env: { ...process.env, ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
  });
  return out ?? "";
}

export const deployConfigArgs = ["--config", "wrangler.deploy.toml"];

export function run(cmd: string, args: string[], cwd: URL = ROOT) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

// Builds admin assets, then deploys render → admin → api (design.md 9.3).
// Returns each Worker's printed URL.
export function deployAll(): Record<App, string | null> {
  writeWranglerConfigs(readDeployConfig());
  run("pnpm", ["--filter", "@render-box/admin", "build:assets"]);
  const urls = {} as Record<App, string | null>;
  for (const app of APPS) urls[app] = deployApp(app);
  return urls;
}

export function deployApp(app: App): string | null {
  const out = wrangler(app, ["deploy", ...deployConfigArgs], { capture: true });
  process.stdout.write(out);
  return /https:\/\/\S+\.workers\.dev/.exec(out)?.[0] ?? null;
}
