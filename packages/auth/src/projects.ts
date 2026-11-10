import type { Role } from "@render-box/db";

// A key's role in one project (design.md 3.9). Loaded on every request with
// the key or session, so revoking access applies to the next request.
export type Membership = { projectId: number; slug: string; name: string; role: Role };

export async function loadMemberships(d1: D1Database, keyId: number): Promise<Membership[]> {
  const { results } = await d1
    .prepare(
      `SELECT p.id AS projectId, p.slug, p.name, kp.role
       FROM key_projects kp JOIN projects p ON p.id = kp.project_id
       WHERE kp.key_id = ? ORDER BY p.name, p.slug`,
    )
    .bind(keyId)
    .all<Membership>();
  return results;
}

export const roleIn = (projects: Membership[], projectId: number): Role | null =>
  projects.find((p) => p.projectId === projectId)?.role ?? null;

export const canRead = (projects: Membership[], projectId: number) => roleIn(projects, projectId) !== null;
export const canEdit = (projects: Membership[], projectId: number) => roleIn(projects, projectId) === "EDITOR";
export const editsAny = (projects: Membership[]) => projects.some((p) => p.role === "EDITOR");
