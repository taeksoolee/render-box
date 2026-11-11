// Removes a deployment made with `pnpm setup:remote --env <name>`: its three
// Workers, its D1 database (every document in it) and its deploy config.
// Never the default deployment.
//
//   pnpm teardown:remote --env <name> --yes
import { rmSync } from "node:fs";
import { APPS, CONFIG_NAME, DB_NAME, ENV, ENV_FLAG, hasDeployConfig, readDeployConfig, ROOT, WORKER_NAMES, wrangler } from "./lib/remote";

if (!ENV) {
  console.error("기본 환경(운영)은 이 명령으로 지우지 않습니다. 지울 환경을 --env <이름>으로 주세요.");
  process.exit(1);
}
const targets = `Worker ${Object.values(WORKER_NAMES).join(", ")}, D1 ${DB_NAME}(안의 문서 전부), ${CONFIG_NAME}`;
if (!process.argv.includes("--yes")) {
  console.error(`다음을 지웁니다. 되돌릴 수 없습니다:\n  ${targets}\n확인했으면 --yes를 붙여 다시 실행하세요:\n  pnpm teardown:remote${ENV_FLAG} --yes`);
  process.exit(1);
}
const accountId = hasDeployConfig() ? readDeployConfig().accountId : undefined;

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
  wrangler("admin", ["d1", "delete", DB_NAME, "-y"], { capture: true, accountId });
  console.log(`지웠습니다: D1 ${DB_NAME}`);
} catch {
  console.log(`없거나 지우지 못했습니다: D1 ${DB_NAME}`);
}
rmSync(new URL(CONFIG_NAME, ROOT), { force: true });
console.log(`지웠습니다: ${CONFIG_NAME}`);
