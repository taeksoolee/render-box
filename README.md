# render-box

기획·운영자가 올린 HTML을 개발자·디자이너가 URL 하나로 바로 열어 보는 사내 도구입니다.

AI로 만든 HTML 프로토타입을 메신저로 주고받는 대신, 파일을 올리면 고유 URL이 생깁니다. 받은 사람은 링크를 눌러 새 창에서 실제 동작을 확인합니다. 올라온 HTML은 관리 화면과 분리된 렌더링 호스트에서 격리되어 실행됩니다.

## 상태

설계 완료, MVP 1 구현 중 (로컬 개발 단계)

## 문서

| 문서 | 독자 | 내용 |
| --- | --- | --- |
| [docs/prd.md](docs/prd.md) | 기획자, 팀 전체 | 목적, 사용 흐름, 로드맵, 화면, 완료 기준 |
| [docs/design.md](docs/design.md) | 개발자 | 시스템 구성, 인증, 렌더링 격리, DB, 라우팅, 테스트 계획 |
| [docs/ui.md](docs/ui.md) | 개발자, 디자이너 | UI 디자인 가이드 (토큰, 레이아웃, 컴포넌트, 문구) |
| [docs/decisions.md](docs/decisions.md) | 설계를 다시 검토하는 사람 | 주요 결정과 기각한 대안 |

설계를 바꾸려면 먼저 [docs/decisions.md](docs/decisions.md)에서 해당 결정의 기각 이유를 확인하세요.

## 기술 스택

Cloudflare Workers (무료 플랜), D1, Hono, HTMX, Drizzle ORM, Tailwind CSS. 로컬 도구는 Node.js 24 + pnpm.

## 구성

```
apps/admin        관리 화면 Worker (로그인, 문서 등록·관리)
apps/render       렌더링 전용 Worker (업로드된 HTML을 격리해서 실행)
apps/mcp          AI 클라이언트용 MCP 서버 Worker (AI가 직접 올리기)
packages/db       DB 스키마, 마이그레이션, 청크 저장
packages/auth     키·세션·핸드오프, 로그인 실패 제한
packages/documents 문서 검증·업로드·조회 (admin과 mcp가 공유)
packages/shared   공통 미들웨어와 유틸
scripts/      키 관리 CLI, 점검 스크립트
docs/         설계 문서
```

## 로컬 개발

Node.js 24와 pnpm이 필요합니다. Cloudflare 계정은 필요 없습니다(로컬 D1 시뮬레이션).

```sh
nvm use                 # .nvmrc → Node 24
pnpm install
pnpm setup:local        # .dev.vars 생성(공유 HANDOFF_SECRET) + 로컬 D1 마이그레이션
pnpm key create --name 김기획 --role EDITOR
pnpm key create --name 박개발 --role VIEWER
pnpm dev                # 렌더링 :8788 → 관리 :8787 → MCP :8789 순서로 실행
```

`*.localhost` 주소는 Chrome·Firefox에서 바로 열립니다. 발급된 키로 http://app.localhost:8787 에 로그인하세요.

| 명령 | 설명 |
| --- | --- |
| `pnpm key list` / `revoke <prefix>` / `set-role <prefix> VIEWER` | 키 관리 (`--remote`를 붙이면 운영 D1) |
| `pnpm test` | 단위 테스트 (Vitest) |
| `RB_EDITOR_KEY=… RB_VIEWER_KEY=… pnpm test:e2e` | 브라우저 테스트: Chromium·Firefox·WebKit(Safari). `pnpm dev` 실행 중이어야 하고, 처음 한 번 `pnpm exec playwright install chromium firefox webkit` |
| `pnpm typecheck` | 타입 검사 |

브라우저 테스트는 한 번에 하나씩 실행합니다. 로컬에서는 여러 Worker 프로세스가 같은 SQLite 파일을 함께 쓰므로, 테스트를 병렬로 돌리면 D1이 간헐적으로 `Failed to get session commit token` 오류를 냅니다. 운영 D1에는 해당하지 않습니다.

## AI에서 바로 올리기 (MCP)

Claude Code 같은 MCP 클라이언트에 render-box를 연결하면 "이 HTML render-box에 올려 줘"로 바로 올리고 렌더링 URL을 받습니다. 본인의 접근 키를 씁니다. EDITOR 키는 올리기·수정·조회, VIEWER 키는 조회만 할 수 있습니다.

```sh
# 로컬
claude mcp add --transport http render-box http://mcp.localhost:8789/mcp \
  --header "Authorization: Bearer rb_..."
```

| 도구 | 설명 |
| --- | --- |
| `upload_html` | 새 문서 올리기 → 렌더링 URL |
| `update_html` | 문서 수정 (넘긴 항목만 바뀜, URL 유지) |
| `list_html` | 문서 찾기 |
| `get_html` | 문서 정보와 HTML 원본 |

- HTML은 1MB까지 올릴 수 있습니다. 더 큰 파일은 웹 화면에서 올리세요.
- 이미지는 HTML 안에 base64로 넣거나 https 주소를 써야 합니다.
- 삭제는 웹 화면에서만 할 수 있습니다.
