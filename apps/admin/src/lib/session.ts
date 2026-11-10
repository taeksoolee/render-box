import { loadSession, sessionCookieName } from "@render-box/auth";
import { createDb } from "@render-box/db";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { isDev, type AppEnv } from "../env";

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, sessionCookieName("APP", isDev(c.env)));
  c.set("user", await loadSession(createDb(c.env.DB), c.env.DB, token, "APP"));
  await next();
};

function loginRedirect(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  if (c.req.header("HX-Request") === "true") {
    const current = c.req.header("HX-Current-URL");
    let next = "/html";
    if (current) {
      try {
        const u = new URL(current);
        next = u.pathname + u.search;
      } catch {}
    }
    c.header("HX-Redirect", `/login?next=${encodeURIComponent(next)}`);
    return c.body(null, 401);
  }
  const next = c.req.method === "GET" ? c.req.path + (new URL(c.req.url).search || "") : "/html";
  return c.redirect(`/login?next=${encodeURIComponent(next)}`, 302);
}

export const requireLogin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return loginRedirect(c);
  await next();
};
