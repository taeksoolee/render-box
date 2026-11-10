import type { SessionUser } from "@render-box/auth";
import type { DocumentLink } from "@render-box/db";
import type { VersionRow } from "@render-box/documents";
import { formatFullDate, formatRelativeDate, formatSize, isoDate, linkDisplayName } from "../lib/format";
import { Alert, AppPage, BackLink } from "./layout";
import { Icon } from "./icon";
import * as ui from "./ui";

export type DetailDoc = {
  documentKey: string;
  title: string;
  description: string | null;
  links: DocumentLink[];
  htmlSize: number;
  version: number;
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

export type DetailNotice = "restored" | "version-deleted" | "conflict";

const NOTICES: Record<DetailNotice, { kind: "success" | "error"; title: string; body: string }> = {
  restored: {
    kind: "success",
    title: "버전을 복원했습니다",
    body: "복원한 내용이 새 버전으로 추가되었고, 렌더링 URL은 그대로입니다.",
  },
  "version-deleted": { kind: "success", title: "버전을 지웠습니다", body: "" },
  conflict: {
    kind: "error",
    title: "복원하지 못했습니다",
    body: "그 사이 다른 사람이 문서를 수정했습니다. 아래 최신 버전 목록을 확인한 뒤 다시 시도해 주세요.",
  },
};

export function DetailPage({
  doc,
  versions,
  user,
  renderOrigin,
  saved,
  replaced,
  notice,
}: {
  doc: DetailDoc;
  versions: VersionRow[];
  user: SessionUser;
  renderOrigin: string;
  saved: boolean;
  replaced: boolean;
  notice: DetailNotice | null;
}) {
  const url = `${renderOrigin}/${doc.documentKey}`;
  const editor = user.role === "EDITOR";
  return (
    <AppPage title={doc.title} user={user}>
      <div class="space-y-8">
        <div class="space-y-4">
          <BackLink href="/html">목록</BackLink>
          {notice ? (
            <Alert kind={NOTICES[notice].kind} title={NOTICES[notice].title}>
              {NOTICES[notice].body ? <p>{NOTICES[notice].body}</p> : null}
            </Alert>
          ) : null}
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

        <Versions doc={doc} versions={versions} user={user} renderOrigin={renderOrigin} />

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

// HTML versions, newest first (design.md 4.9). The first row is current: it
// can be viewed but not restored or deleted.
function Versions({
  doc,
  versions,
  user,
  renderOrigin,
}: {
  doc: DetailDoc;
  versions: VersionRow[];
  user: SessionUser;
  renderOrigin: string;
}) {
  const editor = user.role === "EDITOR";
  const base = `/html/${doc.documentKey}/v`;
  return (
    <section id="versions">
      <h2 class={ui.h2}>버전</h2>
      <p class={ui.hint}>HTML을 교체할 때마다 이전 HTML이 버전으로 남습니다. 렌더링 URL은 항상 현재 버전을 보여 줍니다.</p>
      <ul class={`${ui.tableWrap} mt-3 divide-y divide-line`}>
        {versions.map((v, i) => {
          const current = i === 0;
          return (
            <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div class="min-w-0 flex-1 text-sm">
                <p class="flex flex-wrap items-center gap-1.5">
                  <span class="font-medium tabular-nums">v{v.seq}</span>
                  {current ? <span class={ui.badgePrimary}>현재</span> : null}
                  {v.restoredFrom ? <span class={ui.badgeNeutral}>v{v.restoredFrom} 복원</span> : null}
                </p>
                <p class="mt-0.5 text-xs text-fg-subtle tabular-nums">
                  {v.createdByName} ·{" "}
                  <time datetime={isoDate(v.createdAt)} title={formatFullDate(v.createdAt)}>
                    {formatRelativeDate(v.createdAt)}
                  </time>{" "}
                  · {formatSize(v.htmlSize)}
                </p>
              </div>
              <div class="flex flex-wrap gap-1">
                <a
                  href={current ? `${renderOrigin}/${doc.documentKey}` : `${renderOrigin}/${doc.documentKey}/v/${v.seq}`}
                  target="_blank"
                  rel="noopener"
                  class={ui.rowAction}
                  aria-label={`v${v.seq} 보기 (새 창)`}
                >
                  <Icon name="external-link" />
                  보기
                </a>
                <a href={`${base}/${v.seq}/source`} target="_blank" rel="noopener" class={ui.rowAction} aria-label={`v${v.seq} 소스 보기`}>
                  소스
                </a>
                {editor && !current ? (
                  <>
                    <form
                      method="post"
                      action={`${base}/${v.seq}/restore`}
                      data-confirm={`v${v.seq}을(를) 복원할까요?\n지금 HTML은 이전 버전으로 남고, 렌더링 URL에서 v${v.seq} 내용이 보입니다.`}
                    >
                      <input type="hidden" name="_csrf" value={user.csrfToken ?? ""} />
                      <input type="hidden" name="version" value={String(doc.version)} />
                      <button type="submit" class={ui.rowAction}>
                        <Icon name="rotate-ccw" />
                        복원
                      </button>
                    </form>
                    <form
                      method="post"
                      action={`${base}/${v.seq}/delete`}
                      data-confirm={`v${v.seq}을(를) 지울까요?\n지우면 되돌릴 수 없습니다.`}
                    >
                      <input type="hidden" name="_csrf" value={user.csrfToken ?? ""} />
                      <button type="submit" class={ui.rowActionDanger} aria-label={`v${v.seq} 삭제`}>
                        <Icon name="trash-2" />
                        삭제
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
