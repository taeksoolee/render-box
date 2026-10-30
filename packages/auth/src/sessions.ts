import { accessKeys, sessions, type Db } from "@render-box/db";
import { randomBase62, sha256Hex } from "@render-box/shared";
import { and, eq, lt } from "drizzle-orm";
import { SESSION_TTL_MS, type Host } from "./cookies";

export type SessionUser = {
  sessionId: string;
  familyId: string;
  csrfToken: string | null;
  keyId: number;
  name: string;
  role: "EDITOR" | "VIEWER";
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
export async function loadSession(db: Db, token: string | undefined, host: Host, now = Date.now()) {
  if (!token) return null;
  const id = await sha256Hex(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      familyId: sessions.familyId,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
      keyId: accessKeys.id,
      name: accessKeys.name,
      role: accessKeys.role,
      revokedAt: accessKeys.revokedAt,
    })
    .from(sessions)
    .innerJoin(accessKeys, eq(sessions.keyId, accessKeys.id))
    .where(and(eq(sessions.id, id), eq(sessions.host, host)))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt <= now || row.revokedAt !== null) return null;
  const { expiresAt: _e, revokedAt: _r, ...user } = row;
  return user satisfies SessionUser;
}

export async function deleteSessionFamily(db: Db, familyId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.familyId, familyId));
}

export async function deleteExpiredSessions(db: Db, keyId: number, now = Date.now()): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.keyId, keyId), lt(sessions.expiresAt, now)));
}
