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
