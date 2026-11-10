import { randomBase62, sha256Hex } from "@render-box/shared";
import { loadMemberships, type Membership } from "./projects";

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

export type ActiveKey = { id: number; name: string; projects: Membership[] };

// The key behind a raw key string, with its projects, or null when unknown or
// revoked.
export async function findActiveKey(d1: D1Database, rawKey: string): Promise<ActiveKey | null> {
  const key = await d1
    .prepare("SELECT id, name FROM access_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(await hashAccessKey(rawKey))
    .first<{ id: number; name: string }>();
  return key ? { ...key, projects: await loadMemberships(d1, key.id) } : null;
}
