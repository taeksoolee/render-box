import { createSession, loadSession, sessionCookieName, sessionCookieOptions, verifyHandoff } from "@render-box/auth";
import { blobStream, createDb, htmlDocuments } from "@render-box/db";
import { fetchMetadataGuard, isDocumentKey, safeRedirectPath } from "@render-box/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { isDev, type Env } from "./env";
import { renderSecurityHeaders } from "./security-headers";
import { injectStorageShim } from "./storage-shim";

const app = new Hono<{ Bindings: Env }>();

app.use("*", renderSecurityHeaders());
app.use("*", fetchMetadataGuard({ skip: (path) => path === "/healthz" }));

app.get("/healthz", (c) => c.text("ok"));

// Handoff target: the admin host signed a short-lived token for an existing
// admin session; mint a render session in the same family (design.md 3.4).
app.get("/__auth", async (c) => {
  const env = c.env;
  const payload = await verifyHandoff(env.HANDOFF_SECRET, c.req.query("token") ?? "");
  if (!payload) return c.text("Invalid or expired link. Please open it again from render-box.", 400);

  const db = createDb(env.DB);
  const admin = await db.query.sessions.findFirst({
    where: (s, { and, eq }) => and(eq(s.id, payload.sid), eq(s.host, "APP")),
  });
  if (!admin || admin.expiresAt <= Date.now()) return c.redirect(`${env.APP_ORIGIN}/login`, 302);
  const key = await db.query.accessKeys.findFirst({ where: (k, { eq }) => eq(k.id, admin.keyId) });
  if (!key || key.revokedAt !== null) return c.redirect(`${env.APP_ORIGIN}/login`, 302);

  const { token } = await createSession(db, { keyId: key.id, host: "RENDER", familyId: admin.familyId });
  const dev = isDev(env);
  setCookie(c, sessionCookieName("RENDER", dev), token, sessionCookieOptions(dev));

  // ret is either a render path or an admin URL (return after login).
  const renderPath = safeRedirectPath(payload.ret, env.RENDER_ORIGIN, ["/"]);
  if (renderPath) return c.redirect(renderPath, 303);
  const adminPath = safeRedirectPath(payload.ret, env.APP_ORIGIN, ["/html"]);
  return c.redirect(`${env.APP_ORIGIN}${adminPath ?? "/html"}`, 303);
});

app.get("/:documentKey", async (c) => {
  const env = c.env;
  const documentKey = c.req.param("documentKey");
  if (!isDocumentKey(documentKey)) return c.text("문서를 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다.", 404);

  const db = createDb(env.DB);
  const user = await loadSession(db, getCookie(c, sessionCookieName("RENDER", isDev(env))), "RENDER");
  if (!user) {
    const next = encodeURIComponent(`/${documentKey}`);
    return c.redirect(`${env.APP_ORIGIN}/auth/render?next=${next}`, 302);
  }

  const doc = await db
    .select({ blobId: htmlDocuments.blobId })
    .from(htmlDocuments)
    .where(eq(htmlDocuments.documentKey, documentKey))
    .get();
  if (!doc) return c.text("문서를 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다.", 404);

  return new Response(blobStream(env.DB, doc.blobId, injectStorageShim), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.notFound((c) => c.text("Not Found", 404));
app.onError((err, c) => {
  console.error(err);
  return c.text("Internal Server Error", 500);
});

export default app;
