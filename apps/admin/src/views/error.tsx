import type { SessionUser } from "@render-box/auth";
import { Document, TopBar } from "./layout";
import * as ui from "./ui";

export const ERRORS = {
  forbidden: {
    status: 403,
    title: "편집 권한이 필요합니다",
    body: "지금 키로는 문서를 보기만 할 수 있습니다. 등록·수정·삭제가 필요하면 관리자에게 편집 권한을 요청하세요.",
  },
  csrf: {
    status: 403,
    title: "요청을 처리하지 못했습니다",
    body: "페이지를 오래 열어 두었거나 다른 창에서 로그아웃했을 수 있습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
  },
  notFound: {
    status: 404,
    title: "문서를 찾을 수 없습니다",
    body: "삭제되었거나 주소가 잘못되었습니다. 주소를 보낸 사람에게 확인해 주세요.",
  },
  tooLarge: {
    status: 413,
    title: "파일이 너무 큽니다",
    body: "한 번에 올릴 수 있는 HTML은 10MB까지입니다. 이미지가 많이 들어 있다면 이미지 크기를 줄여 다시 만들어 주세요.",
  },
  server: {
    status: 500,
    title: "일시적인 오류가 발생했습니다",
    body: "잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.",
  },
} as const;

export type ErrorKind = keyof typeof ERRORS;

export function ErrorPage({ kind, user }: { kind: ErrorKind; user: SessionUser | null }) {
  const e = ERRORS[kind];
  return (
    <Document title={e.title}>
      {user ? <TopBar user={user} /> : null}
      <main id="main" class="mx-auto max-w-sm px-4 py-16">
        <div class={ui.card}>
          <p class="font-mono text-xs text-fg-subtle">{e.status}</p>
          <h1 class="mt-1 text-xl font-semibold">{e.title}</h1>
          <p class="mt-2 text-fg-muted break-keep">{e.body}</p>
          <a href={user ? "/html" : "/login"} class={`${ui.primary} mt-6`}>
            {user ? "목록으로" : "로그인"}
          </a>
        </div>
      </main>
    </Document>
  );
}
