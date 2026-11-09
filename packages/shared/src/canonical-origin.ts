import type { MiddlewareHandler } from "hono";

// Sends page loads on any other host (localhost, 127.0.0.1, a second domain)
// to the configured origin. Origin checks and host-scoped cookies only work
// there, so a login from the wrong host would fail with a misleading 403.
export function canonicalOrigin<E extends object>(origin: (env: E) => string): MiddlewareHandler<{ Bindings: E }> {
  return async (c, next) => {
    const expected = origin(c.env);
    const url = new URL(c.req.url);
    if (url.origin === expected || (c.req.method !== "GET" && c.req.method !== "HEAD")) {
      await next();
      return;
    }
    return c.redirect(`${expected}${url.pathname}${url.search}`, 308);
  };
}
