// Production settings live outside git, in render-box.deploy.json (created by
// `pnpm setup:remote`). The committed apps/*/wrangler.toml hold placeholders;
// from them and this file we generate apps/*/wrangler.deploy.toml (also
// ignored), and every remote wrangler command runs with that config.
//
// Environments: every remote command takes `--env <name>` (or RB_ENV). It
// selects render-box.<name>.deploy.json and prefixes the Worker and D1 names
// (render-box-<name>-admin, D1 render-box-<name>), so several deployments can
// share one Cloudflare account without touching each other. Without it the
// names are the plain render-box ones.
//
// `--base-name <name>` on the first `setup:remote` replaces that base (e.g. an
// environment alone in another account keeps the plain render-box-admin). It
// is stored in the environment's config as baseName, so later commands need
// only --env, and a different --base-name for an existing config is refused.
import { execFileSync, spawnSync, type StdioOptions } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const ROOT = new URL("../../", import.meta.url);

const argValue = (flag: string) => {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function envFromArgs(): string | null {
  const value = argValue("--env") ?? process.env.RB_ENV;
  if (value === undefined || value === "") return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?$/.test(value)) {
    console.error(`--env는 소문자·숫자·-로 1~20자여야 합니다: ${value}`);
    process.exit(1);
  }
  return value;
}

// The selected environment, or null for the default deployment.
export const ENV = envFromArgs();
export const CONFIG_NAME = ENV ? `render-box.${ENV}.deploy.json` : "render-box.deploy.json";
const CONFIG_FILE = new URL(CONFIG_NAME, ROOT);

function baseName(): { base: string; override?: string } {
  const fallback = ENV ? `render-box-${ENV}` : "render-box";
  const stored = existsSync(CONFIG_FILE)
    ? ((JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as DeployConfig).baseName ?? fallback)
    : undefined;
  const flag = argValue("--base-name");
  if (flag !== undefined && !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(flag)) {
    console.error(`--base-name은 소문자·숫자·-로 1~40자여야 합니다: ${flag}`);
    process.exit(1);
  }
  if (flag !== undefined && stored !== undefined && flag !== stored) {
    console.error(`${CONFIG_NAME}은 이미 이름 ${stored}로 만들어졌습니다. --base-name을 빼거나, 지우고(teardown) 다시 만드세요.`);
    process.exit(1);
  }
  const base = stored ?? flag ?? fallback;
  return { base, override: base === fallback ? undefined : base };
}

// Base of the Worker and D1 names.
const names = baseName();
export const BASE_NAME = names.base;
// Set when the base is not the default for this environment (saved as baseName).
export const BASE_NAME_OVERRIDE = names.override;
export const DB_NAME = BASE_NAME;
// Appended to the commands we print, so they target the same environment.
export const ENV_FLAG = ENV ? ` --env ${ENV}` : "";

export const APPS = ["render", "admin", "api"] as const;
export type App = (typeof APPS)[number];

export type DeployConfig = {
  accountId: string;
  // Base of the Worker and D1 names when not the default (--base-name).
  baseName?: string;
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
  render: `${BASE_NAME}-render`,
  admin: `${BASE_NAME}-admin`,
  api: `${BASE_NAME}-api`,
};

export function hasDeployConfig() {
  return existsSync(CONFIG_FILE);
}

export function readDeployConfig(): DeployConfig {
  if (!hasDeployConfig()) {
    throw new Error(`${CONFIG_NAME}이 없습니다. 먼저 \`pnpm setup:remote${ENV_FLAG}\`를 실행하세요.`);
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

// The deploy config for one app: the committed wrangler.toml with this
// environment's names, D1 and settings filled in.
export function renderWranglerConfig(app: App, config: DeployConfig, toml: string): string {
  const origins = config.origins ?? workersDevOrigins("unknown");
  toml = toml.replace(/^name\s*=.*$/m, `name = ${JSON.stringify(WORKER_NAMES[app])}`);
  toml = toml.replace(/^database_name\s*=.*$/m, `database_name = ${JSON.stringify(DB_NAME)}`);
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
  return `# Generated from wrangler.toml and ${CONFIG_NAME} by scripts/lib/remote.ts. Do not edit.\n` + toml;
}

export function writeWranglerConfigs(config: DeployConfig) {
  for (const app of APPS) {
    const toml = readFileSync(new URL("wrangler.toml", appDir(app)), "utf8");
    writeFileSync(new URL("wrangler.deploy.toml", appDir(app)), renderWranglerConfig(app, config, toml));
  }
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs wrangler for one app against production. Returns stdout when captured.
//
// When the stored login token has expired, wrangler refreshes it and uses the
// new token at once; Cloudflare can reject that first request with 7403
// ("account is not valid or not authorized") until the token takes effect.
// That request fails before doing anything, so one retry after a pause is safe.
export function wrangler(
  app: App,
  args: string[],
  opts: { capture?: boolean; input?: string; accountId?: string } = {},
): string {
  const accountId = opts.accountId ?? (hasDeployConfig() ? readDeployConfig().accountId : undefined);
  const stdio: StdioOptions = [opts.input !== undefined ? "pipe" : "inherit", opts.capture ? "pipe" : "inherit", "pipe"];
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
      cwd: appDir(app),
      encoding: "utf8",
      input: opts.input,
      stdio,
      env: { ...process.env, ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
    });
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) return result.stdout ?? "";
    if (attempt === 1 && /code: 7403/.test(result.stderr ?? "")) {
      console.error("\n↻ Cloudflare가 방금 갱신한 로그인 토큰을 아직 받지 않았습니다. 5초 뒤 한 번 더 시도합니다.\n");
      sleep(5000);
      continue;
    }
    throw new Error(`wrangler ${args.join(" ")} 실패 (exit ${result.status ?? result.signal})`);
  }
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
