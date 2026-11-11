import { canRead, createSession, loadSession, sessionCookieName, sessionCookieOptions, verifyHandoff } from "@render-box/auth";
import { blobStream, createDb, htmlDocuments, htmlDocumentVersions } from "@render-box/db";
import { canonicalOrigin, fetchMetadataGuard, isDocumentKey, safeRedirectPath } from "@render-box/shared";
import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { isDev, type Env } from "./env";
import { renderSecurityHeaders } from "./security-headers";
import { messagePage } from "./message-page";
import { injectStorageShim } from "./storage-shim";

const app = new Hono<{ Bindings: Env }>();

app.use("*", renderSecurityHeaders());
app.use("*", canonicalOrigin((env: Env) => env.RENDER_ORIGIN));
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

const notFound = (c: Context<{ Bindings: Env }>) =>
  c.html(
    messagePage({
      status: 404,
      title: "문서를 찾을 수 없습니다",
      body: "삭제되었거나 주소가 잘못되었습니다. 주소를 보낸 사람에게 확인해 주세요.",
      href: `${c.env.APP_ORIGIN}/html`,
    }),
    404,
  );

// The current HTML at /{key}, a previous version at /{key}/v/{seq}
// (design.md 4.9). Both get the same headers and storage shim.
async function render(c: Context<{ Bindings: Env }>, seq: number | null) {
  const env = c.env;
  const documentKey = c.req.param("documentKey") ?? "";
  if (!isDocumentKey(documentKey)) return notFound(c);

  const db = createDb(env.DB);
  const user = await loadSession(env.DB, getCookie(c, sessionCookieName("RENDER", isDev(env))), "RENDER");
  if (!user) {
    const next = encodeURIComponent(seq === null ? `/${documentKey}` : `/${documentKey}/v/${seq}`);
    return c.redirect(`${env.APP_ORIGIN}/auth/render?next=${next}`, 302);
  }

  let found: { blobId: number; projectId: number } | undefined;
  if (seq === null) {
    found = await db
      .select({ blobId: htmlDocuments.blobId, projectId: htmlDocuments.projectId })
      .from(htmlDocuments)
      .where(eq(htmlDocuments.documentKey, documentKey))
      .get();
  } else {
    found = await db
      .select({ blobId: htmlDocumentVersions.blobId, projectId: htmlDocuments.projectId })
      .from(htmlDocumentVersions)
      .innerJoin(htmlDocuments, eq(htmlDocuments.id, htmlDocumentVersions.documentId))
      .where(and(eq(htmlDocuments.documentKey, documentKey), eq(htmlDocumentVersions.seq, seq)))
      .get();
  }
  // Knowing the URL is not enough: the key must be in the document's project.
  // Other projects' documents get the same 404 as missing ones (design.md 3.9).
  if (!found || !canRead(user.projects, found.projectId)) return notFound(c);
  const { blobId } = found;

  return new Response(blobStream(env.DB, blobId, injectStorageShim), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

app.get("/:documentKey", (c) => render(c, null));
app.get("/:documentKey/v/:seq", async (c) => {
  const raw = c.req.param("seq");
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) return notFound(c);
  return render(c, Number(raw));
});

app.notFound(notFound);
app.onError((err, c) => {
  console.error(err);
  return c.html(
    messagePage({
      status: 500,
      title: "일시적인 오류가 발생했습니다",
      body: "잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.",
      href: `${c.env.APP_ORIGIN}/html`,
    }),
    500,
  );
});

export default app;
