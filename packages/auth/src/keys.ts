import { randomBase62, sha256Hex } from "@render-box/shared";
import { accessStatement, type Membership } from "./projects";

export const ACCESS_KEY_PREFIX = "rb_";

export function generateAccessKey(): string {
  return ACCESS_KEY_PREFIX + randomBase62(32);
}

// Keys are pasted by hand, so surrounding whitespace is ignored.
export function hashAccessKey(key: string): Promise<string> {
  return sha256Hex(key.trim());
}

export function accessKeyPrefix(key: string): string {
  return key.trim().slice(0, 8);
}

export type ActiveKey = { id: number; name: string; admin: boolean; projects: Membership[] };

// The key behind a raw key string, with its projects, or null when unknown or
// revoked. One D1 round trip.
export async function findActiveKey(d1: D1Database, rawKey: string): Promise<ActiveKey | null> {
  const hash = await hashAccessKey(rawKey);
  const [key, access] = await d1.batch<Record<string, unknown>>([
    d1.prepare("SELECT id, name, is_admin AS admin FROM access_keys WHERE key_hash = ? AND revoked_at IS NULL").bind(hash),
    accessStatement(d1, "k.key_hash = ? AND k.revoked_at IS NULL", hash),
  ]);
  const row = key?.results[0] as { id: number; name: string; admin: number } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, admin: row.admin === 1, projects: (access?.results ?? []) as Membership[] };
}
