import type { MiddlewareHandler } from "hono";
import { isDev, type AppEnv } from "../env";

// form-action must also list the render origin: browsers apply it to every
// redirect of a form submission, and login redirects through the render-host
// handoff (design.md 3.4).
export function adminCsp(renderOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self' ${renderOrigin}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

// no-transform keeps Cloudflare's edge from compressing pages that carry CSRF
// tokens next to reflected input (BREACH, design.md 7.4).
export function adminSecurityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("Content-Security-Policy", adminCsp(c.env.RENDER_ORIGIN));
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "same-origin");
    h.set("Cache-Control", "no-store, no-transform");
    if (!isDev(c.env)) h.set("Strict-Transport-Security", "max-age=31536000");
  };
}
