import type { Role } from "@render-box/db";

// A key's role in one project (design.md 3.9). Loaded on every request with
// the key or session, so revoking access applies to the next request.
export type Membership = { projectId: number; slug: string; name: string; role: Role };

// An admin key (D-38) gets every project as EDITOR, including ones created
// later, so the permission checks stay the same for everyone.
export async function loadAccess(d1: D1Database, keyId: number): Promise<{ admin: boolean; projects: Membership[] }> {
  const key = await d1.prepare("SELECT is_admin AS admin FROM access_keys WHERE id = ?").bind(keyId).first<{ admin: number }>();
  const admin = key?.admin === 1;
  const { results } = admin
    ? await d1
        .prepare("SELECT id AS projectId, slug, name, 'EDITOR' AS role FROM projects ORDER BY name, slug")
        .all<Membership>()
    : await d1
        .prepare(
          `SELECT p.id AS projectId, p.slug, p.name, kp.role
           FROM key_projects kp JOIN projects p ON p.id = kp.project_id
           WHERE kp.key_id = ? ORDER BY p.name, p.slug`,
        )
        .bind(keyId)
        .all<Membership>();
  return { admin, projects: results };
}

export const roleIn = (projects: Membership[], projectId: number): Role | null =>
  projects.find((p) => p.projectId === projectId)?.role ?? null;

export const canRead = (projects: Membership[], projectId: number) => roleIn(projects, projectId) !== null;
export const canEdit = (projects: Membership[], projectId: number) => roleIn(projects, projectId) === "EDITOR";
export const editsAny = (projects: Membership[]) => projects.some((p) => p.role === "EDITOR");
