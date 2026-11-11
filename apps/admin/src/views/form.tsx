import type { Membership, SessionUser } from "@render-box/auth";
import type { DocumentFormErrors, DocumentFormValues, LinkRow } from "../lib/document-form";
import { LIMITS } from "../lib/document-form";
import { formatFullDate, formatSize } from "../lib/format";
import { Alert, AppPage, BackLink } from "./layout";
import { helpSection } from "./links";
import { Icon } from "./icon";
import * as ui from "./ui";

export type FormMode =
  | { kind: "create" }
  | {
      kind: "edit";
      documentKey: string;
      title: string;
      currentSize: number;
      updatedByName: string;
      updatedAt: number;
      conflict: boolean;
    };

export type KeptUpload = { id: number; size: number } | null;

const RESTRICTIONS = [
  "함께 있던 스크립트·스타일 파일은 올라가지 않습니다. 이미지는 저장할 때 파일을 선택하면 HTML 안에 넣어 줍니다.",
  "브라우저 저장소(localStorage 등)는 새로고침하면 초기화됩니다.",
  "새 창 열기(window.open, target=\"_blank\")와 파일 다운로드는 동작하지 않습니다.",
  "외부 API는 모든 출처를 허용하는 공개 API(Access-Control-Allow-Origin: *)만 호출할 수 있습니다.",
  "주소를 바꾸는 페이지 이동 방식(history.pushState)을 쓰면 새로고침 시 문서를 찾지 못합니다. 해시(#/page) 방식을 권장합니다.",
  "iframe 안의 문서를 직접 읽을 수 없습니다(contentDocument, contentWindow.document, parent.document). 부모와 iframe 사이는 postMessage로 주고받으세요.",
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} class={ui.fieldErr}>
      <Icon name="triangle-alert" class="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function LinkRowFields({ row, index }: { row: LinkRow; index: number }) {
  const n = index + 1;
  return (
    <div class="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[12rem_1fr_auto]" data-link-row>
      <input
        type="text"
        name="link_label"
        value={row.label}
        maxlength={LIMITS.linkLabel}
        placeholder="이름 (예: 기획서)"
        aria-label={`링크 ${n} 이름`}
        class={`${ui.input} col-start-1 row-start-1`}
      />
      <input
        type="text"
        name="link_url"
        value={row.url}
        maxlength={LIMITS.linkUrl}
        inputmode="url"
        autocomplete="off"
        spellcheck={false}
        placeholder="https://"
        aria-label={`링크 ${n} 주소`}
        aria-invalid={row.error ? "true" : undefined}
        class={`${ui.input} col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1`}
      />
      <button
        type="button"
        class={`${ui.iconBtn} col-start-2 row-start-1 sm:col-start-3`}
        data-link-remove
        aria-label={`링크 ${n} 삭제`}
      >
        <Icon name="trash-2" />
      </button>
      {row.error ? (
        <p class={`${ui.fieldErr} col-span-2 col-start-1 row-start-3 sm:col-span-3 sm:row-start-2`}>
          <Icon name="triangle-alert" class="mt-px size-3.5 shrink-0" />
          <span>{row.error}</span>
        </p>
      ) : null}
    </div>
  );
}

const filePick =
  `${ui.secondary} h-8 cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 ` +
  "has-[input:focus-visible]:outline-focus";

// Images the HTML points to by local path (<img src="images/a.png">). The
// browser inlines the chosen files as data: URLs before upload, and a grey
// placeholder for the rest, so storage and rendering stay a single HTML file
// (design.md 4.6).
function ImageInputs() {
  return (
    <div id="images" class="space-y-3" data-images hidden>
      <Alert kind="info" title="HTML이 쓰는 이미지 파일을 함께 넣을 수 있습니다">
        <p class="break-keep">
          이 HTML은 함께 올라가지 않는 이미지 파일을 쓰고 있습니다. 파일을 선택하면 HTML 안에 넣어(base64)
          함께 저장합니다. 선택하지 않은 이미지는 빈 상자로 표시됩니다.
        </p>
      </Alert>
      <div class="flex flex-wrap items-center gap-2">
        <label class={filePick}>
          <input type="file" multiple accept="image/*" class="sr-only" data-image-bulk />
          <Icon name="image" />
          여러 파일 한 번에 선택
        </label>
        <span class="text-xs text-fg-subtle">파일 이름이 같은 경로에 자동으로 연결합니다</span>
      </div>
      <ul class="space-y-2" data-image-list></ul>
      <p class="text-xs text-fg-muted" aria-live="polite" data-image-summary></p>
      <p class="text-xs text-danger-fg" aria-live="polite" data-image-msg></p>
      <template data-image-template>
        <li
          class="group flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
          data-image-row
          data-state="missing"
        >
          <span class="text-fg-subtle group-data-[state=selected]:text-success-fg">
            <Icon name="image" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-mono text-xs" data-image-src></p>
            <p class="truncate text-xs text-fg-subtle" data-image-status></p>
          </div>
          <label class={filePick}>
            <input type="file" accept="image/*" class="sr-only" data-image-file />
            <span data-image-action>파일 선택</span>
          </label>
        </li>
      </template>
    </div>
  );
}

function HtmlInput({ mode, kept, error }: { mode: FormMode; kept: KeptUpload; error?: string }) {
  const edit = mode.kind === "edit";
  return (
    <section class="space-y-3" data-html-input data-required={edit ? undefined : "true"}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="html-heading" class={ui.h2}>
          {edit ? "HTML 교체" : "HTML"}
          {edit ? null : (
            <span class="text-danger-fg" aria-hidden="true">
              {" "}
              *
            </span>
          )}
        </h2>
        <fieldset class={ui.segWrap}>
          <legend class="sr-only">입력 방식</legend>
          <label class={ui.segItem}>
            <input type="radio" name="html_mode" value="file" class="sr-only" checked data-mode-radio />
            파일로 올리기
          </label>
          <label class={ui.segItem}>
            <input type="radio" name="html_mode" value="paste" class="sr-only" data-mode-radio />
            직접 붙여넣기
          </label>
        </fieldset>
      </div>

      {edit ? (
        <>
          <div class="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
            <span class="font-medium">현재 HTML</span>{" "}
            <span class="tabular-nums">{formatSize(mode.currentSize)}</span>
            <span class="text-fg-muted">
              {" "}
              · 마지막 수정 {mode.updatedByName}, {formatFullDate(mode.updatedAt)}
            </span>
          </div>
          <p class={ui.hint}>새 파일을 올리지 않으면 지금 HTML이 그대로 유지됩니다.</p>
        </>
      ) : null}

      {/* data-state: empty | dragover | reading | selected | error | kept */}
      <div class="group" data-dropzone data-state={kept ? "kept" : error ? "error" : "empty"}>
        <label
          for="html-file"
          class={
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed " +
            "border-line-input bg-surface px-6 py-10 text-center hover:border-primary " +
            "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 " +
            "has-[input:focus-visible]:outline-focus " +
            "group-data-[state=dragover]:border-solid group-data-[state=dragover]:border-primary " +
            "group-data-[state=dragover]:bg-primary-soft group-data-[state=error]:border-solid " +
            "group-data-[state=error]:border-danger group-data-[state=error]:bg-danger-soft " +
            "group-data-[state=selected]:hidden group-data-[state=kept]:hidden group-data-[mode=paste]:hidden"
          }
        >
          <input
            type="file"
            id="html-file"
            accept=".html,.htm,text/html"
            class="sr-only"
            aria-describedby="dz-help dz-msg"
          />
          <span class="text-fg-subtle group-data-[state=dragover]:text-primary group-data-[state=error]:text-danger-fg">
            <Icon name="upload" class="size-8" />
          </span>
          <span class="text-sm group-data-[state=dragover]:hidden group-data-[state=reading]:hidden">
            {edit ? "교체할 HTML 파일을" : "HTML 파일을"} 여기로 끌어다 놓거나{" "}
            <span class="font-medium text-primary underline">파일 선택</span>
          </span>
          <span class="hidden text-sm font-medium text-primary group-data-[state=dragover]:inline">
            여기에 놓으세요
          </span>
          <span class="hidden items-center gap-1.5 text-sm group-data-[state=reading]:inline-flex">
            <Icon name="loader" class={ui.spinner} />
            파일을 읽는 중…
          </span>
          <span id="dz-help" class="text-xs text-fg-subtle">
            .html, .htm 파일 · 최대 10MB
          </span>
        </label>

        <div
          class={
            "hidden items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 " +
            "group-data-[state=selected]:flex group-data-[state=kept]:flex group-data-[mode=paste]:hidden!"
          }
        >
          <span class="text-fg-subtle">
            <Icon name="file-code" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium" data-file-name>
              {kept ? "앞서 올린 HTML" : ""}
            </p>
            <p class="text-xs text-fg-subtle tabular-nums" data-file-size>
              {kept ? `${formatSize(kept.size)} · 다시 올리지 않아도 됩니다` : ""}
            </p>
          </div>
          <button type="button" class={`${ui.ghost} h-8`} data-file-clear>
            <Icon name="x" />
            {edit ? "교체 취소" : "선택 해제"}
          </button>
        </div>

        <div class="hidden space-y-1.5 group-data-[mode=paste]:block">
          <label for="html-paste" class="sr-only">
            HTML 코드
          </label>
          <textarea
            id="html-paste"
            class={ui.codeArea}
            spellcheck={false}
            placeholder="<!DOCTYPE html>로 시작하는 HTML 코드를 붙여넣으세요"
          ></textarea>
          <p class={ui.hint} data-paste-size></p>
        </div>

        <p id="dz-msg" class="mt-1.5 text-xs text-danger-fg" aria-live="polite" data-dz-msg>
          {error ?? ""}
        </p>
      </div>

      {edit ? (
        <p class="flex items-center gap-2 text-sm" data-replace-note hidden>
          <span class={ui.badgeWarning}>교체 예정</span>
          저장하면 HTML이 이 파일로 바뀝니다. 공유한 주소는 그대로입니다.
        </p>
      ) : null}

      <div data-info hidden>
        <Alert kind="info" title="EUC-KR 파일을 UTF-8로 변환했습니다.">
          한글이 깨지지 않았는지 저장 후 한 번 확인해 주세요.
        </Alert>
      </div>
      <ImageInputs />

      <div data-warnings hidden>
        <Alert kind="warning" title="저장은 할 수 있지만, 일부가 표시되지 않을 수 있습니다">
          <ul class="list-disc space-y-1 pl-4" data-warning-list></ul>
          {helpSection("올릴-때-나오는-경고") ? (
            <a
              href={helpSection("올릴-때-나오는-경고")!}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-2 inline-block text-xs text-primary hover:underline"
            >
              경고 설명 보기<span class="sr-only"> (새 창)</span>
            </a>
          ) : null}
        </Alert>
      </div>
    </section>
  );
}

export function DocumentFormPage({
  user,
  project,
  mode,
  values,
  errors,
  kept,
}: {
  user: SessionUser;
  // Where a new document goes, or the edited document's project.
  project: Membership;
  mode: FormMode;
  values: DocumentFormValues;
  errors: DocumentFormErrors;
  kept: KeptUpload;
}) {
  const edit = mode.kind === "edit";
  const action = edit ? `/html/${mode.documentKey}` : "/html";
  const linkRows = values.links.length ? values.links : [{ label: "", url: "" }];
  const errorList = [
    errors.html && { href: "#html-heading", text: errors.html },
    errors.title && { href: "#title", text: errors.title },
    errors.description && { href: "#description", text: errors.description },
    errors.links && { href: "#links", text: errors.links },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    // Not boosted: the upload code binds window-level drag/drop listeners that
    // a body swap would leave behind (a full load on the way in and out).
    <AppPage
      title={edit ? `문서 수정 · ${mode.title}` : "새 HTML 등록"}
      user={user}
      project={project}
      boost={false}
      width="max-w-5xl"
    >
      <div class="space-y-6">
        <BackLink href={edit ? `/html/${mode.documentKey}` : `/html?project=${encodeURIComponent(project.slug)}`}>
          {edit ? mode.title : `${project.name} 목록`}
        </BackLink>
        <h1 class="text-xl font-semibold">{edit ? "문서 수정" : `새 HTML 등록 · ${project.name}`}</h1>

        {edit && mode.conflict ? (
          <Alert kind="error" title="다른 사람이 먼저 수정했습니다" focus>
            <p class="break-keep">
              {mode.updatedByName}님이 {formatFullDate(mode.updatedAt)}에 이 문서를 수정해서, 내 변경은 저장하지
              않았습니다. 입력한 내용은 아래에 그대로 남아 있습니다.
            </p>
            <a
              href={`/html/${mode.documentKey}`}
              target="_blank"
              rel="noopener"
              class="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <Icon name="external-link" />
              최신 내용 확인 (새 창)
            </a>
            <p class="mt-2">확인한 뒤 다시 저장하면 내 내용으로 바뀝니다.</p>
          </Alert>
        ) : errorList.length ? (
          <Alert kind="error" title="입력 내용을 확인해 주세요" focus>
            <ul class="list-disc space-y-1 pl-4">
              {errorList.map((e) => (
                <li>
                  <a href={e.href} class="underline">
                    {e.text}
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <form
          method="post"
          action={action}
          novalidate
          class="space-y-8"
          data-doc-form
          data-mode={mode.kind}
        >
          <input type="hidden" name="_csrf" value={user.csrfToken ?? ""} />
          {edit ? null : <input type="hidden" name="project" value={project.slug} />}
          <input type="hidden" name="upload_id" value={kept ? String(kept.id) : ""} data-upload-id />
          {values.version ? <input type="hidden" name="version" value={String(values.version)} /> : null}

          {/* Two columns from lg up so the form uses the page's width without
              stretching the inputs: the HTML on one side, the document's
              fields on the other (create: HTML first; edit: fields first). */}
          <div class="grid gap-8 lg:grid-cols-2 lg:items-start">
          {edit ? null : <HtmlInput mode={mode} kept={kept} error={errors.html} />}

          <div class="space-y-5">
            <div>
              <label for="title" class={ui.label}>
                제목{" "}
                <span class="text-danger-fg" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="title"
                name="title"
                type="text"
                value={values.title}
                maxlength={LIMITS.title}
                required
                aria-required="true"
                aria-invalid={errors.title ? "true" : undefined}
                aria-describedby="title-hint title-error"
                class={ui.input}
              />
              <p id="title-hint" class={ui.hint} data-title-hint hidden>
                파일의 제목으로 자동 입력했습니다. 필요하면 고치세요.
              </p>
              <FieldError id="title-error" message={errors.title} />
            </div>

            <div>
              <label for="description" class={ui.label}>
                설명
              </label>
              <textarea
                id="description"
                name="description"
                maxlength={LIMITS.description}
                aria-invalid={errors.description ? "true" : undefined}
                aria-describedby="description-hint description-error"
                class={ui.textarea}
              >
                {values.description}
              </textarea>
              <p id="description-hint" class={ui.hint}>
                줄바꿈은 그대로 표시됩니다. 최대 2,000자
              </p>
              <FieldError id="description-error" message={errors.description} />
            </div>

            <fieldset id="links" class="space-y-2" data-links>
              <legend class="mb-1.5 text-sm font-medium">
                관련 링크 <span class="font-normal text-fg-subtle">(선택, 최대 10개)</span>
              </legend>
              <div class="space-y-2" data-link-list>
                {linkRows.map((row, i) => (
                  <LinkRowFields row={row} index={i} />
                ))}
              </div>
              <template data-link-template>
                <LinkRowFields row={{ label: "", url: "" }} index={0} />
              </template>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class={ui.ghost} data-link-add>
                  <Icon name="plus" />
                  링크 추가
                </button>
                <span class="text-xs text-fg-subtle" data-link-limit hidden>
                  링크는 10개까지 넣을 수 있습니다.
                </span>
              </div>
              <p class={ui.hint}>이름을 비우면 사이트 주소(예: www.figma.com)로 표시됩니다.</p>
              {errors.links && !values.links.some((r) => r.error) ? (
                <FieldError id="links-error" message={errors.links} />
              ) : null}
            </fieldset>
          </div>

          {edit ? <HtmlInput mode={mode} kept={kept} error={errors.html} /> : null}
          </div>

          <details class="rounded-lg border border-line bg-surface px-4 py-3">
            <summary class="cursor-pointer text-sm font-medium">업로드한 HTML에서 안 되는 것 ({RESTRICTIONS.length}가지)</summary>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted break-keep">
              {RESTRICTIONS.map((r) => (
                <li>{r}</li>
              ))}
            </ul>
          </details>

          <noscript>
            <p class="text-sm text-warning-fg">
              HTML을 올리려면 브라우저에서 JavaScript를 켜야 합니다.
            </p>
          </noscript>

          <p class="text-sm text-danger-fg" role="alert" data-submit-error hidden>
            파일을 올리지 못했습니다. 네트워크를 확인하고 다시 저장해 주세요.
          </p>

          <div class="flex flex-col-reverse gap-2 border-t border-line pt-6 sm:flex-row sm:justify-end">
            <a href={edit ? `/html/${mode.documentKey}` : "/html"} class={`${ui.secondary} w-full sm:w-auto`}>
              취소
            </a>
            <button type="submit" class={`${ui.primary} w-full sm:w-auto`} data-submit>
              <span data-busy-icon hidden>
                <Icon name="loader" class={ui.spinner} />
              </span>
              <span data-submit-label>{edit && mode.conflict ? "내 내용으로 다시 저장" : "저장"}</span>
            </button>
          </div>
        </form>
      </div>
    </AppPage>
  );
}
