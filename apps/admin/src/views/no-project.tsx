import type { SessionUser } from "@render-box/auth";
import { CopyButton } from "./detail";
import { AppPage } from "./layout";
import { Icon } from "./icon";
import * as ui from "./ui";

// For a key that belongs to no project (design.md 3.9): instead of empty
// lists, one page that says whom to ask and what to tell them. The key prefix
// is what the operator needs for `pnpm project grant`.
export function NoProjectPage({ user }: { user: SessionUser }) {
  const command = `pnpm project grant ${user.keyPrefix} <프로젝트> --role EDITOR --remote`;
  return (
    <AppPage title="속한 프로젝트 없음" user={user}>
      <div class={`${ui.card} space-y-4`}>
        <Icon name="file-code" class="size-8 text-fg-subtle" />
        <h1 class="text-xl font-semibold">아직 속한 프로젝트가 없습니다</h1>
        <p class="text-fg-muted break-keep">
          문서를 보거나 올리려면 프로젝트에 들어가 있어야 합니다. 관리자에게 아래 키를 프로젝트에 넣어 달라고
          요청하세요. 넣어 주면 이 화면을 새로 고치는 것만으로 바로 보입니다.
        </p>
        <dl class="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-fg-subtle">이름</dt>
          <dd>{user.name}</dd>
          <dt class="text-fg-subtle">키</dt>
          <dd class="font-mono" data-key-prefix>
            {user.keyPrefix}…
          </dd>
        </dl>
        <div class="space-y-2">
          <p class="text-xs text-fg-subtle">관리자에게 함께 보낼 명령</p>
          <input
            type="text"
            readonly
            value={command}
            aria-label="관리자에게 보낼 명령"
            data-copy-source="grant-command"
            class={`${ui.input} bg-canvas font-mono text-xs`}
          />
          <CopyButton value={command} cls={ui.secondary} label="명령 복사" target="grant-command" />
        </div>
      </div>
    </AppPage>
  );
}
