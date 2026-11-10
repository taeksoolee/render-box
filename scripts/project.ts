// Project and membership management (design.md 3.9). Like `pnpm key`, there
// is no web screen for this; it runs SQL through `wrangler d1 execute`.
//
//   pnpm project create <slug> --name <이름>
//   pnpm project list
//   pnpm project rename <slug> --name <이름>
//   pnpm project grant <key prefix> <slug> --role EDITOR|VIEWER
//   pnpm project revoke <key prefix> <slug>
//   pnpm project members <slug>
//   pnpm project move <document key> <slug>
//
// Add --remote to run against production.
import { d1, fail, findKey, findProject, isSlug, parseRole, positional, option, sqlString } from "./lib/d1-cli";

const [command, a, b] = positional;
const now = Date.now();
const name = () => {
  const value = option("name")?.trim();
  if (!value || value.length > 100) fail("--name is required (max 100 chars)");
  return value;
};

switch (command) {
  case "create": {
    if (!a || !isSlug(a)) fail("slug는 소문자·숫자·-로 2~32자여야 합니다. 예: tamna");
    if (d1(`SELECT id FROM projects WHERE slug = ${sqlString(a)}`).length) fail(`이미 있는 프로젝트입니다: ${a}`);
    const projectName = name();
    d1(`INSERT INTO projects (slug, name, created_at) VALUES (${sqlString(a)}, ${sqlString(projectName)}, ${now})`);
    console.log(`프로젝트 ${a} (${projectName})를 만들었습니다. 키를 넣으려면: pnpm project grant <prefix> ${a} --role EDITOR`);
    break;
  }
  case "list": {
    const rows = d1(
      `SELECT p.slug, p.name,
              (SELECT COUNT(*) FROM key_projects kp JOIN access_keys k ON k.id = kp.key_id
                WHERE kp.project_id = p.id AND k.revoked_at IS NULL) AS members,
              (SELECT COUNT(*) FROM html_documents d WHERE d.project_id = p.id) AS documents
       FROM projects p ORDER BY p.slug`,
    );
    console.table(rows);
    break;
  }
  case "rename": {
    const project = findProject(a);
    const projectName = name();
    d1(`UPDATE projects SET name = ${sqlString(projectName)} WHERE id = ${project.id}`);
    console.log(`${project.slug} 이름을 '${projectName}'(으)로 바꿨습니다.`);
    break;
  }
  case "grant": {
    const key = findKey(a);
    const project = findProject(b);
    const role = parseRole(option("role"));
    d1(
      `INSERT INTO key_projects (key_id, project_id, role, created_at) VALUES (${key.id}, ${project.id}, '${role}', ${now})
       ON CONFLICT (key_id, project_id) DO UPDATE SET role = excluded.role`,
    );
    console.log(`${key.name} 키를 ${project.slug}에 ${role}(으)로 넣었습니다. 다음 요청부터 반영됩니다.`);
    break;
  }
  case "revoke": {
    const key = findKey(a);
    const project = findProject(b);
    d1(`DELETE FROM key_projects WHERE key_id = ${key.id} AND project_id = ${project.id}`);
    console.log(`${key.name} 키를 ${project.slug}에서 뺐습니다. 다음 요청부터 반영됩니다.`);
    break;
  }
  case "members": {
    const project = findProject(a);
    console.table(
      d1(
        `SELECT k.key_prefix AS prefix, k.name, kp.role, CASE WHEN k.revoked_at IS NULL THEN '-' ELSE 'revoked' END AS revoked
         FROM key_projects kp JOIN access_keys k ON k.id = kp.key_id
         WHERE kp.project_id = ${project.id} ORDER BY k.name`,
      ),
    );
    const admins = d1("SELECT COUNT(*) AS n FROM access_keys WHERE is_admin = 1 AND revoked_at IS NULL")[0]?.n;
    if (admins) console.log(`이 밖에 관리자 키 ${admins}개가 모든 프로젝트에 접근합니다 (pnpm key list).`);
    break;
  }
  case "move": {
    if (!a || !/^[0-9A-Za-z]{22}$/.test(a)) fail("문서 키(22자)를 넣어 주세요. 상세 화면의 문서 ID입니다.");
    const project = findProject(b);
    const doc = d1(`SELECT id, title FROM html_documents WHERE document_key = ${sqlString(a)}`)[0] as
      | { id: number; title: string }
      | undefined;
    if (!doc) fail(`문서가 없습니다: ${a}`);
    d1(`UPDATE html_documents SET project_id = ${project.id} WHERE id = ${doc.id}`);
    console.log(`'${doc.title}'을(를) ${project.slug}(으)로 옮겼습니다. 렌더링 URL은 그대로입니다.`);
    break;
  }
  default:
    fail("usage: pnpm project <create|list|rename|grant|revoke|members|move> ... [--remote]");
}
