import type { Context } from "hono";
import type { AppEnv } from "../env";

// Every state-changing request needs a matching Origin and the session's
// CSRF token (design.md 3.5). Missing or "null" Origin is rejected.
export function originOk(c: Context<AppEnv>): boolean {
  return c.req.header("Origin") === c.env.APP_ORIGIN;
}

export function csrfOk(c: Context<AppEnv>, token: unknown): boolean {
  const expected = c.get("user")?.csrfToken;
  if (!expected || typeof token !== "string" || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
