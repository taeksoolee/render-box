import { randomBase62, sha256Hex } from "@render-box/shared";

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

export type ActiveKey = { id: number; name: string; role: "EDITOR" | "VIEWER" };

// The key behind a raw key string, or null when unknown or revoked.
export async function findActiveKey(d1: D1Database, rawKey: string): Promise<ActiveKey | null> {
  return d1
    .prepare("SELECT id, name, role FROM access_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(await hashAccessKey(rawKey))
    .first<ActiveKey>();
}
