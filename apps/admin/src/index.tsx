import {
  createSession,
  deleteExpiredSessions,
  deleteSessionFamily,
  HANDOFF_TTL_MS,
  hashAccessKey,
  sessionCookieName,
  sessionCookieOptions,
  signHandoff,
} from "@render-box/auth";
import { blobStream, createDb, deleteBlobStatements, MAX_HTML_BYTES, type DocumentLink } from "@render-box/db";
import { fetchMetadataGuard, generateDocumentKey, isDocumentKey, safeRedirectPath } from "@render-box/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, setCookie } from "hono/cookie";
import { isDev, type AppEnv } from "./env";
import { csrfOk, originOk } from "./lib/csrf";
import {
  hasErrors,
  readDocumentForm,
  validateDocumentForm,
  type DocumentFormErrors,
  type DocumentFormValues,
} from "./lib/document-form";
import { clientIp, isLoginLocked, recordLoginFailure } from "./lib/rate-limit";
import { adminSecurityHeaders } from "./lib/security-headers";
import { loadUser, requireLogin } from "./lib/session";
import { deleteOrphanBlobs, findAttachableBlob, storeUpload, UploadError } from "./lib/uploads";
import { DetailPage, type DetailDoc } from "./views/detail";
import { ERRORS, ErrorPage, type ErrorKind } from "./views/error";
import { DocumentFormPage, type FormMode, type KeptUpload } from "./views/form";
import { ListCount, ListPage, ListRegion, type ListData, type ListRow } from "./views/list";
import { LoginPage } from "./views/login";

type Ctx = Context<AppEnv>;

const PAGE_SIZE = 20;
const FORM_LIMIT = 64 * 1024;
const LOGIN_NEXT_PREFIXES = ["/html", "/auth/render"];

const app = new Hono<AppEnv>();

app.use("*", adminSecurityHeaders());

// DEV_MODE only: records what actually reaches the admin host so isolation
// tests can assert on server-side facts (design.md 10.5). Never enabled in
// production because DEV_MODE is only set in .dev.vars.
type DevRecord = { method: string; path: string; site: string | null; dest: string | null; cookie: boolean; status: number };
const devRequests: DevRecord[] = [];
app.use("*", async (c, next) => {
  await next();
  if (!isDev(c.env) || c.req.path.startsWith("/__dev/")) return;
  devRequests.push({
    method: c.req.method,
    path: c.req.path,
    site: c.req.header("Sec-Fetch-Site") ?? null,
    dest: c.req.header("Sec-Fetch-Dest") ?? null,
    cookie: !!c.req.header("Cookie"),
    status: c.res.status,
  });
  if (devRequests.length > 500) devRequests.shift();
});
app.get("/__dev/requests", (c) => (isDev(c.env) ? c.json(devRequests) : errorPage(c, "notFound")));

app.use("*", fetchMetadataGuard({ skip: (path) => path === "/healthz" }));
app.get("/healthz", (c) => c.text("ok"));
app.use("*", loadUser);

const formLimit = bodyLimit({ maxSize: FORM_LIMIT, onError: (c) => errorPage(c as Ctx, "tooLarge") });

function errorPage(c: Ctx, kind: ErrorKind) {
  return c.html(<ErrorPage kind={kind} user={c.get("user")} />, ERRORS[kind].status);
}

function requireEditor(c: Ctx) {
  return c.get("user")?.role === "EDITOR";
}

// Parses a small urlencoded form and enforces Origin + CSRF token.
async function readForm(c: Ctx) {
  if (!originOk(c)) return null;
  const body = await c.req.parseBody({ all: true });
  return csrfOk(c, body["_csrf"]) ? body : null;
}

// ---------------------------------------------------------------- auth

app.get("/", (c) => c.redirect("/html", 302));

app.get("/login", (c) => {
  const next = safeRedirectPath(c.req.query("next"), c.env.APP_ORIGIN, LOGIN_NEXT_PREFIXES);
  if (c.get("user")) return c.redirect(next ?? "/html", 302);
  return c.html(<LoginPage next={next} />);
});

app.post("/login", formLimit, async (c) => {
  // No session yet, so no CSRF token: require same-origin by Origin and Fetch
  // Metadata instead (design.md 3.2).
  if (!originOk(c) || c.req.header("Sec-Fetch-Site") !== "same-origin") return errorPage(c, "csrf");
  const body = await c.req.parseBody();
  const next = safeRedirectPath(String(body["next"] ?? ""), c.env.APP_ORIGIN, LOGIN_NEXT_PREFIXES);
  const ip = clientIp(c.req.raw);

  if (await isLoginLocked(c.env.DB, ip)) {
    return c.html(<LoginPage next={next} error="로그인 시도가 너무 많습니다. 30초 뒤에 다시 시도해 주세요." />, 429);
  }
  const rawKey = typeof body["key"] === "string" ? body["key"].trim() : "";
  if (!rawKey) return c.html(<LoginPage next={next} error="접근 키를 입력해 주세요." />, 422);

  const db = createDb(c.env.DB);
  const keyHash = await hashAccessKey(rawKey);
  const key = await db.query.accessKeys.findFirst({ where: (k, { eq }) => eq(k.keyHash, keyHash) });
  if (!key || key.revokedAt !== null) {
    await recordLoginFailure(c.env.DB, ip);
    console.log(JSON.stringify({ event: "login_failed", ip }));
    return c.html(
      <LoginPage
        next={next}
        error="키가 올바르지 않습니다. 복사할 때 앞뒤에 빈칸이 들어가지 않았는지 확인하고, 계속 안 되면 관리자에게 문의하세요."
      />,
      401,
    );
  }

  const now = Date.now();
  await deleteExpiredSessions(db, key.id, now);
  await c.env.DB.prepare("UPDATE access_keys SET last_used_at = ? WHERE id = ?").bind(now, key.id).run();
  const { token } = await createSession(db, { keyId: key.id, host: "APP", now });
  const dev = isDev(c.env);
  setCookie(c, sessionCookieName("APP", dev), token, sessionCookieOptions(dev));

  // Always pass through the render handoff so one key entry logs in both hosts.
  const target = next ?? "/html";
  if (target.startsWith("/auth/render")) return c.redirect(target, 303);
  return c.redirect(`/auth/render?return=${encodeURIComponent(target)}`, 303);
});

app.post("/logout", requireLogin, formLimit, async (c) => {
  if (!(await readForm(c))) return errorPage(c, "csrf");
  await deleteSessionFamily(createDb(c.env.DB), c.get("user")!.familyId);
  deleteCookie(c, sessionCookieName("APP", isDev(c.env)), sessionCookieOptions(isDev(c.env)));
  return c.redirect("/login", 303);
});

// Issues a stateless 60s token and sends the browser to the render host,
// which mints its own session (design.md 3.4). Writes nothing.
app.get("/auth/render", requireLogin, async (c) => {
  const env = c.env;
  let target: string;
  const renderNext = c.req.query("next");
  if (renderNext !== undefined) {
    const path = safeRedirectPath(renderNext, env.RENDER_ORIGIN, ["/"]);
    target = path ? env.RENDER_ORIGIN + path : `${env.APP_ORIGIN}/html`;
  } else {
    target = env.APP_ORIGIN + (safeRedirectPath(c.req.query("return"), env.APP_ORIGIN, ["/html"]) ?? "/html");
  }
  const token = await signHandoff(env.HANDOFF_SECRET, {
    sid: c.get("user")!.sessionId,
    exp: Date.now() + HANDOFF_TTL_MS,
    ret: target,
  });
  return c.redirect(`${env.RENDER_ORIGIN}/__auth?token=${encodeURIComponent(token)}`, 302);
});

// ---------------------------------------------------------------- uploads

// Raw HTML bytes, stored as 1MB chunks without decoding (design.md 4.3).
app.put("/uploads", requireLogin, async (c) => {
  if (!requireEditor(c)) return c.json({ error: "forbidden" }, 403);
  if (!originOk(c) || !csrfOk(c, c.req.header("X-CSRF-Token"))) return c.json({ error: "csrf" }, 403);
  const length = Number(c.req.header("Content-Length") ?? "NaN");
  if (!Number.isFinite(length) || length > MAX_HTML_BYTES) return c.json({ error: "too_large" }, 413);
  if (length === 0 || !c.req.raw.body) return c.json({ error: "empty" }, 422);

  const user = c.get("user")!;
  await deleteOrphanBlobs(c.env.DB, user.keyId);
  try {
    const blob = await storeUpload(c.env.DB, c.req.raw.body, user.keyId);
    return c.json({ uploadId: blob.id, size: blob.size });
  } catch (err) {
    if (err instanceof UploadError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// ---------------------------------------------------------------- list

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

app.get("/html", requireLogin, async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const like = `%${escapeLike(q)}%`;
  const where = `(? = '' OR d.title LIKE ? ESCAPE '\\' OR substr(d.document_key, 1, length(?)) = ?)`;
  const binds = [q, like, q, q];

  const [countRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM html_documents d WHERE ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT d.document_key AS documentKey, d.title, d.description,
              json_array_length(d.links) AS linkCount, d.html_size AS htmlSize,
              k.name AS updatedByName, d.updated_at AS updatedAt
       FROM html_documents d JOIN access_keys k ON k.id = d.updated_by
       WHERE ${where}
       ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<ListRow>(),
  ]);

  const data: ListData = {
    rows: rows.results,
    total: countRow?.n ?? 0,
    page,
    pageSize: PAGE_SIZE,
    q,
    renderOrigin: c.env.RENDER_ORIGIN,
  };
  const user = c.get("user")!;
  if (c.req.header("HX-Request") === "true") {
    return c.html(
      <>
        <ListRegion data={data} user={user} />
        <ListCount data={data} oob />
      </>,
    );
  }
  return c.html(<ListPage data={data} user={user} deleted={c.req.query("deleted") === "1"} />);
});

// ---------------------------------------------------------------- documents

type DocRow = DetailDoc & { id: number; blobId: number; version: number };

async function findDocument(c: Ctx, documentKey: string): Promise<DocRow | null> {
  if (!isDocumentKey(documentKey)) return null;
  const row = await c.env.DB.prepare(
    `SELECT d.id, d.document_key AS documentKey, d.title, d.description, d.links, d.blob_id AS blobId,
            d.html_size AS htmlSize, d.version, d.created_at AS createdAt, d.updated_at AS updatedAt,
            ck.name AS createdByName, uk.name AS updatedByName
     FROM html_documents d
     JOIN access_keys ck ON ck.id = d.created_by
     JOIN access_keys uk ON uk.id = d.updated_by
     WHERE d.document_key = ?`,
  )
    .bind(documentKey)
    .first<Omit<DocRow, "links"> & { links: string }>();
  if (!row) return null;
  return { ...row, links: JSON.parse(row.links) as DocumentLink[] };
}

const emptyValues = (): DocumentFormValues => ({ title: "", description: "", links: [], uploadId: null, version: null });

function renderForm(
  c: Ctx,
  opts: { mode: FormMode; values: DocumentFormValues; errors?: DocumentFormErrors; kept?: KeptUpload; status?: 200 | 409 | 422 },
) {
  return c.html(
    <DocumentFormPage
      user={c.get("user")!}
      mode={opts.mode}
      values={opts.values}
      errors={opts.errors ?? {}}
      kept={opts.kept ?? null}
    />,
    opts.status ?? 200,
  );
}

function editMode(doc: DocRow, conflict = false): FormMode {
  return {
    kind: "edit",
    documentKey: doc.documentKey,
    title: doc.title,
    currentSize: doc.htmlSize,
    updatedByName: doc.updatedByName,
    updatedAt: doc.updatedAt,
    conflict,
  };
}

app.get("/html/new", requireLogin, (c) => {
  if (!requireEditor(c)) return errorPage(c, "forbidden");
  return renderForm(c, { mode: { kind: "create" }, values: emptyValues() });
});

app.post("/html", requireLogin, formLimit, async (c) => {
  if (!requireEditor(c)) return errorPage(c, "forbidden");
  const body = await readForm(c);
  if (!body) return errorPage(c, "csrf");
  const user = c.get("user")!;

  const values = readDocumentForm(body);
  const { errors, links } = validateDocumentForm(values);
  const blob = values.uploadId ? await findAttachableBlob(c.env.DB, values.uploadId, user.keyId) : null;
  if (!values.uploadId) errors.html = "HTML 파일을 올리거나 코드를 붙여넣어 주세요.";
  else if (!blob) errors.html = "올린 HTML을 찾을 수 없습니다. 파일을 다시 올려 주세요.";
  if (hasErrors(errors)) {
    return renderForm(c, { mode: { kind: "create" }, values, errors, kept: blob, status: 422 });
  }

  const now = Date.now();
  const insert = (documentKey: string) =>
    c.env.DB.prepare(
      `INSERT INTO html_documents
         (document_key, title, description, links, blob_id, html_size, version, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
      .bind(documentKey, values.title, values.description || null, JSON.stringify(links), blob!.id, blob!.size,
        user.keyId, user.keyId, now, now)
      .run();

  // One retry on the (practically impossible) key collision (design.md 4.1).
  let documentKey = generateDocumentKey();
  try {
    await insert(documentKey);
  } catch (err) {
    if (!String(err).includes("UNIQUE")) throw err;
    documentKey = generateDocumentKey();
    await insert(documentKey);
  }
  return c.redirect(`/html/${documentKey}?saved=1`, 303);
});

app.get("/html/:key", requireLogin, async (c) => {
  const doc = await findDocument(c, c.req.param("key"));
  if (!doc) return errorPage(c, "notFound");
  return c.html(
    <DetailPage
      doc={doc}
      user={c.get("user")!}
      renderOrigin={c.env.RENDER_ORIGIN}
      saved={c.req.query("saved") === "1"}
      replaced={c.req.query("replaced") === "1"}
    />,
  );
});

// Source is only ever served as text/plain from the admin host (design.md 4.8).
async function sourceResponse(c: Ctx, download: boolean) {
  const doc = await findDocument(c, c.req.param("key") ?? "");
  if (!doc) return errorPage(c, "notFound");
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
  if (download) {
    const name = doc.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100) || doc.documentKey;
    headers["Content-Disposition"] =
      `attachment; filename="${doc.documentKey}.html"; filename*=UTF-8''${encodeURIComponent(name)}.html`;
  }
  return new Response(blobStream(c.env.DB, doc.blobId), { headers });
}

app.get("/html/:key/source", requireLogin, (c) => sourceResponse(c, false));
app.get("/html/:key/download", requireLogin, (c) => sourceResponse(c, true));

app.get("/html/:key/edit", requireLogin, async (c) => {
  if (!requireEditor(c)) return errorPage(c, "forbidden");
  const doc = await findDocument(c, c.req.param("key"));
  if (!doc) return errorPage(c, "notFound");
  return renderForm(c, {
    mode: editMode(doc),
    values: { title: doc.title, description: doc.description ?? "", links: doc.links, uploadId: null, version: doc.version },
  });
});

app.post("/html/:key", requireLogin, formLimit, async (c) => {
  if (!requireEditor(c)) return errorPage(c, "forbidden");
  const body = await readForm(c);
  if (!body) return errorPage(c, "csrf");
  const doc = await findDocument(c, c.req.param("key"));
  if (!doc) return errorPage(c, "notFound");
  const user = c.get("user")!;

  const values = readDocumentForm(body);
  const { errors, links } = validateDocumentForm(values);
  // HTML is replaced only when an upload is attached (design.md 4.8).
  const blob = values.uploadId ? await findAttachableBlob(c.env.DB, values.uploadId, user.keyId) : null;
  if (values.uploadId && !blob) errors.html = "올린 HTML을 찾을 수 없습니다. 파일을 다시 올려 주세요.";
  if (!values.version) values.version = doc.version;
  if (hasErrors(errors)) return renderForm(c, { mode: editMode(doc), values, errors, kept: blob, status: 422 });

  const now = Date.now();
  const updated = await c.env.DB.prepare(
    `UPDATE html_documents
     SET title = ?, description = ?, links = ?, blob_id = COALESCE(?, blob_id), html_size = COALESCE(?, html_size),
         version = version + 1, updated_by = ?, updated_at = ?
     WHERE id = ? AND version = ?
     RETURNING id`,
  )
    .bind(values.title, values.description || null, JSON.stringify(links), blob?.id ?? null, blob?.size ?? null,
      user.keyId, now, doc.id, values.version)
    .first<{ id: number }>();

  if (!updated) {
    // Someone saved first: show their change, keep this user's input and any
    // upload, and arm the form with the latest version (ui.md SCR-05).
    const latest = await findDocument(c, doc.documentKey);
    if (!latest) return errorPage(c, "notFound");
    return renderForm(c, {
      mode: editMode(latest, true),
      values: { ...values, version: latest.version },
      kept: blob,
      status: 409,
    });
  }
  if (blob && blob.id !== doc.blobId) await c.env.DB.batch(deleteBlobStatements(c.env.DB, doc.blobId));
  return c.redirect(`/html/${doc.documentKey}?saved=1${blob ? "&replaced=1" : ""}`, 303);
});

app.post("/html/:key/delete", requireLogin, formLimit, async (c) => {
  if (!requireEditor(c)) return errorPage(c, "forbidden");
  if (!(await readForm(c))) return errorPage(c, "csrf");
  const doc = await findDocument(c, c.req.param("key"));
  if (!doc) return errorPage(c, "notFound");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM html_documents WHERE id = ?").bind(doc.id),
    ...deleteBlobStatements(c.env.DB, doc.blobId),
  ]);
  return c.redirect("/html?deleted=1", 303);
});

app.notFound((c) => errorPage(c, "notFound"));
app.onError((err, c) => {
  console.error(err);
  return errorPage(c, "server");
});

export default app;
