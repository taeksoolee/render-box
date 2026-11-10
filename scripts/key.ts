// Access key management (design.md 3.1). Keys are generated locally; only the
// SHA-256 hash reaches D1, through `wrangler d1 execute`. Roles belong to
// project memberships (design.md 3.9; see `pnpm project`).
//
//   pnpm key create --name 홍길동 [--project tamna --role EDITOR] [--remote]
//   pnpm key list [--remote]
//   pnpm key revoke <prefix> [--remote]
import { createHash, randomInt } from "node:crypto";
import { d1, fail, findKey, findProject, option, parseRole, positional, sqlString } from "./lib/d1-cli";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const [command] = positional;
const now = Date.now();

switch (command) {
  case "create": {
    const name = option("name")?.trim();
    if (!name || name.length > 100) fail("--name is required (max 100 chars)");
    const projectSlug = option("project");
    // Validate before issuing so a typo does not leave a key with no project.
    const project = projectSlug ? findProject(projectSlug) : null;
    const role = project ? parseRole(option("role")) : null;
    if (!project && option("role")) fail("--role은 --project와 함께 씁니다. 예: --project tamna --role EDITOR");

    let key = "rb_";
    for (let i = 0; i < 32; i++) key += BASE62[randomInt(62)];
    const hash = createHash("sha256").update(key).digest("hex");
    const membership = project
      ? `INSERT INTO key_projects (key_id, project_id, role, created_at)
         SELECT id, ${project.id}, '${role}', ${now} FROM access_keys WHERE key_hash = '${hash}';`
      : "";
    d1(
      `INSERT INTO access_keys (name, key_hash, key_prefix, created_at)
       VALUES (${sqlString(name)}, '${hash}', '${key.slice(0, 8)}', ${now}); ${membership}`,
    );
    const where = project ? `${project.slug} ${role}` : "프로젝트 없음";
    console.log(`\n${name} (${where}) 키를 발급했습니다. 이 키는 다시 볼 수 없으니 지금 전달하세요.\n\n  ${key}\n`);
    if (!project) console.log(`프로젝트에 넣으려면: pnpm project grant ${key.slice(0, 8)} <slug> --role EDITOR|VIEWER\n`);
    break;
  }
  case "list": {
    const rows = d1(
      `SELECT k.key_prefix, k.name, k.last_used_at, k.revoked_at,
              (SELECT group_concat(p.slug || ':' || kp.role, ', ') FROM key_projects kp JOIN projects p ON p.id = kp.project_id
                WHERE kp.key_id = k.id) AS projects
       FROM access_keys k ORDER BY k.created_at`,
    );
    const date = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString().slice(0, 16).replace("T", " ") : "-");
    console.table(
      rows.map((r) => ({
        prefix: r.key_prefix,
        name: r.name,
        projects: r.projects ?? "-",
        last_used: date(r.last_used_at),
        revoked: date(r.revoked_at),
      })),
    );
    break;
  }
  case "revoke": {
    const key = findKey(positional[1]);
    d1(`UPDATE access_keys SET revoked_at = ${now} WHERE id = ${key.id}; DELETE FROM sessions WHERE key_id = ${key.id};`);
    console.log(`${key.name} 키를 회수했고, 모든 세션을 종료했습니다.`);
    break;
  }
  case "set-role":
    fail("역할은 프로젝트마다 정합니다: pnpm project grant <prefix> <slug> --role EDITOR|VIEWER");
  default:
    fail("usage: pnpm key <create|list|revoke> ... [--remote]");
}
