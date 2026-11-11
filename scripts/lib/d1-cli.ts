// Shared by `pnpm key` and `pnpm project`: argument parsing and SQL through
// `wrangler d1 execute`, on the local D1 or, with --remote, on production.
import { execFileSync } from "node:child_process";
import { deployConfigArgs, ENV_FLAG, readDeployConfig, wrangler, writeWranglerConfigs } from "./remote";

const args = process.argv.slice(2);
const VALUE_OPTIONS = new Set(["--name", "--role", "--project", "--env"]);

export const remote = args.includes("--remote");
// Appended to the follow-up commands we print, so copying one targets the same
// database (production and environment) as the command that printed it.
export const TARGET = remote ? ` --remote${ENV_FLAG}` : "";
export const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.has(args[i - 1] ?? ""));
export const flag = (name: string) => args.includes(`--${name}`);
export const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

// --remote uses the production settings from render-box.deploy.json.
if (remote) writeWranglerConfigs(readDeployConfig());

export function d1(sql: string): Record<string, unknown>[] {
  const command = ["d1", "execute", "DB", "--json", "--command", sql];
  const out = remote
    ? wrangler("admin", [...command, "--remote", ...deployConfigArgs], { capture: true })
    : execFileSync("pnpm", ["exec", "wrangler", ...command, "--local", "--persist-to", "../../.wrangler/state"], {
        cwd: new URL("../../apps/admin/", import.meta.url),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      });
  const parsed = JSON.parse(out) as { results?: Record<string, unknown>[] }[];
  return parsed.flatMap((r) => r.results ?? []);
}

const ROLES = ["EDITOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export function parseRole(value: string | undefined): Role {
  const role = value?.toUpperCase();
  if (!ROLES.includes(role as Role)) fail("--role은 EDITOR 또는 VIEWER여야 합니다.");
  return role as Role;
}

export const isSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s) && s.length >= 2;

export function findKey(prefix: string | undefined) {
  if (!prefix) fail(`키 prefix를 넣어 주세요 (\`pnpm key list${TARGET}\`의 prefix).`);
  const rows = d1(`SELECT id, name FROM access_keys WHERE key_prefix = ${sqlString(prefix)}`);
  if (rows.length !== 1) fail(rows.length ? `prefix ${prefix}가 여러 키와 겹칩니다.` : `prefix ${prefix}인 키가 없습니다.`);
  return rows[0] as { id: number; name: string };
}

export function findProject(slug: string | undefined) {
  if (!slug) fail(`프로젝트 slug를 넣어 주세요 (\`pnpm project list${TARGET}\`).`);
  const row = d1(`SELECT id, slug, name FROM projects WHERE slug = ${sqlString(slug)}`)[0];
  if (!row) fail(`프로젝트가 없습니다: ${slug}. 만들려면: pnpm project create ${slug} --name <이름>${TARGET}`);
  return row as { id: number; slug: string; name: string };
}
