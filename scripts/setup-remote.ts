// First-time (and repeatable) production setup on your own Cloudflare account
// (design.md 9.3). Safe to run again: it reuses what already exists.
//
//   pnpm setup:remote [--env <name>] [--account <id>] [--subdomain <name>]
//
// --env makes a separate deployment in the same account (Workers
// render-box-<name>-*, D1 render-box-<name>, render-box.<name>.deploy.json).
//
// 1. Checks `wrangler login` and picks the account
// 2. Finds or creates the D1 database "render-box"
// 3. Learns the workers.dev subdomain from the first deploy (or --subdomain)
// 4. Sets HANDOFF_SECRET on render and admin (same value) if missing
// 5. Applies migrations, deploys all Workers, runs the header checks
import { randomBytes } from "node:crypto";
import {
  CONFIG_NAME,
  DB_NAME,
  ENV_FLAG,
  WORKER_NAMES,
  deployAll,
  deployApp,
  deployConfigArgs,
  hasDeployConfig,
  readDeployConfig,
  run,
  workersDevOrigins,
  wrangler,
  writeDeployConfig,
  writeWranglerConfigs,
  type DeployConfig,
} from "./lib/remote";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}
const step = (message: string) => console.log(`\n▶ ${message}`);

console.log(`환경: ${ENV_FLAG ? ENV_FLAG.trim() : "기본"} · Worker ${Object.values(WORKER_NAMES).join(", ")} · D1 ${DB_NAME} · 설정 ${CONFIG_NAME}`);

// 1. Login and account
step("Cloudflare 로그인 확인");
let who: { loggedIn: boolean; email?: string; accounts?: { id: string; name: string }[] };
try {
  who = JSON.parse(wrangler("admin", ["whoami", "--json"], { capture: true }));
} catch {
  fail("Cloudflare에 로그인되어 있지 않습니다. `pnpm --filter @render-box/admin exec wrangler login`을 먼저 실행하세요.");
}
if (!who.loggedIn) fail("Cloudflare에 로그인되어 있지 않습니다. `pnpm --filter @render-box/admin exec wrangler login`을 먼저 실행하세요.");

const existing: Partial<DeployConfig> = hasDeployConfig() ? readDeployConfig() : {};
const accounts = who.accounts ?? [];
const accountId = option("account") ?? existing.accountId ?? (accounts.length === 1 ? accounts[0]!.id : undefined);
if (!accountId) {
  fail(
    "계정이 여러 개입니다. --account <id>로 고르세요:\n" + accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n"),
  );
}
if (accounts.length && !accounts.some((a) => a.id === accountId)) fail(`로그인한 사용자에게 ${accountId} 계정이 없습니다.`);
console.log(`  ${who.email ?? ""} · 계정 ${accountId}`);

// 2. D1
step(`D1 데이터베이스 "${DB_NAME}"`);
const listDbs = () =>
  JSON.parse(wrangler("admin", ["d1", "list", "--json"], { capture: true, accountId })) as { name: string; uuid: string }[];
let databaseId = existing.databaseId ?? listDbs().find((d) => d.name === DB_NAME)?.uuid;
if (databaseId) {
  console.log(`  있음: ${databaseId}`);
} else {
  wrangler("admin", ["d1", "create", DB_NAME], { accountId });
  databaseId = listDbs().find((d) => d.name === DB_NAME)?.uuid;
  if (!databaseId) fail("D1 데이터베이스를 만들었지만 목록에서 찾지 못했습니다. `wrangler d1 list`로 확인해 주세요.");
  console.log(`  만들었습니다: ${databaseId}`);
}

const config: DeployConfig = { ...existing, accountId, databaseId };
const subdomain = option("subdomain");
if (subdomain) config.origins = workersDevOrigins(subdomain);
writeDeployConfig(config);
writeWranglerConfigs(config);

// 3. Origins: a first render deploy prints its workers.dev URL.
if (!config.origins) {
  step("workers.dev 주소 확인 (렌더링 Worker를 먼저 배포)");
  const url = deployApp("render");
  const found = url && /^https:\/\/[^.]+\.([^.]+)\.workers\.dev/.exec(url)?.[1];
  if (!found) {
    fail(
      "workers.dev 주소를 알아내지 못했습니다. Cloudflare 대시보드 Workers 화면에서 서브도메인을 확인한 뒤 " +
        `\`pnpm setup:remote${ENV_FLAG} --subdomain <이름>\`으로 다시 실행하세요.`,
    );
  }
  config.origins = workersDevOrigins(found);
  writeDeployConfig(config);
  writeWranglerConfigs(config);
}
console.log(`  관리 ${config.origins.app}\n  렌더링 ${config.origins.render}\n  API ${config.origins.api}`);

// 4. HANDOFF_SECRET must be the same on render and admin. Values can't be read
// back, so if either Worker lacks it, set a fresh one on both.
step("HANDOFF_SECRET");
const hasSecret = (app: "render" | "admin") => {
  try {
    const list = JSON.parse(wrangler(app, ["secret", "list", ...deployConfigArgs, "--format", "json"], { capture: true }));
    return (list as { name: string }[]).some((s) => s.name === "HANDOFF_SECRET");
  } catch {
    return false; // Worker not deployed yet
  }
};
if (hasSecret("render") && hasSecret("admin")) {
  console.log("  두 Worker에 이미 있습니다.");
} else {
  const secret = randomBytes(32).toString("base64url");
  for (const app of ["render", "admin"] as const) {
    wrangler(app, ["secret", "put", "HANDOFF_SECRET", ...deployConfigArgs], { input: secret, capture: true });
  }
  console.log("  render, admin에 같은 값을 새로 등록했습니다.");
}

// 5. Migrations, deploy, checks
step("마이그레이션");
wrangler("admin", ["d1", "migrations", "apply", "DB", "--remote", ...deployConfigArgs]);

// Migration 0002 creates a "default" project to hold existing data. On a new
// install it is empty and has no members: remove it, so the first project is
// one you name.
wrangler("admin", [
  "d1", "execute", "DB", "--remote", ...deployConfigArgs, "--command",
  `DELETE FROM projects WHERE slug = 'default'
     AND NOT EXISTS (SELECT 1 FROM html_documents d WHERE d.project_id = projects.id)
     AND NOT EXISTS (SELECT 1 FROM key_projects kp WHERE kp.project_id = projects.id)`,
], { capture: true });

step("배포 (render → admin → api)");
deployAll();

step("배포 후 점검");
run("pnpm", ["-s", "check:headers", ...(ENV_FLAG ? ENV_FLAG.trim().split(" ") : [])]);

console.log(`
✓ 준비가 끝났습니다. 프로젝트와 첫 편집자 키를 만들고 ${config.origins.app} 에서 로그인하세요:

  pnpm project create <slug> --name <이름> --remote${ENV_FLAG}
  pnpm key create --remote${ENV_FLAG} --name <이름> --project <slug> --role EDITOR

모든 프로젝트를 관리할 키는 --project 대신 --admin으로 만듭니다.
`);
