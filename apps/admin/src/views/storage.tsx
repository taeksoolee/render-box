import type { Membership, SessionUser } from "@render-box/auth";
import type { PreviousVersionRow, StorageUsage } from "@render-box/documents";
import { formatFullDate, formatRelativeDate, formatSize, isoDate } from "../lib/format";
import { Alert, AppPage, BackLink } from "./layout";
import { Icon } from "./icon";
import * as ui from "./ui";

export type StorageLevel = "ok" | "warn" | "full";

export function storageLevel(u: StorageUsage): StorageLevel {
  if (u.used >= u.limit) return "full";
  return u.used >= u.warnAt ? "warn" : "ok";
}

const FILL: Record<StorageLevel, string> = { ok: "fill-primary", warn: "fill-warning-fg", full: "fill-danger" };

// SVG instead of an inline width style: the admin CSP blocks style attributes.
function Meter({ usage }: { usage: StorageUsage }) {
  const pct = Math.min(100, (usage.used / usage.limit) * 100);
  return (
    <svg class="h-1.5 w-full overflow-hidden rounded-full" aria-hidden="true">
      <rect width="100%" height="100%" class="fill-line" />
      <rect width={`${pct.toFixed(1)}%`} height="100%" class={FILL[storageLevel(usage)]} />
    </svg>
  );
}

export function usageText(u: StorageUsage) {
  return `${formatSize(u.used)} / ${formatSize(u.limit)}`;
}

// Shown on the list page: one line of usage, plus a banner past the warning
// threshold so space is freed before uploads start failing (design.md 4.9).
export function StorageSummary({ usage }: { usage: StorageUsage }) {
  const level = storageLevel(usage);
  return (
    <div class="space-y-3">
      {level === "full" ? (
        <Alert kind="error" title="저장 공간이 가득 찼습니다">
          <p class="break-keep">
            지금은 새로 올리거나 HTML을 교체할 수 없습니다.{" "}
            <a href="/storage" class="font-medium text-primary hover:underline">
              이전 버전 정리하기
            </a>
          </p>
        </Alert>
      ) : level === "warn" ? (
        <Alert kind="warning" title="저장 공간이 얼마 남지 않았습니다">
          <p class="break-keep">
            {usageText(usage)}를 쓰고 있습니다. 가득 차면 업로드가 막힙니다.{" "}
            <a href="/storage" class="font-medium text-primary hover:underline">
              이전 버전 정리하기
            </a>
          </p>
        </Alert>
      ) : null}
      <a href="/storage" class="group block max-w-xs space-y-1.5" aria-label={`저장 공간 ${usageText(usage)}, 자세히 보기`}>
        <span class="flex items-center justify-between gap-2 text-xs text-fg-muted group-hover:text-fg">
          <span class="inline-flex items-center gap-1">
            <Icon name="database" class="size-3.5" />
            저장 공간
          </span>
          <span class="tabular-nums">
            {usageText(usage)}
            {usage.previous > 0 ? ` · 이전 버전 ${formatSize(usage.previous)}` : ""}
          </span>
        </span>
        <Meter usage={usage} />
      </a>
    </div>
  );
}

export function StoragePage({
  user,
  project,
  usage,
  byProject,
  versions,
  deleted,
}: {
  user: SessionUser;
  project: Membership | null;
  usage: StorageUsage;
  // The viewer's projects with the bytes each uses (design.md 3.9).
  byProject: { project: Membership; used: number }[];
  versions: PreviousVersionRow[];
  deleted: number | null;
}) {
  const editable = new Set(user.projects.filter((p) => p.role === "EDITOR").map((p) => p.projectId));
  const names = new Map(user.projects.map((p) => [p.projectId, p.name]));
  const anyEditable = versions.some((v) => editable.has(v.projectId));
  const level = storageLevel(usage);
  const current = Math.max(0, usage.used - usage.previous);
  return (
    <AppPage title="저장 공간" user={user} project={project}>
      <div class="space-y-8">
        <div class="space-y-4">
          <BackLink href="/html">목록</BackLink>
          {deleted !== null ? (
            <Alert kind="success" title={deleted > 0 ? `이전 버전 ${deleted}개를 지웠습니다` : "지운 버전이 없습니다"}>
              {deleted === 0 ? <p>선택한 버전이 이미 지워졌거나 현재 버전이었습니다.</p> : null}
            </Alert>
          ) : null}
        </div>

        <section class="space-y-3">
          <h1 class="text-xl font-semibold">저장 공간</h1>
          <div class={`${ui.card} space-y-3`}>
            <p class="flex items-baseline justify-between gap-2">
              <span class="text-2xl font-semibold tabular-nums">{formatSize(usage.used)}</span>
              <span class="text-sm text-fg-muted tabular-nums">/ {formatSize(usage.limit)}</span>
            </p>
            <Meter usage={usage} />
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt class="text-fg-subtle">현재 문서</dt>
              <dd class="text-right tabular-nums">{formatSize(current)}</dd>
              <dt class="text-fg-subtle">이전 버전</dt>
              <dd class="text-right tabular-nums">{formatSize(usage.previous)}</dd>
            </dl>
            {byProject.length > 0 ? (
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm" aria-label="프로젝트별 사용량">
                {byProject.map((p) => (
                  <>
                    <dt class="text-fg-subtle">{p.project.name}</dt>
                    <dd class="text-right tabular-nums">{formatSize(p.used)}</dd>
                  </>
                ))}
              </dl>
            ) : null}
            <p class={ui.hint}>
              {level === "full"
                ? "가득 차서 새로 올리기와 HTML 교체가 막혀 있습니다. 이전 버전이나 안 쓰는 문서를 지우면 다시 올릴 수 있습니다."
                : `${formatSize(usage.limit)}가 차면 업로드가 막힙니다. 오래된 버전을 자동으로 지우지 않습니다.`}
            </p>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class={ui.h2}>이전 버전 (지우면 공간이 많이 생기는 순서)</h2>
          {versions.length === 0 ? (
            <p class="text-fg-subtle">내가 속한 프로젝트에 이전 버전이 없습니다.</p>
          ) : (
            <form
              method="post"
              action="/storage/delete"
              class="space-y-3"
              data-confirm={"선택한 이전 버전을 지울까요?\n지우면 되돌릴 수 없습니다. 현재 버전은 지워지지 않습니다."}
            >
              <input type="hidden" name="_csrf" value={user.csrfToken ?? ""} />
              <ul class={`${ui.tableWrap} divide-y divide-line`}>
                {versions.map((v) => (
                  <li class="flex items-start gap-3 px-4 py-3">
                    {editable.has(v.projectId) ? (
                      <input
                        type="checkbox"
                        name="version_id"
                        value={String(v.id)}
                        id={`ver-${v.id}`}
                        class="mt-1 size-4 shrink-0 accent-primary"
                      />
                    ) : null}
                    <label for={editable.has(v.projectId) ? `ver-${v.id}` : undefined} class="min-w-0 flex-1 text-sm">
                      <span class="block font-medium break-keep">
                        {v.title} <span class="font-normal text-fg-muted">· v{v.seq}</span>
                        {user.projects.length > 1 ? (
                          <span class="ml-1.5 font-normal text-fg-subtle">{names.get(v.projectId)}</span>
                        ) : null}
                      </span>
                      <span class="block text-xs text-fg-subtle">
                        {v.createdByName} ·{" "}
                        <time datetime={isoDate(v.createdAt)} title={formatFullDate(v.createdAt)}>
                          {formatRelativeDate(v.createdAt)}
                        </time>
                        {v.freesBytes === 0 ? " · 다른 버전과 같은 HTML이라 지워도 공간이 늘지 않음" : ""}
                      </span>
                    </label>
                    <span class="shrink-0 text-sm tabular-nums text-fg-muted">{formatSize(v.htmlSize)}</span>
                    <a href={`/html/${v.documentKey}#versions`} class={ui.rowAction} aria-label={`${v.title} 문서로`}>
                      문서
                    </a>
                  </li>
                ))}
              </ul>
              {anyEditable ? (
                <button type="submit" class={ui.danger}>
                  <Icon name="trash-2" />
                  선택한 버전 지우기
                </button>
              ) : (
                <p class={ui.hint}>버전을 지우려면 그 프로젝트의 편집 권한이 필요합니다.</p>
              )}
            </form>
          )}
        </section>
      </div>
    </AppPage>
  );
}
