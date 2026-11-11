// Removes a deployment made with `pnpm setup:remote --env <name>`: its three
// Workers, its D1 database (every document in it) and its deploy config.
// Never the default deployment.
//
//   pnpm teardown:remote --env <name> --yes [--no-backup]
//
// First it exports the D1 database to backups/<env>-<time>.sql (gitignored:
// it holds every document and key hash) and deletes nothing if that fails.
// Restore into a new D1 of the same name, then setup:remote reuses it:
//   wrangler d1 create <db> && wrangler d1 execute <db> --remote --file <backup>.sql
import { mkdirSync, rmSync, statSync } from "node:fs";
import {
  APPS,
  CONFIG_NAME,
  DB_NAME,
  deployConfigArgs,
  ENV,
  ENV_FLAG,
  hasDeployConfig,
  readDeployConfig,
  ROOT,
  WORKER_NAMES,
  wrangler,
  writeWranglerConfigs,
} from "./lib/remote";

if (!ENV) {
  console.error("기본 환경(운영)은 이 명령으로 지우지 않습니다. 지울 환경을 --env <이름>으로 주세요.");
  process.exit(1);
}
const targets = `Worker ${Object.values(WORKER_NAMES).join(", ")}, D1 ${DB_NAME}(안의 문서 전부), ${CONFIG_NAME}`;
if (!process.argv.includes("--yes")) {
  console.error(`다음을 지웁니다. 되돌릴 수 없습니다:\n  ${targets}\n확인했으면 --yes를 붙여 다시 실행하세요:\n  pnpm teardown:remote${ENV_FLAG} --yes`);
  process.exit(1);
}
const config = hasDeployConfig() ? readDeployConfig() : undefined;
const accountId = config?.accountId;
// D1 commands resolve the name through the wrangler config, and the committed
// one holds a placeholder id for "render-box": use this environment's.
if (config) writeWranglerConfigs(config);
const dbArgs = config ? deployConfigArgs : [];

if (!process.argv.includes("--no-backup")) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const dir = new URL("backups/", ROOT);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`${ENV}-${stamp}.sql`, dir);
  try {
    wrangler("admin", ["d1", "export", DB_NAME, "--remote", "-y", "--output", file.pathname, ...dbArgs], { capture: true, accountId });
  } catch {
    console.error(`D1 ${DB_NAME}을 백업하지 못해 아무것도 지우지 않았습니다. 이미 없는 DB라면 --no-backup을 붙여 다시 실행하세요.`);
    process.exit(1);
  }
  const mb = (statSync(file).size / 1024 / 1024).toFixed(2);
  console.log(`백업했습니다: backups/${ENV}-${stamp}.sql (${mb}MB)`);
}

for (const app of APPS) {
  // --force skips wrangler's confirmation prompt (this command asked above).
  try {
    const out = wrangler(app, ["delete", WORKER_NAMES[app], "--force"], { capture: true, accountId });
    console.log(/Successfully deleted/.test(out) ? `지웠습니다: Worker ${WORKER_NAMES[app]}` : `확인 필요: Worker ${WORKER_NAMES[app]}\n${out}`);
  } catch {
    console.log(`없거나 지우지 못했습니다: Worker ${WORKER_NAMES[app]}`);
  }
}
try {
  wrangler("admin", ["d1", "delete", DB_NAME, "-y", ...dbArgs], { capture: true, accountId });
  console.log(`지웠습니다: D1 ${DB_NAME}`);
} catch {
  console.log(`없거나 지우지 못했습니다: D1 ${DB_NAME}`);
}
rmSync(new URL(CONFIG_NAME, ROOT), { force: true });
console.log(`지웠습니다: ${CONFIG_NAME}`);
