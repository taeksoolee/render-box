import { expect, test } from "@playwright/test";
import { APP, createDocument, login, RENDER } from "./helpers";

// design.md 10.5: requests a rendered document sends to the admin host must
// arrive as cross-site and be rejected, whether or not cookies were attached.
const ATTACK = `<!DOCTYPE html><html><head></head><body>
<img src="${APP}/html">
<script src="${APP}/html"></script>
<form id="f" action="${APP}/html/xxx/delete" method="POST"><button>x</button></form>
<script>
  var out = {};
  try { document.cookie; out.cookie = "readable"; } catch (e) { out.cookie = "blocked"; }
  out.opener = window.opener === null ? "null" : "present";
  fetch("${APP}/html", { credentials: "include" })
    .then(function (r) { return r.text(); })
    .then(function () { out.fetch = "read"; }, function () { out.fetch = "failed"; })
    .then(function () {
      try { navigator.sendBeacon("${APP}/html"); } catch (e) {}
      document.body.dataset.result = JSON.stringify(out);
    });
</script></body></html>`;

test("rendered HTML cannot reach the admin host", async ({ page, context }) => {
  await login(page, "EDITOR");
  const documentKey = await createDocument(page, "격리 테스트", ATTACK);

  type Seen = { method: string; path: string; site: string | null; dest: string | null; cookie: boolean; status: number };
  const seen = async () => (await (await context.request.get(`${APP}/__dev/requests`)).json()) as Seen[];
  const before = (await seen()).length;
  const adminPosts: string[] = [];
  context.on("request", (req) => {
    if (req.url().startsWith(`${APP}/html/xxx/delete`)) {
      adminPosts.push(req.url());
    }
  });


  const [render] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "새 창에서 보기" }).click(),
  ]);
  await expect(render).toHaveURL(`${RENDER}/${documentKey}`);
  const res = await context.request.get(`${RENDER}/${documentKey}`);
  expect(res.headers()["content-security-policy"]).toContain("sandbox allow-scripts allow-forms allow-modals;");
  expect(res.headers()["content-security-policy"]).not.toContain("allow-same-origin");

  await expect(render.locator("body")).toHaveAttribute("data-result", /.+/);
  const result = JSON.parse((await render.locator("body").getAttribute("data-result"))!);
  expect(result).toEqual({ cookie: "blocked", opener: "null", fetch: "failed" });

  // Form submission is blocked by form-action 'none': nothing is sent.
  await render.locator("#f button").click({ noWaitAfter: true });
  await render.waitForTimeout(1000);
  expect(adminPosts).toEqual([]);

  // Server-side view of what the rendered page sent to the admin host.
  let fromRender: Seen[] = [];
  await expect
    .poll(async () => {
      // Top-level GET navigations are allowed by design (messenger links,
      // handoff returns); everything else from another site must be refused.
      fromRender = (await seen())
        .slice(before)
        .filter((r) => r.site === "cross-site" && !(r.dest === "document" && r.method === "GET"));
      return fromRender.length;
    }, { timeout: 5000 })
    .toBeGreaterThanOrEqual(4); // img, script, fetch, beacon
  for (const r of fromRender) {
    expect(r.status, `${r.method} ${r.path} (${r.dest})`).toBe(403);
    expect(r.path).not.toContain("/delete");
  }
});

// A <meta> CSP can only add restrictions on top of the header policy
// (design.md 5.3): "default-src *" must not re-enable anything, and because
// policies intersect it even blocks the page's own inline script.
test("meta CSP in the document cannot loosen the server policy", async ({ page, context }) => {
  await login(page, "EDITOR");
  const documentKey = await createDocument(
    page,
    "meta CSP",
    '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>' +
      "<body><script>document.body.dataset.ran = 'yes'</script></body></html>",
  );
  const render = await context.newPage();
  await render.goto(`${RENDER}/${documentKey}`);
  await expect(render.locator("body")).not.toHaveAttribute("data-ran", "yes");
});
