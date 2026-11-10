import type { SessionUser } from "@render-box/auth";
import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { Icon, type IconName } from "./icon";
import { getHelpUrl, SOURCE_URL } from "./links";
import * as ui from "./ui";

export const ROLE_LABEL = { EDITOR: "편집자", VIEWER: "열람자" } as const;

export function Document({ title, children }: { title: string; children: Child }) {
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
            content='{"allowEval":false,"includeIndicatorStyles":false,"selfRequestsOnly":true}'
          />
          <title>{title === "render-box" ? title : `${title} · render-box`}</title>
          <link rel="stylesheet" href="/static/app.css" />
          <script src="/static/js/htmx.min.js" defer></script>
          <script src="/static/js/app.js" defer></script>
        </head>
        <body>
          <a
            href="#main"
            class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
          >
            본문으로 건너뛰기
          </a>
          {children}
          <Footer />
          <div id="live" class="sr-only" aria-live="polite"></div>
        </body>
      </html>
    </>
  );
}

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header class="sticky top-0 z-10 h-14 border-b border-line bg-surface">
      <div class="mx-auto flex h-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <a href="/html" class="font-semibold text-fg">
          render-box
        </a>
        <div class="flex items-center gap-2">
          <span class="hidden text-sm text-fg-muted sm:inline">{user.name}</span>
          <span class={user.role === "EDITOR" ? ui.badgePrimary : ui.badgeNeutral}>{ROLE_LABEL[user.role]}</span>
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
  width = "max-w-3xl",
  children,
}: {
  title: string;
  user: SessionUser;
  width?: "max-w-3xl" | "max-w-5xl";
  children: Child;
}) {
  return (
    <Document title={title}>
      <TopBar user={user} />
      <main id="main" class={`mx-auto ${width} px-4 py-6 sm:px-6 sm:py-8`}>
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
