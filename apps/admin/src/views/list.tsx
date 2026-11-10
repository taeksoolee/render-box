import type { Membership, SessionUser } from "@render-box/auth";
import type { StorageUsage } from "@render-box/documents";
import { formatFullDate, formatRelativeDate, formatSize, isoDate } from "../lib/format";
import { Alert, AppPage, SafetyLine } from "./layout";
import { helpSection } from "./links";
import { Icon } from "./icon";
import { StorageSummary } from "./storage";
import * as ui from "./ui";

export type ListRow = {
  documentKey: string;
  title: string;
  description: string | null;
  linkCount: number;
  htmlSize: number;
  updatedByName: string;
  updatedAt: number;
};

export type ListData = {
  rows: ListRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  renderOrigin: string;
  // The project being listed; null when the key belongs to none (design.md 3.9).
  project: Membership | null;
};

function pageHref(q: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const s = params.toString();
  return s ? `/html?${s}` : "/html";
}

function When({ ms }: { ms: number }) {
  return (
    <time datetime={isoDate(ms)} title={formatFullDate(ms)}>
      {formatRelativeDate(ms)}
    </time>
  );
}

function NewWindowLink({ row, origin, compact = false }: { row: ListRow; origin: string; compact?: boolean }) {
  return (
    <a
      href={`${origin}/${row.documentKey}`}
      target="_blank"
      rel="noopener"
      class={ui.rowAction}
      aria-label={`${row.title} 새 창에서 보기`}
    >
      <Icon name="external-link" />
      {compact ? null : <span>새 창</span>}
    </a>
  );
}

function Empty({ data }: { data: ListData }) {
  if (!data.project) {
    return (
      <div class={ui.empty}>
        <Icon name="file-code" class="mx-auto size-8 text-fg-subtle" />
        <p class="mt-3 text-base font-semibold">속한 프로젝트가 없습니다</p>
        <p class="mt-1 text-fg-muted break-keep">문서를 보려면 운영자에게 프로젝트에 넣어 달라고 요청하세요.</p>
      </div>
    );
  }
  if (data.q) {
    return (
      <div class={ui.empty}>
        <Icon name="search" class="mx-auto size-8 text-fg-subtle" />
        <p class="mt-3 text-base font-semibold">'{data.q}'와(과) 맞는 문서가 없습니다</p>
        <p class="mt-1 text-fg-muted break-keep">제목 일부나 문서 ID 앞부분으로 찾을 수 있습니다.</p>
        <a href="/html" class={`${ui.secondary} mt-4`}>
          검색어 지우기
        </a>
      </div>
    );
  }
  return data.project.role === "EDITOR" ? (
    <div class={ui.empty}>
      <Icon name="upload" class="mx-auto size-8 text-fg-subtle" />
      <p class="mt-3 text-base font-semibold">아직 등록한 HTML이 없습니다</p>
      <p class="mt-1 text-fg-muted break-keep">파일을 올리면 팀원이 열어 볼 수 있는 주소가 만들어집니다.</p>
      <a href="/html/new" class={`${ui.primary} mt-4`}>
        <Icon name="plus" />새 HTML 등록
      </a>
      {helpSection("ai-도구로-올리기") ? (
        <p class="mt-4 text-sm text-fg-muted break-keep">
          Claude Code 같은 AI 도구에서 바로 올릴 수도 있습니다.{" "}
          <a href={helpSection("ai-도구로-올리기")!} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
            AI 도구로 올리는 방법
          </a>
        </p>
      ) : null}
    </div>
  ) : (
    <div class={ui.empty}>
      <Icon name="file-code" class="mx-auto size-8 text-fg-subtle" />
      <p class="mt-3 text-base font-semibold">아직 등록된 문서가 없습니다</p>
      <p class="mt-1 text-fg-muted break-keep">기획자가 문서를 올리면 여기에 표시됩니다.</p>
    </div>
  );
}

// Lives outside #list: an out-of-band element inside the swapped region would
// be replaced together with it.
export function ListCount({ data, oob = false }: { data: ListData; oob?: boolean }) {
  return (
    <p id="list-count" class="sr-only" aria-live="polite" hx-swap-oob={oob ? "true" : undefined}>
      {data.q ? `검색 결과 ${data.total}개` : `문서 ${data.total}개`}
    </p>
  );
}

// The swappable region (hx-swap="outerHTML").
export function ListRegion({ data, user }: { data: ListData; user: SessionUser }) {
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const hasPrev = data.page > 1;
  const hasNext = to < data.total;
  const pagerLink = (enabled: boolean, page: number, text: string) =>
    enabled ? (
      <a
        href={pageHref(data.q, page)}
        hx-get={pageHref(data.q, page)}
        hx-target="#list"
        hx-swap="outerHTML"
        hx-push-url="true"
        class={ui.secondary}
      >
        {text}
      </a>
    ) : (
      <span class={ui.secondary} aria-disabled="true">
        {text}
      </span>
    );

  return (
    <div id="list" class="mt-4">
      {data.rows.length === 0 ? (
        <Empty data={data} />
      ) : (
        <>
          <div class={`${ui.tableWrap} hidden md:block`}>
            <table class="w-full text-sm">
              <thead>
                <tr>
                  <th class={ui.th}>제목</th>
                  <th class={ui.thNum}>링크</th>
                  <th class={ui.thNum}>크기</th>
                  <th class={ui.th}>수정자</th>
                  <th class={ui.th}>수정일</th>
                  <th class={ui.th}>
                    <span class="sr-only">새 창</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr class={ui.tr}>
                    <td class={`${ui.td} max-w-0 w-full`}>
                      <a href={`/html/${row.documentKey}`} class={ui.rowTitle}>
                        {row.title}
                      </a>
                      {row.description ? <p class={ui.rowDesc}>{row.description}</p> : null}
                    </td>
                    <td class={ui.tdNum}>{row.linkCount}</td>
                    <td class={ui.tdNum}>{formatSize(row.htmlSize)}</td>
                    <td class={`${ui.td} whitespace-nowrap text-fg-muted`}>{row.updatedByName}</td>
                    <td class={`${ui.td} whitespace-nowrap tabular-nums text-fg-muted`}>
                      <When ms={row.updatedAt} />
                    </td>
                    <td class={`${ui.td} py-2`}>
                      <NewWindowLink row={row} origin={data.renderOrigin} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul class="space-y-2 md:hidden">
            {data.rows.map((row) => (
              <li class="relative rounded-lg border border-line bg-surface p-4">
                <div class="flex items-start justify-between gap-2">
                  <a href={`/html/${row.documentKey}`} class={ui.rowTitle}>
                    {row.title}
                  </a>
                  <NewWindowLink row={row} origin={data.renderOrigin} compact />
                </div>
                {row.description ? <p class={ui.rowDesc}>{row.description}</p> : null}
                <p class="mt-1 text-xs text-fg-subtle tabular-nums">
                  {row.updatedByName} · <When ms={row.updatedAt} /> · {formatSize(row.htmlSize)} · 링크{" "}
                  {row.linkCount}
                </p>
              </li>
            ))}
          </ul>
          <nav class="mt-4 flex items-center justify-between gap-2" aria-label="페이지">
            <p class="text-xs text-fg-subtle tabular-nums">
              {from}–{to} / 전체 {data.total}개
            </p>
            <div class="flex gap-2">
              {pagerLink(hasPrev, data.page - 1, "‹ 이전")}
              {pagerLink(hasNext, data.page + 1, "다음 ›")}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

export function ListPage({
  data,
  user,
  storage,
  deleted,
}: {
  data: ListData;
  user: SessionUser;
  storage: StorageUsage;
  deleted: boolean;
}) {
  return (
    <AppPage title="문서" user={user} project={data.project} width="max-w-5xl">
      <div class="space-y-4">
        <SafetyLine />
        {deleted ? <Alert kind="success" title="문서를 삭제했습니다." /> : null}
        <StorageSummary usage={storage} />
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-xl font-semibold">{data.project ? data.project.name : "문서"}</h1>
          {data.project?.role === "EDITOR" ? (
            <a href={`/html/new?project=${encodeURIComponent(data.project!.slug)}`} class={ui.primary}>
              <Icon name="plus" />새 HTML 등록
            </a>
          ) : null}
        </div>
        <form method="get" action="/html" role="search">
          <label for="q" class="sr-only">
            문서 검색
          </label>
          <div class="relative">
            <span class="pointer-events-none absolute left-3 top-3 text-fg-subtle">
              <Icon name="search" />
            </span>
            <input
              id="q"
              name="q"
              type="search"
              value={data.q}
              placeholder="제목 또는 문서 ID로 검색"
              autocomplete="off"
              class={`${ui.input} pl-9 pr-9`}
              hx-get="/html"
              hx-trigger="input changed delay:300ms, search"
              hx-target="#list"
              hx-swap="outerHTML"
              hx-push-url="true"
              hx-sync="this:replace"
              hx-indicator="#search-spinner"
            />
            <span
              id="search-spinner"
              class="pointer-events-none absolute right-3 top-3 text-fg-subtle opacity-0 htmx-request:opacity-100"
            >
              <Icon name="loader" class={ui.spinner} />
            </span>
          </div>
        </form>
      </div>
      <ListRegion data={data} user={user} />
      <ListCount data={data} />
    </AppPage>
  );
}
