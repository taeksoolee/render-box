// The render host's own pages (not found, server error): small, centered,
// self-contained HTML in the admin's colors (light only, like the admin).
// The CSP allows inline styles only, and the page runs in the same sandbox as
// documents, so there is no script here.
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function messagePage({ status, title, body, href }: { status: number; title: string; body: string; href: string }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} · render-box</title>
<style>
:root { --bg: #F9FAFB; --card: #FFFFFF; --line: #E5E7EB; --fg: #111827; --muted: #4B5563; --subtle: #6B7280; --primary: #2563EB; --primary-hover: #1D4ED8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 32px 16px; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; }
main { width: 100%; max-width: 24rem; padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); text-align: center; }
.status { margin: 0; font: 12px ui-monospace, monospace; color: var(--subtle); }
h1 { margin: 4px 0 0; font-size: 20px; font-weight: 600; }
p.body { margin: 8px 0 0; color: var(--muted); word-break: keep-all; }
a { display: inline-block; margin-top: 24px; padding: 8px 16px; border-radius: 8px; background: var(--primary); color: #fff; text-decoration: none; font-weight: 500; }
a:hover { background: var(--primary-hover); }
</style>
</head>
<body>
<main>
<p class="status">${status}</p>
<h1>${escape(title)}</h1>
<p class="body">${escape(body)}</p>
<a href="${escape(href)}">render-box 목록으로</a>
</main>
</body>
</html>`;
}
