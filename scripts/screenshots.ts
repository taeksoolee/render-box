// Regenerates docs/screenshots/*.png for the README and the guide from a
// local instance with sample documents. Needs `pnpm dev` running, an editor
// key, and a viewer key for the memos (another person's name on them):
//
//   RB_EDITOR_KEY=rb_... RB_VIEWER_KEY=rb_... pnpm screenshots
//
// It adds sample documents to the local D1; run it on a fresh local state.
import { chromium } from "@playwright/test";

const APP = "http://app.localhost:8787";
const API = "http://api.localhost:8789/api/v1";
const OUT = new URL("../docs/screenshots/", import.meta.url);
const key = process.env.RB_EDITOR_KEY ?? "";
const viewerKey = process.env.RB_VIEWER_KEY ?? "";
if (!key || !viewerKey) throw new Error("RB_EDITOR_KEY and RB_VIEWER_KEY must be set");
const auth = { Authorization: `Bearer ${key}` };

async function memo(documentKey: string, body: string, as = viewerKey) {
  const res = await fetch(`${API}/html/${documentKey}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${as}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`memo: ${res.status}`);
}

const page = (title: string, body: string) =>
  `<!DOCTYPE html><html lang="ko"><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui">${body}</body></html>`;

async function upload(title: string, html: string, query: Record<string, string | string[]> = {}) {
  const url = new URL(`${API}/html`);
  url.searchParams.set("title", title);
  for (const [k, v] of Object.entries(query)) for (const item of [v].flat()) url.searchParams.append(k, item);
  const res = await fetch(url, { method: "POST", headers: { ...auth, "Content-Type": "text/html" }, body: html });
  if (!res.ok) throw new Error(`${title}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { document_key: string }).document_key;
}

async function replace(documentKey: string, html: string) {
  const res = await fetch(`${API}/html/${documentKey}/source`, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "text/html" },
    body: html,
  });
  if (!res.ok) throw new Error(`replace: ${res.status}`);
}

await upload("관리자 대시보드 초안", page("대시보드", "<h1>대시보드</h1>".repeat(400)));
await upload("온보딩 튜토리얼 (모바일)", page("온보딩", "<p>1/3</p>".repeat(900)), {
  description: "첫 실행 시 보여 줄 3단계 안내. 모바일 화면 기준입니다.",
});
await upload("결제 화면 시안 B", page("결제", "<button>결제하기</button>".repeat(1500)), {
  link: ["Figma|https://www.figma.com/"],
});
const signup = await upload("회원가입 플로우 v3", page("회원가입", "<form>v1</form>".repeat(2000)), {
  description: "이메일 인증 단계를 약관 동의 앞으로 옮긴 버전입니다.\n버튼 문구는 아직 확정 전입니다.",
  link: ["기획서|https://www.notion.so/", "https://www.figma.com/", "Jira 티켓|https://example.atlassian.net/browse/SIGN-42"],
});
await replace(signup, page("회원가입", "<form>v2</form>".repeat(2600)));
await memo(signup, "인증 메일을 기다리는 동안 보여 줄 화면이 없어요.\n'메일을 보냈습니다' 안내가 있으면 좋겠습니다.");
await replace(signup, page("회원가입", "<form>v3</form>".repeat(2400)));
await memo(signup, "v3에 안내 화면 넣었습니다. 문구 확인 부탁드려요.", key);
await memo(signup, "확인했습니다. '다음' 버튼만 '인증 메일 받기'로 바꾸면 될 것 같아요.");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2, locale: "ko-KR" });
const tab = await context.newPage();
await tab.goto(`${APP}/login`);
await tab.getByLabel("접근 키").fill(key);
await tab.getByRole("button", { name: "로그인" }).click();
await tab.waitForURL(`${APP}/html`);

await tab.screenshot({ path: new URL("list.png", OUT).pathname });
await tab.goto(`${APP}/html/${signup}`);
await tab.screenshot({ path: new URL("detail.png", OUT).pathname, fullPage: true });
await tab.locator("#comments").screenshot({ path: new URL("memo.png", OUT).pathname });
await tab.goto(`${APP}/html/new`);
await tab.screenshot({ path: new URL("new.png", OUT).pathname });

await browser.close();
console.log(`wrote ${new URL(".", OUT).pathname}{list,detail,memo,new}.png`);
