import {
  clientIp,
  createSession,
  editsAny,
  type Membership,
  deleteExpiredSessions,
  deleteSessionFamily,
  findActiveKey,
  HANDOFF_TTL_MS,
  isLoginLocked,
  recordLoginFailure,
  sessionCookieName,
  sessionCookieOptions,
  signHandoff,
} from "@render-box/auth";
import { blobStream, createDb, MAX_HTML_BYTES } from "@render-box/db";
import {
  deleteDocument,
  deleteOrphanBlobs,
  deleteVersions,
  findAttachableBlob,
  findDocument as findDocumentRecord,
  findVersion,
  insertDocument,
  listDocuments,
  listPreviousVersions,
  listVersions,
  projectUsage,
  storageLimits,
  storageUsage,
  storeUpload,
  updateDocument,
  UploadError,
  type DocumentRecord,
} from "@render-box/documents";
import { canonicalOrigin, fetchMetadataGuard, safeRedirectPath } from "@render-box/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isDev, type AppEnv } from "./env";
import { csrfOk, originOk } from "./lib/csrf";
import {
  hasErrors,
  readDocumentForm,
  validateDocumentForm,
  type DocumentFormErrors,
  type DocumentFormValues,
} from "./lib/document-form";
import { pickProject } from "./lib/project";
import { adminSecurityHeaders } from "./lib/security-headers";
import { loadUser, requireLogin } from "./lib/session";
import { DetailPage } from "./views/detail";
import { ERRORS, ErrorPage, type ErrorKind } from "./views/error";
import { DocumentFormPage, type FormMode, type KeptUpload } from "./views/form";
import { ListCount, ListPage, ListRegion, type ListData } from "./views/list";
import { LoginPage } from "./views/login";
import { loadManifest } from "./views/assets";
import { setHelpUrl } from "./views/links";
import { StoragePage } from "./views/storage";

type Ctx = Context<AppEnv>;

const PAGE_SIZE = 20;
const FORM_LIMIT = 64 * 1024;
const LOGIN_NEXT_PREFIXES = ["/html", "/auth/render"];

const app = new Hono<AppEnv>();

app.use("*", adminSecurityHeaders());
app.use("*", async (c, next) => {
  setHelpUrl(c.env.HELP_URL);
  // Hashed static URLs in production only; dev keeps the plain paths.
  if (!isDev(c.env)) await loadManifest(c.env.ASSETS, c.env.APP_ORIGIN);
  await next();
});
app.use("*", canonicalOrigin((env: AppEnv["Bindings"]) => env.APP_ORIGIN));

// DEV_MODE only: records what actually reaches the admin host so isolation
// tests can assert on server-side facts (design.md 10.5). Never enabled in
// production because DEV_MODE is only set in .dev.vars.
type DevRecord = { seq: number; method: string; path: string; site: string | null; dest: string | null; cookie: boolean; status: number };
const devRequests: DevRecord[] = [];
let devSeq = 0;
app.use("*", async (c, next) => {
  await next();
  if (!isDev(c.env) || c.req.path.startsWith("/__dev/")) return;
  devRequests.push({
    seq: ++devSeq,
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
  const key = await findActiveKey(c.env.DB, rawKey);
  if (!key) {
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
  // Not tied to a project yet; attaching it checks the project (design.md 3.9).
  if (!editsAny(c.get("user")!.projects)) return c.json({ error: "forbidden" }, 403);
  if (!originOk(c) || !csrfOk(c, c.req.header("X-CSRF-Token"))) return c.json({ error: "csrf" }, 403);
  const length = Number(c.req.header("Content-Length") ?? "NaN");
  if (!Number.isFinite(length) || length > MAX_HTML_BYTES) return c.json({ error: "too_large" }, 413);
  if (length === 0 || !c.req.raw.body) return c.json({ error: "empty" }, 422);

  const user = c.get("user")!;
  await deleteOrphanBlobs(c.env.DB, user.keyId);
  try {
    const blob = await storeUpload(c.env.DB, c.req.raw.body, user.keyId, {
      limitBytes: storageLimits(c.env).limit,
      declaredSize: length,
    });
    return c.json({ uploadId: blob.id, size: blob.size });
  } catch (err) {
    if (err instanceof UploadError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// ---------------------------------------------------------------- projects

const PROJECT_COOKIE = "rb_project";

// See pickProject for the order; a ?project= choice is remembered.
function currentProject(c: Ctx): Membership | null {
  const { project, fromQuery } = pickProject(c.get("user")!.projects, {
    query: c.req.query("project"),
    cookie: getCookie(c, PROJECT_COOKIE),
    fallback: c.env.DEFAULT_PROJECT,
  });
  if (project && fromQuery) {
    setCookie(c, PROJECT_COOKIE, project.slug, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: !isDev(c.env),
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return project;
}

const membership = (c: Ctx, projectId: number) =>
  c.get("user")!.projects.find((p) => p.projectId === projectId) ?? null;

const projectQuery = (p: Membership) => `project=${encodeURIComponent(p.slug)}`;

// ---------------------------------------------------------------- list

app.get("/html", requireLogin, async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const project = currentProject(c);
  // Search and paging swap only the list; boosted navigation and history
  // restores (hx-boost) can send HX-Request too but need the whole page.
  const htmx =
    c.req.header("HX-Request") === "true" &&
    c.req.header("HX-Boosted") !== "true" &&
    c.req.header("HX-History-Restore-Request") !== "true";
  // The list and the storage summary in parallel; HTMX swaps need only the list.
  const [{ rows, total }, storage] = await Promise.all([
    listDocuments(c.env.DB, { q, page, pageSize: PAGE_SIZE, projectIds: project ? [project.projectId] : [] }),
    htmx ? null : storageUsage(c.env.DB, storageLimits(c.env)),
  ]);

  const data: ListData = {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    q,
    renderOrigin: c.env.RENDER_ORIGIN,
    project,
  };
  const user = c.get("user")!;
  if (!storage) {
    return c.html(
      <>
        <ListRegion data={data} user={user} />
        <ListCount data={data} oob />
      </>,
    );
  }
  return c.html(<ListPage data={data} user={user} storage={storage} deleted={c.req.query("deleted") === "1"} />);
});

// ---------------------------------------------------------------- documents

type DocRow = DocumentRecord;

// A document the viewer may see, with their membership in its project.
// Documents of other projects look exactly like missing ones (design.md 3.9).
async function findDocument(c: Ctx, documentKey: string): Promise<{ doc: DocRow; project: Membership } | null> {
  const doc = await findDocumentRecord(c.env.DB, documentKey);
  const project = doc ? membership(c, doc.projectId) : null;
  return doc && project ? { doc, project } : null;
}

const emptyValues = (): DocumentFormValues => ({ title: "", description: "", links: [], uploadId: null, version: null });

function renderForm(
  c: Ctx,
  opts: {
    project: Membership;
    mode: FormMode;
    values: DocumentFormValues;
    errors?: DocumentFormErrors;
    kept?: KeptUpload;
    status?: 200 | 409 | 422;
  },
) {
  return c.html(
    <DocumentFormPage
      user={c.get("user")!}
      project={opts.project}
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
  const project = currentProject(c);
  if (project?.role !== "EDITOR") return errorPage(c, "forbidden");
  return renderForm(c, { project, mode: { kind: "create" }, values: emptyValues() });
});

app.post("/html", requireLogin, formLimit, async (c) => {
  const body = await readForm(c);
  if (!body) return errorPage(c, "csrf");
  const user = c.get("user")!;
  // The project comes from the form, not the cookie: the page may be stale.
  const project = user.projects.find((p) => p.slug === body["project"]);
  if (project?.role !== "EDITOR") return errorPage(c, "forbidden");

  const values = readDocumentForm(body);
  const { errors, links } = validateDocumentForm(values);
  const blob = values.uploadId ? await findAttachableBlob(c.env.DB, values.uploadId, user.keyId) : null;
  if (!values.uploadId) errors.html = "HTML 파일을 올리거나 코드를 붙여넣어 주세요.";
  else if (!blob) errors.html = "올린 HTML을 찾을 수 없습니다. 파일을 다시 올려 주세요.";
  if (hasErrors(errors)) {
    return renderForm(c, { project, mode: { kind: "create" }, values, errors, kept: blob, status: 422 });
  }

  const documentKey = await insertDocument(c.env.DB, {
    title: values.title,
    description: values.description,
    links,
    blob: blob!,
    projectId: project.projectId,
    keyId: user.keyId,
  });
  return c.redirect(`/html/${documentKey}?saved=1`, 303);
});

app.get("/html/:key", requireLogin, async (c) => {
  const found = await findDocument(c, c.req.param("key"));
  if (!found) return errorPage(c, "notFound");
  const { doc, project } = found;
  const notice = c.req.query("notice");
  return c.html(
    <DetailPage
      doc={doc}
      versions={await listVersions(c.env.DB, doc.id)}
      user={c.get("user")!}
      project={project}
      renderOrigin={c.env.RENDER_ORIGIN}
      saved={c.req.query("saved") === "1"}
      replaced={c.req.query("replaced") === "1"}
      notice={notice === "restored" || notice === "version-deleted" || notice === "conflict" ? notice : null}
    />,
  );
});

// "3" → 3; anything else is not a version number.
const parseSeq = (s: string | undefined) => (s && /^[1-9][0-9]{0,8}$/.test(s) ? Number(s) : null);

// Source is only ever served as text/plain from the admin host (design.md 4.8).
// With a version number, serves that version's HTML (design.md 4.9).
async function sourceResponse(c: Ctx, download: boolean, versioned: boolean) {
  const found = await findDocument(c, c.req.param("key") ?? "");
  if (!found) return errorPage(c, "notFound");
  const { doc } = found;
  let blobId = doc.blobId;
  let suffix = "";
  if (versioned) {
    const seq = parseSeq(c.req.param("seq"));
    const version = seq ? await findVersion(c.env.DB, doc.id, seq) : null;
    if (!version) return errorPage(c, "notFound");
    blobId = version.blobId;
    suffix = `-v${version.seq}`;
  }
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
  if (download) {
    const name = doc.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100) || doc.documentKey;
    headers["Content-Disposition"] =
      `attachment; filename="${doc.documentKey}${suffix}.html"; filename*=UTF-8''${encodeURIComponent(name + suffix)}.html`;
  }
  return new Response(blobStream(c.env.DB, blobId), { headers });
}

app.get("/html/:key/source", requireLogin, (c) => sourceResponse(c, false, false));
app.get("/html/:key/download", requireLogin, (c) => sourceResponse(c, true, false));
app.get("/html/:key/v/:seq/source", requireLogin, (c) => sourceResponse(c, false, true));
app.get("/html/:key/v/:seq/download", requireLogin, (c) => sourceResponse(c, true, true));

app.get("/html/:key/edit", requireLogin, async (c) => {
  const found = await findDocument(c, c.req.param("key"));
  if (!found) return errorPage(c, "notFound");
  const { doc, project } = found;
  if (project.role !== "EDITOR") return errorPage(c, "forbidden");
  return renderForm(c, {
    project,
    mode: editMode(doc),
    values: { title: doc.title, description: doc.description ?? "", links: doc.links, uploadId: null, version: doc.version },
  });
});

app.post("/html/:key", requireLogin, formLimit, async (c) => {
  const body = await readForm(c);
  if (!body) return errorPage(c, "csrf");
  const found = await findDocument(c, c.req.param("key"));
  if (!found) return errorPage(c, "notFound");
  const { doc, project } = found;
  if (project.role !== "EDITOR") return errorPage(c, "forbidden");
  const user = c.get("user")!;

  const values = readDocumentForm(body);
  const { errors, links } = validateDocumentForm(values);
  // HTML is replaced only when an upload is attached (design.md 4.8).
  const blob = values.uploadId ? await findAttachableBlob(c.env.DB, values.uploadId, user.keyId) : null;
  if (values.uploadId && !blob) errors.html = "올린 HTML을 찾을 수 없습니다. 파일을 다시 올려 주세요.";
  if (!values.version) values.version = doc.version;
  if (hasErrors(errors)) return renderForm(c, { project, mode: editMode(doc), values, errors, kept: blob, status: 422 });

  const updated = await updateDocument(c.env.DB, {
    id: doc.id,
    version: values.version,
    title: values.title,
    description: values.description,
    links,
    blob,
    keyId: user.keyId,
  });

  if (!updated) {
    // Someone saved first: show their change, keep this user's input and any
    // upload, and arm the form with the latest version (ui.md SCR-05).
    const latest = await findDocument(c, doc.documentKey);
    if (!latest) return errorPage(c, "notFound");
    return renderForm(c, {
      project,
      mode: editMode(latest.doc, true),
      values: { ...values, version: latest.doc.version },
      kept: blob,
      status: 409,
    });
  }
  return c.redirect(`/html/${doc.documentKey}?saved=1${blob ? "&replaced=1" : ""}`, 303);
});

app.post("/html/:key/delete", requireLogin, formLimit, async (c) => {
  if (!(await readForm(c))) return errorPage(c, "csrf");
  const found = await findDocument(c, c.req.param("key"));
  if (!found) return errorPage(c, "notFound");
  if (found.project.role !== "EDITOR") return errorPage(c, "forbidden");
  await deleteDocument(c.env.DB, found.doc.id);
  return c.redirect(`/html?${projectQuery(found.project)}&deleted=1`, 303);
});

// ---------------------------------------------------------------- versions

// The document (must be editable) and one of its versions, or an error page.
async function editableVersion(c: Ctx) {
  const found = await findDocument(c, c.req.param("key") ?? "");
  const seq = parseSeq(c.req.param("seq"));
  const version = found && seq ? await findVersion(c.env.DB, found.doc.id, seq) : null;
  if (!found || !version) return errorPage(c, "notFound");
  if (found.project.role !== "EDITOR") return errorPage(c, "forbidden");
  return { ...found, version };
}

// A new version pointing at the chosen version's blob; no bytes are copied, so
// this works even when storage is full (design.md 4.9).
app.post("/html/:key/v/:seq/restore", requireLogin, formLimit, async (c) => {
  const body = await readForm(c);
  if (!body) return errorPage(c, "csrf");
  const found = await editableVersion(c);
  if (found instanceof Response) return found;
  const { doc, version } = found;
  if (version.blobId === doc.blobId) return c.redirect(`/html/${doc.documentKey}#versions`, 303);
  const expected = Number(body["version"]);
  const updated = await updateDocument(c.env.DB, {
    id: doc.id,
    version: Number.isSafeInteger(expected) && expected > 0 ? expected : doc.version,
    title: doc.title,
    description: doc.description ?? "",
    links: doc.links,
    blob: { id: version.blobId, size: version.htmlSize },
    restoredFrom: version.seq,
    keyId: c.get("user")!.keyId,
  });
  return c.redirect(`/html/${doc.documentKey}?notice=${updated ? "restored" : "conflict"}#versions`, 303);
});

app.post("/html/:key/v/:seq/delete", requireLogin, formLimit, async (c) => {
  if (!(await readForm(c))) return errorPage(c, "csrf");
  const found = await editableVersion(c);
  if (found instanceof Response) return found;
  // deleteVersions refuses the current version, so a stale page cannot remove it.
  const deleted = await deleteVersions(c.env.DB, [found.version.id], [found.doc.projectId]);
  if (deleted === 0) return errorPage(c, "currentVersion");
  return c.redirect(`/html/${found.doc.documentKey}?notice=version-deleted#versions`, 303);
});

// ---------------------------------------------------------------- storage

app.get("/storage", requireLogin, async (c) => {
  const user = c.get("user")!;
  const ids = user.projects.map((p) => p.projectId);
  const [usage, versions, used] = await Promise.all([
    storageUsage(c.env.DB, storageLimits(c.env)),
    listPreviousVersions(c.env.DB, ids),
    projectUsage(c.env.DB, ids),
  ]);
  const deleted = Number.parseInt(c.req.query("deleted") ?? "", 10);
  return c.html(
    <StoragePage
      user={user}
      project={currentProject(c)}
      usage={usage}
      byProject={user.projects.map((p) => ({ project: p, used: used.get(p.projectId) ?? 0 }))}
      versions={versions}
      deleted={Number.isSafeInteger(deleted) && deleted >= 0 ? deleted : null}
    />,
  );
});

// Only versions of projects this key edits; deleteVersions checks it in SQL.
app.post("/storage/delete", requireLogin, formLimit, async (c) => {
  const body = await readForm(c);
  if (!body) return errorPage(c, "csrf");
  const editable = c.get("user")!.projects.filter((p) => p.role === "EDITOR").map((p) => p.projectId);
  if (editable.length === 0) return errorPage(c, "forbidden");
  const raw = body["version_id"];
  const ids = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => Number(v));
  const deleted = await deleteVersions(c.env.DB, ids, editable);
  return c.redirect(`/storage?deleted=${deleted}`, 303);
});

app.notFound((c) => errorPage(c, "notFound"));
app.onError((err, c) => {
  console.error(err);
  return errorPage(c, "server");
});

export default app;
