// Access key management (design.md 3.1). Keys are generated locally; only the
// SHA-256 hash reaches D1, through `wrangler d1 execute`.
//
//   pnpm key create --name 홍길동 --role EDITOR [--remote]
//   pnpm key list [--remote]
//   pnpm key revoke <prefix> [--remote]
//   pnpm key set-role <prefix> EDITOR|VIEWER [--remote]
import { execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ROLES = ["EDITOR", "VIEWER"] as const;

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const positional = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--name") && !(args[i - 1] ?? "").startsWith("--role"));
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

function d1(sql: string): Record<string, unknown>[] {
  const target = remote ? ["--remote"] : ["--local", "--persist-to", "../../.wrangler/state"];
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", ...target, "--json", "--command", sql],
    { cwd: new URL("../apps/admin/", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const parsed = JSON.parse(out) as { results?: Record<string, unknown>[] }[];
  return parsed.flatMap((r) => r.results ?? []);
}

function parseRole(value: string | undefined) {
  const role = value?.toUpperCase();
  if (!ROLES.includes(role as (typeof ROLES)[number])) fail("role must be EDITOR or VIEWER");
  return role as (typeof ROLES)[number];
}

function requireKey(prefix: string | undefined) {
  if (!prefix) fail("missing key prefix (see `pnpm key list`)");
  const rows = d1(`SELECT id, name FROM access_keys WHERE key_prefix = ${sqlString(prefix)}`);
  if (rows.length !== 1) fail(rows.length ? `prefix ${prefix} is ambiguous` : `no key with prefix ${prefix}`);
  return rows[0] as { id: number; name: string };
}

const [command] = positional;
const now = Date.now();

switch (command) {
  case "create": {
    const name = option("name")?.trim();
    if (!name || name.length > 100) fail("--name is required (max 100 chars)");
    const role = parseRole(option("role"));
    let key = "rb_";
    for (let i = 0; i < 32; i++) key += BASE62[randomInt(62)];
    const hash = createHash("sha256").update(key).digest("hex");
    d1(
      `INSERT INTO access_keys (name, role, key_hash, key_prefix, created_at)
       VALUES (${sqlString(name)}, '${role}', '${hash}', '${key.slice(0, 8)}', ${now})`,
    );
    console.log(`\n${name} (${role}) 키를 발급했습니다. 이 키는 다시 볼 수 없으니 지금 전달하세요.\n\n  ${key}\n`);
    break;
  }
  case "list": {
    const rows = d1(
      "SELECT key_prefix, name, role, last_used_at, revoked_at FROM access_keys ORDER BY created_at",
    );
    const date = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString().slice(0, 16).replace("T", " ") : "-");
    console.table(
      rows.map((r) => ({
        prefix: r.key_prefix,
        name: r.name,
        role: r.role,
        last_used: date(r.last_used_at),
        revoked: date(r.revoked_at),
      })),
    );
    break;
  }
  case "revoke": {
    const key = requireKey(positional[1]);
    d1(`UPDATE access_keys SET revoked_at = ${now} WHERE id = ${key.id}; DELETE FROM sessions WHERE key_id = ${key.id};`);
    console.log(`${key.name} 키를 회수했고, 모든 세션을 종료했습니다.`);
    break;
  }
  case "set-role": {
    const key = requireKey(positional[1]);
    const role = parseRole(positional[2]);
    d1(`UPDATE access_keys SET role = '${role}' WHERE id = ${key.id}`);
    console.log(`${key.name} 키의 역할을 ${role}(으)로 바꿨습니다.`);
    break;
  }
  default:
    fail("usage: pnpm key <create|list|revoke|set-role> ... [--remote]");
}
