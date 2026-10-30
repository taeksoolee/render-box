import type { SessionUser } from "@render-box/auth";
import type { DocumentLink } from "@render-box/db";
import { formatFullDate, formatSize, linkDisplayName } from "../lib/format";
import { Alert, AppPage, BackLink } from "./layout";
import { Icon } from "./icon";
import * as ui from "./ui";

export type DetailDoc = {
  documentKey: string;
  title: string;
  description: string | null;
  links: DocumentLink[];
  htmlSize: number;
  createdByName: string;
  createdAt: number;
  updatedByName: string;
  updatedAt: number;
};

export function CopyButton({ value, cls, label }: { value: string; cls: string; label: string }) {
  return (
    <button type="button" class={`group ${cls}`} data-copy={value} data-copy-target="render-url">
      <span class="inline-flex items-center gap-1.5 group-data-[copied=true]:hidden">
        <Icon name="copy" />
        {label}
      </span>
      <span class="hidden items-center gap-1.5 group-data-[copied=true]:inline-flex">
        <Icon name="check" />
        복사했습니다
      </span>
    </button>
  );
}

function CopyFallback() {
  return (
    <p class="mt-1.5 text-xs text-fg-muted" data-copy-fallback hidden>
      자동 복사가 안 됩니다. 주소를 선택해 두었으니 Ctrl+C(Mac은 ⌘C)를 눌러 복사하세요.
    </p>
  );
}

export function DetailPage({
  doc,
  user,
  renderOrigin,
  saved,
  replaced,
}: {
  doc: DetailDoc;
  user: SessionUser;
  renderOrigin: string;
  saved: boolean;
  replaced: boolean;
}) {
  const url = `${renderOrigin}/${doc.documentKey}`;
  const editor = user.role === "EDITOR";
  return (
    <AppPage title={doc.title} user={user}>
      <div class="space-y-8">
        <div class="space-y-4">
          <BackLink href="/html">목록</BackLink>
          {saved ? (
            <Alert kind="success" title="저장했습니다">
              <p>
                {replaced
                  ? "주소는 그대로이니 이미 공유한 링크로 최신 내용을 볼 수 있습니다."
                  : "아래 주소를 복사해 메신저로 공유하세요."}
              </p>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  readonly
                  value={url}
                  aria-label="렌더링 URL"
                  data-copy-source="render-url"
                  class={`${ui.input} bg-canvas font-mono text-xs`}
                />
                <CopyButton value={url} cls={`${ui.primary} w-full sm:w-auto`} label="렌더링 URL 복사" />
              </div>
              <CopyFallback />
            </Alert>
          ) : null}
        </div>

        <section class="space-y-3">
          <h1 class="text-xl font-semibold break-keep">{doc.title}</h1>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a
              href={url}
              target="_blank"
              rel="noopener"
              class={`${saved ? ui.secondary : ui.primary} w-full sm:w-auto`}
            >
              <Icon name="external-link" />
              새 창에서 보기
            </a>
            <CopyButton value={url} cls={`${ui.secondary} w-full sm:w-auto`} label="렌더링 URL 복사" />
            {editor ? (
              <div class="hidden gap-2 sm:ml-auto sm:flex">
                <a href={`/html/${doc.documentKey}/edit`} class={ui.secondary}>
                  수정
                </a>
                <DeleteForm doc={doc} user={user} />
              </div>
            ) : null}
          </div>
          <p class="text-xs text-fg-subtle">
            렌더링 URL <span class="font-mono break-all text-fg-muted">{url}</span>
          </p>
          {saved ? null : (
            <input type="text" readonly value={url} class="sr-only" tabindex={-1} aria-hidden="true" data-copy-source="render-url" />
          )}
          {saved ? null : <CopyFallback />}
        </section>

        <section>
          <h2 class={ui.h2}>설명</h2>
          {doc.description ? (
            <p class="mt-2 text-sm leading-6 whitespace-pre-line break-keep">{doc.description}</p>
          ) : (
            <p class="mt-2 text-fg-subtle">설명이 없습니다.</p>
          )}
        </section>

        <section>
          <h2 class={ui.h2}>관련 링크</h2>
          {doc.links.length ? (
            <ul class="mt-2 space-y-1.5">
              {doc.links.map((link) => (
                <li>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 text-primary hover:underline break-all"
                  >
                    {linkDisplayName(link)}
                    <Icon name="external-link" class="size-3.5 shrink-0" />
                    <span class="sr-only">(새 창)</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p class="mt-2 text-fg-subtle">관련 링크가 없습니다.</p>
          )}
        </section>

        <section>
          <h2 class={ui.h2}>정보</h2>
          <dl class="mt-2 grid grid-cols-[5rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt class="text-fg-subtle">문서 ID</dt>
            <dd class="font-mono text-xs break-all">{doc.documentKey}</dd>
            <dt class="text-fg-subtle">크기</dt>
            <dd class="tabular-nums">{formatSize(doc.htmlSize)}</dd>
            <dt class="text-fg-subtle">등록</dt>
            <dd>
              {doc.createdByName} · {formatFullDate(doc.createdAt)}
            </dd>
            <dt class="text-fg-subtle">수정</dt>
            <dd>
              {doc.updatedByName} · {formatFullDate(doc.updatedAt)}
            </dd>
          </dl>
        </section>

        <section>
          <h2 class={ui.h2}>소스</h2>
          <div class="mt-2 flex flex-col gap-2 sm:flex-row">
            <a href={`/html/${doc.documentKey}/source`} target="_blank" rel="noopener" class={ui.secondary}>
              소스 보기
              <Icon name="external-link" />
            </a>
            <a href={`/html/${doc.documentKey}/download`} class={ui.secondary}>
              소스 다운로드
            </a>
          </div>
        </section>

        {editor ? (
          <section class="flex gap-2 border-t border-line pt-6 sm:hidden">
            <a href={`/html/${doc.documentKey}/edit`} class={`${ui.secondary} flex-1`}>
              수정
            </a>
            <DeleteForm doc={doc} user={user} />
          </section>
        ) : null}
      </div>
    </AppPage>
  );
}

function DeleteForm({ doc, user }: { doc: DetailDoc; user: SessionUser }) {
  return (
    <form
      method="post"
      action={`/html/${doc.documentKey}/delete`}
      data-confirm={`'${doc.title}' 문서를 삭제할까요?\n삭제하면 되돌릴 수 없고, 이미 공유한 주소도 더 이상 열리지 않습니다.`}
    >
      <input type="hidden" name="_csrf" value={user.csrfToken ?? ""} />
      <button type="submit" class={ui.danger}>
        <Icon name="trash-2" />
        삭제
      </button>
    </form>
  );
}
