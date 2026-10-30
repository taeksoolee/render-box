import type { MiddlewareHandler } from "hono";
import { isDev, type Env } from "./env";

// Applied to every render-host response after the handler runs, so error
// handlers that build fresh Response objects still get it (design.md 5.2).
// allow-same-origin must never be added.
//
// Local dev runs on plain http, so dev mode accepts http: wherever production
// accepts https:. Otherwise local tests would be stopped by CSP before the
// requests reach the admin host's Fetch Metadata check.
export function renderCsp(dev: boolean): string {
  const net = dev ? "https: http:" : "https:";
  return [
    "sandbox allow-scripts allow-forms allow-modals",
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${net} blob:`,
    `style-src 'unsafe-inline' ${net}`,
    `img-src data: blob: ${net}`,
    `font-src data: ${net}`,
    `media-src data: blob: ${net}`,
    `connect-src ${net} wss:${dev ? " ws:" : ""}`,
    "worker-src blob:",
    `frame-src ${net}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function renderSecurityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("Content-Security-Policy", renderCsp(isDev(c.env)));
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "no-referrer");
    h.set("X-Robots-Tag", "noindex, nofollow");
    h.set("Cache-Control", "no-store");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    if (!isDev(c.env)) h.set("Strict-Transport-Security", "max-age=31536000");
  };
}
