// Fixture for remote.test.ts: prints what remote.ts derives from argv/RB_ENV.
import { readFileSync } from "node:fs";
import * as r from "../lib/remote";

const toml = readFileSync(new URL("../../apps/admin/wrangler.toml", import.meta.url), "utf8");
const out = r.renderWranglerConfig("admin", { accountId: "a", databaseId: "db-id", origins: { app: "https://a", render: "https://r", api: "https://p" } }, toml);
const line = (key: string) => new RegExp(`^${key} = (.*)$`, "m").exec(out)?.[1];
console.log(
  JSON.stringify({
    env: r.ENV,
    config: r.CONFIG_NAME,
    workers: r.WORKER_NAMES,
    db: r.DB_NAME,
    name: line("name"),
    dbName: line("database_name"),
    dbId: line("database_id"),
  }),
);
