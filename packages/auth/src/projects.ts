import type { Role } from "@render-box/db";

// A key's role in one project (design.md 3.9). Loaded on every request with
// the key or session, so revoking access applies to the next request.
export type Membership = { projectId: number; slug: string; name: string; role: Role };

// The projects of the key matched by `keyWhere` (a condition on `k`, with
// one ? parameter). An admin key (D-38) gets every project as EDITOR,
// including ones created later, so the permission checks stay the same for
// everyone. One statement, so callers can batch it with their key lookup.
export function accessStatement(d1: D1Database, keyWhere: string, param: string | number): D1PreparedStatement {
  return d1
    .prepare(
      `SELECT p.id AS projectId, p.slug, p.name, CASE WHEN k.is_admin = 1 THEN 'EDITOR' ELSE kp.role END AS role
       FROM ${keyWhere.includes("s.") ? "sessions s JOIN access_keys k ON k.id = s.key_id" : "access_keys k"}
       CROSS JOIN projects p
       LEFT JOIN key_projects kp ON kp.key_id = k.id AND kp.project_id = p.id
       WHERE ${keyWhere} AND (k.is_admin = 1 OR kp.role IS NOT NULL)
       ORDER BY p.name, p.slug`,
    )
    .bind(param);
}

export async function loadAccess(d1: D1Database, keyId: number): Promise<{ admin: boolean; projects: Membership[] }> {
  const [key, access] = await d1.batch<Record<string, unknown>>([
    d1.prepare("SELECT is_admin AS admin FROM access_keys WHERE id = ?").bind(keyId),
    accessStatement(d1, "k.id = ?", keyId),
  ]);
  return { admin: key?.results[0]?.admin === 1, projects: (access?.results ?? []) as Membership[] };
}

export const roleIn = (projects: Membership[], projectId: number): Role | null =>
  projects.find((p) => p.projectId === projectId)?.role ?? null;

export const canRead = (projects: Membership[], projectId: number) => roleIn(projects, projectId) !== null;
export const canEdit = (projects: Membership[], projectId: number) => roleIn(projects, projectId) === "EDITOR";
export const editsAny = (projects: Membership[]) => projects.some((p) => p.role === "EDITOR");
