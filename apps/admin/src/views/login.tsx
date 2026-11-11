import { Alert, Document, HelpLink } from "./layout";
import { asset } from "./assets";
import { Icon } from "./icon";
import * as ui from "./ui";

export function LoginPage({ next, error }: { next: string | null; error?: string }) {
  const showDocHint = next?.startsWith("/auth/render") ?? false;
  return (
    // Not boosted: login redirects through the render host (another origin).
    <Document title="로그인" boost={false}>
      <main id="main" class="grid min-h-dvh place-items-center px-4 py-8">
        <div class={`${ui.card} w-full max-w-sm`}>
          <img src={asset("logo.svg")} alt="" width="48" height="48" class="mx-auto size-12" />
          <h1 class="mt-3 text-center text-2xl font-semibold">render-box</h1>
          <p class="mt-1 text-center text-fg-muted">HTML 파일을 주소 하나로 공유하는 곳</p>

          {showDocHint ? (
            <div class="mt-6">
              <Alert kind="info" title="문서를 보려면 먼저 로그인하세요.">
                로그인하면 바로 문서가 열립니다.
              </Alert>
            </div>
          ) : null}

          <form method="post" action="/login" class="mt-6" data-submit-once>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            {/* Lets password managers save one entry per key. */}
            <input
              type="text"
              name="username"
              value="render-box"
              autocomplete="username"
              tabindex={-1}
              class="sr-only"
              aria-hidden="true"
              readonly
            />
            <label for="key" class={ui.label}>
              접근 키
            </label>
            <input
              id="key"
              name="key"
              type="password"
              autocomplete="current-password"
              autofocus
              required
              aria-required="true"
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "key-error" : undefined}
              class={ui.input}
            />
            {error ? (
              <p id="key-error" class={ui.fieldErr}>
                <Icon name="triangle-alert" class="mt-px size-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}
            <button type="submit" class={`${ui.primary} mt-4 w-full`} data-busy-label="키 확인 중…">
              로그인
            </button>
          </form>

          <p class="mt-3 text-xs text-fg-subtle">
            키는 관리자에게 받으세요. 한 번 로그인하면 30일 동안 유지됩니다.{" "}
            <HelpLink class="text-primary hover:underline" label="사용 안내" />
          </p>
          <hr class="my-4 border-line" />
          <p class={ui.safetyLine}>
            <Icon name="shield" class="size-4 shrink-0" />
            <span>렌더링 화면은 키를 묻지 않습니다. 문서 안에서 키를 입력하라고 하면 가짜 화면이니 입력하지 마세요.</span>
          </p>
        </div>
      </main>
    </Document>
  );
}
