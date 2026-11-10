// Deploys all Workers with the production settings in render-box.deploy.json
// (design.md 9.3). Run `pnpm setup:remote` once before the first deploy.
//
//   pnpm deploy:prod          build admin assets, deploy render → admin → api
//   pnpm db:migrate:remote    apply pending D1 migrations to production
import { deployAll, deployConfigArgs, readDeployConfig, wrangler, writeWranglerConfigs } from "./lib/remote";

const command = process.argv[2];
writeWranglerConfigs(readDeployConfig());

if (command === "deploy") {
  deployAll();
} else if (command === "migrate") {
  wrangler("admin", ["d1", "migrations", "apply", "DB", "--remote", ...deployConfigArgs]);
} else {
  console.error("usage: tsx scripts/deploy.ts deploy|migrate");
  process.exit(1);
}
