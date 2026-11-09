// Login failures per IP: 10 failures within 10 minutes locks that IP for 30s
// after its latest failure (design.md 3.2). Workers keep no memory between
// requests, so failures live in D1.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 10;
const LOCK_MS = 30 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "127.0.0.1";
}

export async function isLoginLocked(d1: D1Database, ip: string, now = Date.now()): Promise<boolean> {
  const row = await d1
    .prepare("SELECT COUNT(*) AS n, MAX(at) AS last FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, now - WINDOW_MS)
    .first<{ n: number; last: number | null }>();
  return !!row && row.n >= LIMIT && row.last !== null && now - row.last < LOCK_MS;
}

export async function recordLoginFailure(d1: D1Database, ip: string, now = Date.now()): Promise<void> {
  await d1.batch([
    d1.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now),
    d1.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - RETENTION_MS),
  ]);
}
