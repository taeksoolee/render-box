// Warnings about uploaded HTML that will not fully work once rendered. They
// never block a save (D-07, D-31): the uploader decides.
//
// Frame access: rendered HTML runs in an opaque origin (sandbox without
// allow-same-origin), and so does any iframe it creates (srcdoc inherits the
// sandbox). Reading another frame's document then throws "Blocked a frame
// with origin "null" from accessing a cross-origin frame", so overlays and
// links between a page and its iframe stop working (design.md 4.6, 5.3).
// postMessage still works between them.
//
// apps/admin/public/static/js/app.js keeps the same pattern (FRAME_ACCESS);
// warnings.test.ts checks they match.
export const FRAME_ACCESS =
  /\.contentDocument\b|\.contentWindow\s*\.\s*document\b|\b(?:parent|top|opener)\s*\.\s*document\b|\bframes\s*(?:\[[^\]\n]{0,40}\]|\.\s*[A-Za-z_$][\w$]*)\s*\.\s*document\b/g;

export const FRAME_ACCESS_MESSAGE =
  "iframe 안의 문서를 직접 읽는 코드가 있어, iframe과 연결된 부분(화면 위 표시, 클릭하면 이동 등)이 동작하지 않습니다. " +
  "렌더링 화면은 보안상 iframe과 서로 다른 출처로 열립니다. AI에게 \"부모와 iframe 사이 통신을 postMessage로 바꿔 줘\"라고 요청하세요.";

export type HtmlWarning = { code: "frame_access"; message: string; examples: string[] };

// One pass over the text. The pattern starts at the literal ".content…" so it
// stays linear (a leading [\w$]* would rescan every word: ~16ms for 1MB, more
// than a free-plan request's CPU); the identifier before it is added after.
// Examples are the distinct matches, as written.
export function findFrameAccess(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(FRAME_ACCESS)) {
    let start = m.index;
    if (m[0].startsWith(".")) while (start > 0 && /[\w$]/.test(html[start - 1]!)) start--;
    found.add(html.slice(start, m.index + m[0].length).replace(/\s+/g, ""));
  }
  return [...found];
}

export function htmlWarnings(html: string): HtmlWarning[] {
  const frame = findFrameAccess(html);
  return frame.length ? [{ code: "frame_access", message: FRAME_ACCESS_MESSAGE, examples: frame.slice(0, 3) }] : [];
}
