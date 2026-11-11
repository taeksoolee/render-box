import { sessions, type Db } from "@render-box/db";
import { randomBase62, sha256Hex } from "@render-box/shared";
import { and, eq, lt } from "drizzle-orm";
import { SESSION_TTL_MS, type Host } from "./cookies";
import { accessStatement, type Membership } from "./projects";

export type SessionUser = {
  sessionId: string;
  familyId: string;
  csrfToken: string | null;
  keyId: number;
  name: string;
  // First 8 characters, as `pnpm key list` shows them: lets a key with no
  // project tell the operator which key to add (design.md 3.9).
  keyPrefix: string;
  // All-projects admin (D-38); `projects` then lists every project as EDITOR.
  admin: boolean;
  projects: Membership[];
};

export async function createSession(
  db: Db,
  opts: { keyId: number; host: Host; familyId?: string; now?: number },
): Promise<{ token: string; id: string; csrfToken: string | null }> {
  const now = opts.now ?? Date.now();
  const token = randomBase62(43);
  const id = await sha256Hex(token);
  const csrfToken = opts.host === "APP" ? randomBase62(43) : null;
  await db.insert(sessions).values({
    id,
    keyId: opts.keyId,
    host: opts.host,
    familyId: opts.familyId ?? id,
    csrfToken,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
  });
  return { token, id, csrfToken };
}

// Expiry and revocation are checked on every read; expired rows are left for
// deleteExpiredSessions to remove at the next login (no cron, design.md 3.3).
// Memberships are read fresh each time (design.md 3.9), in the same D1 round
// trip as the session.
export async function loadSession(
  d1: D1Database,
  token: string | undefined,
  host: Host,
  now = Date.now(),
): Promise<SessionUser | null> {
  if (!token) return null;
  const id = await sha256Hex(token);
  const [session, access] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT s.id AS sessionId, s.family_id AS familyId, s.csrf_token AS csrfToken, s.expires_at AS expiresAt,
                k.id AS keyId, k.name, k.key_prefix AS keyPrefix, k.revoked_at AS revokedAt, k.is_admin AS admin
         FROM sessions s JOIN access_keys k ON k.id = s.key_id
         WHERE s.id = ? AND s.host = ?`,
      )
      .bind(id, host),
    accessStatement(d1, "s.id = ?", id),
  ]);
  const row = session?.results[0] as
    | (Omit<SessionUser, "admin" | "projects"> & { expiresAt: number; revokedAt: number | null; admin: number })
    | undefined;
  if (!row || row.expiresAt <= now || row.revokedAt !== null) return null;
  const { expiresAt: _e, revokedAt: _r, admin, ...user } = row;
  return { ...user, admin: admin === 1, projects: (access?.results ?? []) as Membership[] };
}

export async function deleteSessionFamily(db: Db, familyId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.familyId, familyId));
}

export async function deleteExpiredSessions(db: Db, keyId: number, now = Date.now()): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.keyId, keyId), lt(sessions.expiresAt, now)));
}
