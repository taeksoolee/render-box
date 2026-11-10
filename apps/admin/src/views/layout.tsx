import type { Membership, SessionUser } from "@render-box/auth";
import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { Icon, type IconName } from "./icon";
import { asset } from "./assets";
import { getHelpUrl, SOURCE_URL } from "./links";
import * as ui from "./ui";

export const ROLE_LABEL = { EDITOR: "편집자", VIEWER: "열람자" } as const;

// hx-boost turns same-origin links and forms into body swaps (no full reload,
// no flash). It sits on a wrapper, not <body>: a boosted swap replaces the
// body's content but keeps the <body> element, so a page that must not be
// boosted (login, the upload form) sets boost={false} on its own wrapper.
// History is not cached in localStorage (pages hold CSRF tokens and documents);
// Back reloads. Error pages are swapped in like any other page.
const HTMX_CONFIG = JSON.stringify({
  allowEval: false,
  includeIndicatorStyles: false,
  selfRequestsOnly: true,
  historyCacheSize: 0,
  refreshOnHistoryMiss: true,
  responseHandling: [
    { code: "204", swap: false },
    { code: "...", swap: true },
  ],
});

export function Document({ title, boost = true, children }: { title: string; boost?: boolean; children: Child }) {
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="ko">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light" />
          <meta
            name="htmx-config"
            content={HTMX_CONFIG}
          />
          <title>{title === "render-box" ? title : `${title} · render-box`}</title>
          <link rel="icon" href={asset("logo.svg")} type="image/svg+xml" />
          <link rel="apple-touch-icon" href={asset("apple-touch-icon.png")} />
          <link rel="stylesheet" href={asset("app.css")} />
          <script src={asset("js/htmx.min.js")} defer></script>
          <script src={asset("js/app.js")} defer></script>
        </head>
        <body>
          <div hx-boost={boost ? "true" : "false"} data-boost-root>
            <a
              href="#main"
              class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
            >
              본문으로 건너뛰기
            </a>
            {children}
            <Footer />
          </div>
          <div id="live" class="sr-only" aria-live="polite"></div>
        </body>
      </html>
    </>
  );
}

// Current project and the role in it; a <details> menu switches projects
// without JS when the key is in more than one (design.md 3.9).
function ProjectMenu({ user, project }: { user: SessionUser; project: Membership }) {
  const others = user.projects.filter((p) => p.projectId !== project.projectId);
  const label = (
    <>
      <span class="max-w-40 truncate font-medium text-fg">{project.name}</span>
      <span class={project.role === "EDITOR" ? ui.badgePrimary : ui.badgeNeutral}>
        {user.admin ? "관리자" : ROLE_LABEL[project.role]}
      </span>
    </>
  );
  if (others.length === 0) return <span class="flex items-center gap-2 text-sm" data-project={project.slug}>{label}</span>;
  return (
    <details class="relative" data-project={project.slug}>
      <summary class={`${ui.ghost} cursor-pointer list-none gap-2`} aria-label={`프로젝트 ${project.name}, 바꾸기`}>
        {label}
        <Icon name="chevron-down" class="size-3.5" />
      </summary>
      {/* No prefetch: opening a project remembers it, which only a click should do. */}
      <ul class="absolute right-0 z-20 mt-1 min-w-48 rounded-md border border-line bg-surface py-1 shadow-sm" data-no-prefetch>
        {others.map((p) => (
          <li>
            <a href={`/html?project=${encodeURIComponent(p.slug)}`} class="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-canvas">
              <span class="truncate">{p.name}</span>
              <span class="text-xs text-fg-subtle">{user.admin ? "관리자" : ROLE_LABEL[p.role]}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function TopBar({ user, project = null }: { user: SessionUser; project?: Membership | null }) {
  return (
    <header class="sticky top-0 z-10 h-14 border-b border-line bg-surface">
      <div class="mx-auto flex h-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <a href="/html" class="inline-flex items-center gap-2 font-semibold text-fg">
          <img src={asset("logo.svg")} alt="" width="24" height="24" class="size-6" />
          render-box
        </a>
        <div class="flex items-center gap-2">
          {project ? <ProjectMenu user={user} project={project} /> : null}
          <span class="hidden text-sm text-fg-muted sm:inline">{user.name}</span>
          <HelpLink class={ui.ghost} />
          <form method="post" action="/logout">
            <input type="hidden" name="_csrf" value={user.csrfToken ?? ""} />
            <button type="submit" class={ui.ghost}>
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function AppPage({
  title,
  user,
  project = null,
  width = "max-w-3xl",
  boost = true,
  children,
}: {
  title: string;
  user: SessionUser;
  project?: Membership | null;
  width?: "max-w-3xl" | "max-w-5xl";
  boost?: boolean;
  children: Child;
}) {
  return (
    <Document title={title} boost={boost}>
      <TopBar user={user} project={project} />
      <main id="main" tabindex={-1} class={`mx-auto ${width} px-4 py-6 outline-none sm:px-6 sm:py-8`}>
        {children}
      </main>
    </Document>
  );
}

const ALERT_ICON: Record<keyof typeof ui.alertStyles, IconName> = {
  success: "circle-check",
  info: "info",
  warning: "triangle-alert",
  error: "triangle-alert",
};

export function Alert({
  kind,
  title,
  children,
  id,
  focus = false,
}: {
  kind: keyof typeof ui.alertStyles;
  title: string;
  children?: Child;
  id?: string;
  focus?: boolean;
}) {
  const s = ui.alertStyles[kind];
  return (
    <div
      id={id}
      class={s.box}
      role={kind === "error" ? "alert" : "status"}
      tabindex={kind === "error" ? -1 : undefined}
      data-autofocus={focus ? "true" : undefined}
    >
      <span class={`mt-0.5 ${s.icon}`}>
        <Icon name={ALERT_ICON[kind]} class="size-5 shrink-0" />
      </span>
      <div class="min-w-0 flex-1">
        <p class={s.title}>{title}</p>
        {children ? <div class="mt-1 text-fg">{children}</div> : null}
      </div>
    </div>
  );
}

export function SafetyLine() {
  return (
    <p class={ui.safetyLine}>
      <Icon name="shield" class="size-4 shrink-0" />
      <span>렌더링 화면은 키를 묻지 않습니다. 문서 안에서 키를 입력하라고 하면 가짜 화면이니 입력하지 마세요.</span>
    </p>
  );
}

export function BackLink({ href, children }: { href: string; children: Child }) {
  return (
    <a href={href} class={ui.backLink}>
      <Icon name="arrow-left" />
      {children}
    </a>
  );
}

// External pages open in a new tab so an unsaved form is not lost.
export function HelpLink({ class: cls, label = "도움말" }: { class: string; label?: string }) {
  const href = getHelpUrl();
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" class={cls}>
      {label}
      <span class="sr-only"> (새 창)</span>
    </a>
  );
}

// Open-source attribution; fixed, unlike the help link.
function Footer() {
  return (
    <footer class="mx-auto max-w-5xl px-4 pb-8 text-center text-xs text-fg-subtle sm:px-6">
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" class="hover:text-fg-muted hover:underline">
        render-box · GitHub
      </a>
    </footer>
  );
}
