# render-box — 기술 설계

- 문서 상태: 확정 (MVP 1 착수 기준)
- 독자: 개발자
- 관련 문서:
  - [prd.md](prd.md) — 제품 요구사항 (기능, 화면, 문서 필드, 완료 기준)
  - [decisions.md](decisions.md) — 주요 결정과 기각한 대안

이 문서는 [prd.md](prd.md)의 요구사항을 **어떻게 구현하는지**를 다룬다. 기능 정의와 화면 구성은 prd.md를 기준으로 한다.

---

# 1. 시스템 구성

## 1.1 플랫폼: Cloudflare Workers 무료 플랜

운영 플랫폼은 Cloudflare Workers이고, **무료 플랜 안에서 동작하는 것**을 설계 제약으로 둔다. 유료 플랜이 필요해지면 가벼운 서버 한 대로 운영하는 편이 낫기 때문이다 ([decisions.md](decisions.md) D-26).

설계에 영향을 주는 무료 플랜 제약은 다음과 같다. 수치는 착수 시점의 Cloudflare 문서로 다시 확인한다.

| 항목 | 제약 | 설계 대응 |
| --- | --- | --- |
| CPU 시간 | 요청당 10ms. I/O 대기 시간(D1 응답 등)은 포함하지 않음 | 큰 데이터의 인코딩 판별·경고 검사는 브라우저에서 한다. 서버는 바이트를 자르고 이어 붙이기만 한다 (4.3, 5.1) |
| 요청 수 | 하루 10만 건 | 소수 팀 사용량으로는 충분하다 |
| 메모리 | 128MB | 10MB 문서를 다루기에 충분하다 |
| D1 저장 용량 | DB 하나당 500MB, 계정 전체 5GB | HTML 원본까지 D1에 저장하므로 용량을 관리해야 한다 (4.2) |
| D1 읽기·쓰기 | 하루 읽기 500만 행, 쓰기 10만 행 | 10MB 문서를 한 번 렌더링하면 10행을 읽는다. 충분하다 |
| D1 행 크기 | 한 행 최대 약 2MB | HTML을 1MB 청크로 나누어 저장한다 (4.2) |
| Cron | 쓰지 않음 | 정리 작업은 다른 요청을 처리할 때 함께 한다 (3.3, 4.3) |

**CPU 시간은 추정치다.** 1단계에서 1MB, 5MB, 10MB 문서의 업로드와 렌더링 CPU 시간을 실측한 뒤 최대 크기를 확정한다 (10.6).

**로컬 우선:** MVP 개발은 `wrangler dev`(로컬 D1 시뮬레이션)로 진행하고 확인한다. Cloudflare 계정 연결과 배포는 로컬 검증이 끝난 뒤에 한다.

## 1.2 호스트

| 호스트 | 앱 | 환경 변수 | 운영 예시 | 로컬 |
| --- | --- | --- | --- | --- |
| 관리 | `apps/admin` | `APP_ORIGIN` | `https://render-box-admin.<계정>.workers.dev` | `http://app.localhost:8787` |
| 렌더링 | `apps/render` | `RENDER_ORIGIN` | `https://render-box-render.<계정>.workers.dev` | `http://render.localhost:8788` |
| API (MCP·REST) | `apps/api` | `API_ORIGIN` | `https://render-box-api.<계정>.workers.dev` | `http://api.localhost:8789` |

- 두 호스트는 **출처(origin)가 다르다.** 그래서 브라우저의 동일 출처 정책(SOP)이 렌더링 문서와 관리 화면을 기본적으로 분리한다.
- `workers.dev`는 Public Suffix List에 등록되어 있어 하위 주소끼리도 **다른 사이트(site)**로 취급된다. 렌더링 문서가 관리 호스트로 보내는 하위 요청에는 `SameSite=Lax` 쿠키가 실리지 않는다.
- 로컬의 `*.localhost`와 회사 도메인의 서브도메인은 **같은 사이트**다. 이 경우 하위 요청에 Lax 쿠키가 실릴 수 있으므로 Fetch Metadata 검사로 막는다 (3.6). 어느 구성이든 같은 코드로 안전해야 한다.
- 쿠키는 `__Host-` 접두사로 host-only가 되어 다른 호스트로 전송되지 않는다.
- 나중에 회사 도메인으로 옮길 때는 환경 변수만 바꾼다.

## 1.3 저장소 구조

pnpm workspace 모노레포다 ([decisions.md](decisions.md) D-25).

```
render-box/
├── apps/
│   ├── admin/      # Worker: 로그인, 문서 관리 화면, 업로드
│   │   └── public/ # 정적 파일 (CSS, JS) — Workers Static Assets
│   ├── render/     # Worker: 렌더링, 핸드오프 수신
│   └── api/        # Worker: 키로 쓰는 MCP 서버와 REST API (11장)
├── packages/
│   ├── db/         # Drizzle 스키마, D1 마이그레이션, 청크 저장
│   ├── auth/       # 세션, 핸드오프 토큰, 키 해시·조회, 로그인 실패 제한
│   ├── documents/  # 문서 입력 검증, 업로드 저장, 문서 조회·등록·수정 (admin과 api가 공유)
│   └── shared/     # Fetch Metadata 미들웨어, 리다이렉트 검증, 정식 주소 이동, document_key
├── scripts/        # 키 관리 CLI, 헤더 점검 스크립트
└── docs/
```

- 각 앱은 독립된 Worker이며 미들웨어를 공유하지 않는다. 따라서 관리 앱 CSP와 렌더링 CSP가 한 응답에 함께 붙을 수 없다.
- 공통 로직(세션, 토큰, 검증 함수)만 `packages/`로 공유한다. 보안 헤더 미들웨어는 앱마다 따로 둔다.
- 세 Worker는 같은 D1 데이터베이스를 바인딩한다. api 앱은 admin과 같은 범위(문서·업로드·키)를 읽고 쓰며 세션은 쓰지 않는다. render 앱은 `html_documents`, `html_chunks`, `access_keys`를 읽기만 하고, `sessions`에만 쓴다. 다만 D1 바인딩에는 읽기 전용 권한을 줄 수 없으므로, 이 제한은 코드 수준의 약속이다.

## 1.4 기술 스택

| 영역 | 기술 | 비고 |
| --- | --- | --- |
| 런타임 | Cloudflare Workers | 로컬은 `wrangler dev` |
| 로컬 도구 | Node.js 24 LTS, pnpm | `.nvmrc`와 `engines`로 고정 |
| 웹 | Hono | 앱마다 별도 인스턴스 |
| UI | Hono JSX (SSR) + HTMX 2.x | HTMX는 목록 검색·페이지네이션에만 사용 |
| CSS | Tailwind CSS | 빌드 시 정적 CSS 생성 |
| DB | Cloudflare D1 (SQLite) | HTML 원본도 청크로 저장 |
| ORM | Drizzle ORM (D1 드라이버) | |
| Validation | Zod | |
| 테스트 | Vitest (`@cloudflare/vitest-pool-workers`), Playwright (Chromium, Firefox, WebKit) | |
| 배포 | `wrangler deploy` | |

---

# 2. 위협 모델

| 위협 주체 | 예시 | 대응 |
| --- | --- | --- |
| **신뢰할 수 없는 HTML 코드** (주 위협) | AI가 생성한 코드, 인터넷에서 복사한 코드, 오염된 CDN 패키지 | 렌더링 격리 (5장) |
| 키 유출 | 메신저나 문서에 키가 노출됨 | 개인별 키 즉시 회수, 세션 즉시 무효화 |
| 외부 사이트 | 로그인된 사용자를 노린 CSRF, 리다이렉트 악용 | CSRF 토큰, Origin·Fetch Metadata 검사, `next` 검증 |
| 같은 사이트의 다른 서비스 | 회사 도메인으로 옮긴 뒤 `*.example.com`의 다른 서비스 | host-only 쿠키, Origin·Fetch Metadata 검사 |

**범위 밖 (수용한 위험):**

- **악의적인 EDITOR가 VIEWER를 노리는 경우.** EDITOR는 신뢰하는 내부 인원으로 가정한다. 렌더링 문서는 격리되어 있어 키나 세션을 탈취할 수 없고, 가짜 입력 화면을 띄우는 정도만 할 수 있다. 렌더링 호스트는 키를 절대 묻지 않는다고 안내해서 대응한다 (3.4).
- **렌더링 문서의 무한 루프·과도한 리소스 사용.** 해당 탭에만 영향을 준다.
- **렌더링 문서가 외부로 데이터를 보내는 것.** 문서가 접근할 수 있는 비밀 값이 없으므로 막지 않는다.

---

# 3. 인증 및 권한

## 3.1 접근 키

- 형식: `rb_` + base62 32자 (약 190bit 난수)
- DB에는 SHA-256 해시만 저장한다. 키 자체가 충분히 긴 난수이므로 느린 해시는 필요 없다.
- 식별용으로 앞 8자(`key_prefix`)를 저장해 목록과 로그에 쓴다.
- 키 원문은 발급할 때 터미널에 한 번만 출력하고, 어디에도 저장하지 않는다.
- 키는 삭제하지 않고 회수(`revoked_at`)만 한다. 문서의 등록자·수정자 기록을 보존하기 위해서다.

### 키 관리 CLI (`scripts/key.ts`)

키는 로컬에서 생성하고 해시를 계산한 뒤, `wrangler d1 execute`로 D1에 SQL을 실행한다. `--local`(로컬 D1)과 `--remote`(운영 D1)를 선택할 수 있다.

| 명령 | 설명 |
| --- | --- |
| `pnpm key create --name <이름> --role EDITOR\|VIEWER` | 키를 발급하고 원문을 1회 출력 |
| `pnpm key list` | 이름, 역할, prefix, 마지막 사용일, 회수 여부 |
| `pnpm key revoke <prefix>` | 회수하고 해당 키의 모든 세션 삭제 |
| `pnpm key set-role <prefix> EDITOR\|VIEWER` | 역할 변경 (다음 요청부터 즉시 반영) |

## 3.2 로그인 (관리 호스트)

1. `GET /login`: 키 입력란 하나만 있는 화면
2. `POST /login`: 키 해시로 조회한다. 유효하고 회수되지 않았으면 관리 세션을 발급하고 `last_used_at`을 갱신한다.
3. 렌더링 세션 핸드오프(3.4)를 거쳐 원래 페이지로 이동한다.
4. 실패하면 "키가 올바르지 않습니다"를 표시한다. 회수된 키도 같은 메시지를 쓴다.

로그인 요청 보호:

- 로그인 전에는 세션이 없으므로 CSRF 토큰 대신 `Origin == APP_ORIGIN`과 `Sec-Fetch-Site: same-origin`을 요구한다. 둘 중 하나라도 없거나 다르면 거부한다.
- IP 기준 속도 제한: 10분 안에 10회 실패하면 해당 IP에 30초간 429를 응답한다.
  - Worker는 요청 사이에 메모리 상태를 유지하지 않으므로, 실패 횟수는 D1 `login_failures` 테이블에 기록한다.
  - IP는 `CF-Connecting-IP` 헤더에서 읽는다. 로컬에서는 이 헤더가 없으므로 `127.0.0.1`로 취급한다.
  - 오래된 기록은 실패를 기록할 때 함께 지운다 (1일 경과분).
- 계정 잠금은 두지 않는다 ([decisions.md](decisions.md) D-20).

## 3.3 세션

| 항목 | 관리 세션 | 렌더링 세션 |
| --- | --- | --- |
| 쿠키 이름 | `__Host-rb_app` | `__Host-rb_render` |
| 쿠키 속성 | `HttpOnly; Secure; SameSite=Lax; Path=/` | 동일 |
| 만료 | 발급 후 30일 (절대 만료) | 동일 |
| CSRF 토큰 | 있음 | 없음 (렌더링 호스트에는 상태를 바꾸는 요청이 없음) |

- 세션 ID는 256bit 난수다. 쿠키에는 원문을, DB에는 SHA-256 해시를 저장한다.
- 매 요청마다 세션과 키를 함께 조회한다. 다음 경우에는 로그인 화면으로 보낸다.
  - `expires_at`이 지났다.
  - 키가 회수되었다.
- 역할도 매 요청 키에서 읽는다.
- **정리 작업은 Cron 없이 한다.** 로그인할 때 그 키의 만료된 세션을 함께 삭제한다. 만료된 세션은 조회 단계에서 거부되므로, 정리가 늦어져도 보안 문제는 없다.
- 마지막 접속 시각(`last_seen_at`)은 기록하지 않는다. 절대 만료만 쓰므로 필요가 없고, 요청마다 쓰기가 생기는 것을 피할 수 있다.
- 렌더링 세션은 핸드오프로만 만들어진다. 이때 근거가 된 관리 세션의 ID 해시를 `family_id`로 기록한다.
- 로그아웃(`POST /logout`)하면 같은 `family_id`의 세션(관리 + 렌더링)을 함께 삭제한다. 다른 기기의 세션은 유지된다.

## 3.4 렌더링 세션 핸드오프

렌더링 호스트에는 로그인 화면이 없다. 관리 호스트가 짧은 서명 토큰을 발급해 렌더링 세션을 만든다.

```
[경로 A: 로그인 직후]
POST app/login 성공
 → 303 app/auth/render?return=<관리 화면 경로>
 → 302 render/__auth?token=...&return=<APP_ORIGIN + 경로>
 → 렌더링 세션 쿠키 발급
 → 303 app/<경로>

[경로 B: 렌더링 세션 없이 렌더링 URL 접근]
GET render/<documentKey>
 → 302 app/auth/render?next=/<documentKey>
 → (관리 세션 없으면) 302 app/login?next=/auth/render?next=... → 로그인
 → 302 render/__auth?token=...&return=/<documentKey>
 → 렌더링 세션 쿠키 발급
 → 303 render/<documentKey>
```

모든 이동이 최상위 GET 내비게이션이다. 그래서 두 호스트가 서로 다른 사이트(`workers.dev`)여도 쿠키가 정상적으로 설정된다.

토큰:

- 형식: `base64url(payload) + "." + HMAC-SHA256(payload, HANDOFF_SECRET)` (Web Crypto)
- payload: `{ sid: 관리 세션 ID 해시, exp: 발급 후 60초, return }`
- 토큰 발급은 서버에 상태를 만들지 않는다. 따라서 `GET /auth/render`는 DB를 변경하지 않는다.
- 렌더링 호스트는 다음 순서로 처리한다.
  1. 서명과 만료를 검증한다.
  2. `sid`로 관리 세션과 키가 유효한지 확인한다.
  3. 렌더링 세션을 만든다.
- `return`은 렌더링 호스트의 상대 경로이거나, 출처가 정확히 `APP_ORIGIN`인 URL만 허용한다 (3.7 규칙으로 검증).
- 토큰은 URL에 담기지만 60초 후 만료된다. 렌더링 응답은 `Referrer-Policy: no-referrer`라서 토큰이 외부로 전달되지 않는다.

## 3.5 CSRF

- 관리 호스트의 모든 POST·PUT 요청은 세션의 CSRF 토큰을 검증한다.
  - 일반 폼: hidden input `_csrf`
  - 업로드 요청(JS `fetch`): `X-CSRF-Token` 헤더
- 추가로 `Origin == APP_ORIGIN`을 요구한다. `Origin`이 없거나 `null`이면 거부한다.
- 서비스 자신의 폼과 링크에는 `rel="noreferrer"`를 쓰지 않는다. `noreferrer`로 제출한 POST는 `Origin: null`이 된다.
- HTMX는 GET(목록 검색)에만 쓰므로 HTMX 요청에는 CSRF 토큰이 필요 없다.

## 3.6 Fetch Metadata 검사

브라우저가 붙이는 `Sec-Fetch-*` 헤더로 요청이 어디서 시작되었는지 판단해, 허용하지 않은 요청을 거부한다. 쿠키 전송 여부와 무관하게 동작하므로, 호스트가 같은 사이트이든 다른 사이트이든 똑같이 막는다.

**관리 호스트 (모든 경로):**

| 조건 | 처리 |
| --- | --- |
| `Sec-Fetch-Site` 헤더 없음 (구형 브라우저, CLI 도구) | 허용 |
| `same-origin` 또는 `none` (주소창 직접 입력, 북마크) | 허용 |
| `Sec-Fetch-Mode: navigate` + `GET` + `Sec-Fetch-Dest: document` | 허용 (메신저 링크 클릭, 핸드오프 복귀 등 최상위 이동) |
| 그 외 | 403 |

렌더링 문서(opaque origin)가 관리 호스트로 보내는 이미지·스크립트·fetch 요청은 `Sec-Fetch-Site: cross-site`이므로 모두 403이 된다. 다른 사이트가 보내는 POST(CSRF)도 같은 규칙으로 한 번 더 막힌다.

**렌더링 호스트:**

| 경로 | 허용 조건 |
| --- | --- |
| `GET /:documentKey`, `GET /__auth` | 헤더 없음, `same-origin`, `none`, 또는 `navigate` + `GET` + `document` |
| `GET /__box/*` (MVP 2) | 모두 허용 (opaque origin 문서가 스크립트로 불러옴) |

렌더링 문서가 렌더링 호스트의 다른 문서를 하위 요청으로 불러오는 것도 이 규칙으로 막힌다.

관리 호스트의 모든 응답에는 `Cross-Origin-Resource-Policy: same-origin`을 함께 적용한다.

## 3.7 리다이렉트 대상 검증 (`next`, `return`)

문자열 비교로 검증하지 않는다. 브라우저는 URL의 탭·개행 문자를 제거하므로 `/%09/evil.com` 같은 값이 문자열 검사를 통과한 뒤 `//evil.com`이 될 수 있다.

```
1. 제어 문자(\x00-\x1F, \x7F)가 있으면 거부
2. u = new URL(value, 기준 ORIGIN)
3. u.origin이 기준 ORIGIN과 다르면 거부
4. u.pathname이 허용 접두사로 시작하지 않으면 거부
5. 리다이렉트는 u.pathname + u.search로만 수행
```

| 위치 | 기준 ORIGIN | 허용 접두사 | 실패 시 이동 |
| --- | --- | --- | --- |
| 관리 `next` | `APP_ORIGIN` | `/html`, `/auth/render` | `/html` |
| 렌더링 `return` | `RENDER_ORIGIN` 또는 `APP_ORIGIN` | 렌더링: `/` (문서 경로) / 관리: `/html` | 관리 `/html` |

HTMX 요청 중 세션이 만료되면 `next`에는 요청 경로 대신 `HX-Current-URL` 헤더의 경로를 쓴다.

## 3.8 권한 검사

- 권한표는 [prd.md](prd.md) 3.3을 따르고, 라우트별 권한은 7.1 표를 기준으로 한다.
- 검사는 라우트 단위로 서버에서 한다. 화면에서 버튼을 숨기는 것은 편의 기능일 뿐 통제 수단이 아니다.

---

# 4. 문서 처리

## 4.1 document_key

- base62(`[0-9A-Za-z]`) 22자, 암호학적 난수 (약 131bit)
- 거부 샘플링(rejection sampling)으로 만들어 modulo bias를 없앤다.
- UNIQUE 충돌이 나면 새 값으로 1회 재시도하고, 다시 실패하면 500.
- 생성 후 변경하지 않는다. 렌더링 URL은 `RENDER_ORIGIN/{document_key}`다.
- `_`를 포함하지 않으므로 `__auth`, `__box` 같은 예약 경로와 충돌하지 않는다.

## 4.2 HTML 저장 구조: D1 청크

D1은 한 행에 약 2MB까지만 저장할 수 있다. 그래서 HTML 원본을 **1MB 청크**로 나누어 저장한다 ([decisions.md](decisions.md) D-27).

```
html_blobs   (id, size, created_by, created_at)   — HTML 원본 한 벌
html_chunks  (blob_id, seq, data BLOB ≤ 1MB)      — 원본을 1MB씩 나눈 조각
html_documents.blob_id → 현재 원본
```

- 원본은 바이트 그대로(UTF-8) 저장한다. 서버는 디코딩하지 않는다.
- 문서와 원본을 분리해 두면 HTML 교체가 "새 원본 업로드 → 문서가 가리키는 원본 변경 → 이전 원본 삭제" 순서가 된다. 그래서 교체 도중 실패해도 문서가 깨지지 않는다.
- **용량 관리:** 무료 플랜 D1은 DB 하나당 500MB다. 문서 크기는 `html_size`로 관리하며, 운영자는 `pnpm key list`와 함께 총 사용량을 확인할 수 있게 한다(`pnpm db:usage`). 400MB를 넘으면 목록 상단에 관리자용 경고를 표시한다.

## 4.3 업로드 (2단계)

10MB짜리 multipart 폼을 서버에서 파싱하면 CPU 시간 한도를 넘을 수 있다. 그래서 HTML 원본과 문서 정보를 **따로 보낸다** ([decisions.md](decisions.md) D-29).

```
1. 브라우저 JS: 파일 읽기 → 인코딩 판별·경고 검사 (4.6)
2. PUT /uploads   본문 = HTML 원본 바이트 그대로 (Content-Type: text/html)
   → 서버: 1MB씩 잘라 html_blobs + html_chunks에 저장
   → 응답: { uploadId, size }
3. 일반 폼 POST /html (또는 /html/:key)
   필드: _csrf, title, description, link_label[], link_url[], upload_id, version
   → 서버: 문서 저장, blob_id 연결 → 303
```

`PUT /uploads` 처리:

- 권한: EDITOR. CSRF 토큰은 `X-CSRF-Token` 헤더로 받고, Origin과 Fetch Metadata(`same-origin`)를 검사한다.
- 크기: `Content-Length`가 없거나 10MB를 넘으면 413을 반환한다. 본문을 읽으면서도 바이트 수를 세서, 10MB를 넘는 순간 중단한다.
- 본문 스트림을 읽어 1MB 단위로 모으고, 1MB가 찰 때마다 청크 행을 넣는다.
- NUL 바이트 검사: 청크마다 `Uint8Array.prototype.indexOf(0)`(네이티브)으로 확인하고, 발견하면 422를 반환한다.
- 빈 본문이면 422.
- 응답: `{ uploadId, size }`

**연결되지 않은 업로드 정리:** 업로드만 하고 저장하지 않은 원본이 남을 수 있다. Cron 없이, 같은 사용자가 다음에 업로드할 때 함께 정리한다. 기준은 그 사용자가 1시간 이전에 만들었고 어떤 문서도 가리키지 않는 원본이다.

폼 제출 시 `upload_id` 검증:

- 존재하고, 현재 사용자가 만들었고, 아직 어떤 문서에도 연결되지 않은 원본이어야 한다. 아니면 422.

## 4.4 입력 검증 (서버)

| 항목 | 규칙 | 실패 응답 |
| --- | --- | --- |
| 폼 본문 (`POST /html`, `/html/:key`) | 64KB 이하 (HTML 원본은 포함하지 않음) | 413 |
| 업로드 본문 (`PUT /uploads`) | 10MB 이하, 비어 있지 않음, NUL 없음 | 413 / 422 |
| 제목 | 공백 제외 1~200자 | 422 |
| 설명 | 최대 2,000자 | 422 |
| 링크 | 4.5 참고 | 422 |
| upload_id | 등록 시 필수. 수정 시에는 HTML을 교체할 때만 | 422 |

- 서버는 HTML **내용**을 필터링하거나 정화(sanitize)하지 않는다.
- 문자 인코딩 판별은 브라우저에서 한다 (4.6). 서버는 받은 바이트를 그대로 저장하고, 렌더링할 때 `charset=utf-8`로 응답한다.

## 4.5 링크

- 폼 필드 `link_label`과 `link_url`을 같은 순서로 반복해서 보낸다. 서버는 같은 인덱스끼리 짝지어 처리한다.
- 처리 규칙:
  - 링크는 선택 항목이다. URL이 비어 있거나 `http://`·`https://`만 있는 행은 이름이 있어도 오류 없이 버린다 (MCP·REST도 같다).
  - 링크가 10개를 넘으면 422.
  - 이름은 최대 100자, URL은 최대 1,000자.
  - URL은 `new URL()`로 파싱해 스킴이 `http:`/`https:`인 것만 허용한다.
- 저장: `links` 컬럼에 JSON 문자열(`[{ "label": "...", "url": "..." }]`)로, 입력 순서대로 저장한다. 수정할 때는 제출된 목록으로 통째로 교체한다.
- 출력: 이름이 비어 있으면 `new URL(url).hostname`을 표시하고, `<a href target="_blank" rel="noopener noreferrer">`로 렌더링한다.

## 4.6 브라우저 사전 처리 (등록·수정 화면 JS)

**파일을 선택했을 때:**

1. **크기 검사:** `file.size`가 10MB를 넘으면 중단한다.
2. **인코딩 판별:**
   - `new TextDecoder('utf-8', { fatal: true })`로 디코딩한다.
   - 실패하면 `new TextDecoder('euc-kr')`로 다시 디코딩하고, 변환했다고 안내한다.
   - 변환한 내용에 `<meta charset="euc-kr">`가 있으면 `utf-8`로 바꾼다.
3. **NUL 문자 검사:** NUL 문자가 있으면 중단한다.
4. **제목 자동 채움:** 제목이 비어 있으면 `<title>` 내용을 넣고, 없으면 확장자를 뺀 파일명을 넣는다.

**붙여넣기를 했을 때:** 텍스트 영역의 문자열을 그대로 쓴다. 이 경우 인코딩은 항상 UTF-8이다.

**경고 검사 (파일·붙여넣기 공통):** 정규식 기반 휴리스틱이며 오탐·미탐을 허용한다.

- `<script>`, `<link>`, `<source>`, `<video>`, `<audio>`의 `src`/`href`가 상대 경로인 경우. `http(s):`, `data:`, `blob:`, `//`, `#`, `mailto:`로 시작하지 않으면 상대 경로로 본다. `<img>`는 아래 이미지 연결에서 처리한다.
- `http:`로 시작하는 리소스 (`<img>` 포함)

**이미지 연결 (파일·붙여넣기 공통, D-31):**

- **대상:** `<script>` 블록과 주석을 뺀 마크업의 `<img src>` 중 상대·루트 경로인 값. 같은 값은 하나로 합친다. `${`, `{{`, `<%`가 들어간 템플릿 값은 제외한다.
- **입력:** 경로별 파일 선택, 또는 여러 파일을 한 번에 받아 파일명(경로의 마지막 부분, 대소문자 무시, `?`·`#` 제거)으로 자동 연결한다. HTML과 이미지를 함께 끌어다 놓아도 같다. `image/*`가 아닌 파일은 거부한다.
- **저장을 막지 않음:** 파일이 빠진 경로가 있어도 저장한다. 선택 수와 빈 상자가 될 수를 영역 아래에 표시한다. 서버는 이미지 경로를 검사하지 않는다.
- **변환:** 저장할 때 선택한 파일은 `FileReader.readAsDataURL`로 읽고, 선택하지 않은 경로는 파일명을 적은 400×300 회색 SVG(`data:image/svg+xml`)로 만든다. 해당 `<img>`의 `src` 값만 바꾸고 스크립트·주석 안의 텍스트는 바이트 그대로 둔다. 바꾼 결과가 10MB를 넘으면 업로드하지 않고 안내한다.
- **렌더링:** 렌더링 CSP의 `img-src`가 이미 `data:`를 허용하므로 서버 변경은 없다.

**저장 버튼을 눌렀을 때:**

1. HTML이 있으면 (이미지를 넣은 뒤) `TextEncoder`로 UTF-8 바이트로 만들어 `PUT /uploads`로 보낸다.
2. 응답의 `uploadId`를 hidden 필드 `upload_id`에 넣는다.
3. 폼을 일반 제출한다.

- 업로드가 실패하면 폼을 제출하지 않고 오류를 표시한다.
- 업로드 중에는 버튼을 비활성화하고 진행 상태를 표시한다.

JS가 꺼져 있으면 HTML을 업로드할 수 없다. 이 경우 정보 수정만 가능하며, 화면에 안내를 표시한다(`<noscript>`).

## 4.7 목록 쿼리

- `html_chunks`는 조회하지 않는다. 크기는 `html_size`를 쓴다.
- 제목 검색은 `title LIKE '%' || ? || '%' ESCAPE '\'`로 한다. 검색어의 `%`, `_`, `\`는 이스케이프한다. SQLite의 `LIKE`는 ASCII에 대해 대소문자를 구분하지 않는다.
- document_key 검색은 접두 일치로 한다.
- 정렬은 `updated_at DESC`, 페이지 크기는 20, 페이지네이션은 OFFSET 방식이다.

## 4.8 상세·수정·삭제

**상세:**

- HTML 원본을 상세 화면 HTML에 넣지 않는다.
- 원본은 `GET /html/:key/source`(`text/plain`, inline)와 `GET /html/:key/download`(`text/plain`, `Content-Disposition: attachment`)로만 제공한다. 둘 다 청크를 순서대로 이어 붙여 스트리밍한다.

**수정:**

- 기존 HTML을 수정 화면에 싣지 않는다.
- HTML 교체 여부는 `upload_id`가 있는지로 판단한다.
- 동시 수정 방지:
  - 폼에 hidden `version`을 넣는다.
  - `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ? RETURNING blob_id`로 갱신한다.
  - 갱신된 행이 없으면 409를 반환한다. 현재 수정자와 수정일을 보여주고, 입력한 값은 보존한다. 이때 새로 올린 원본은 연결되지 않은 업로드가 되어 이후에 정리된다.
- 성공했고 원본이 바뀌었다면, 이전 원본의 청크와 blob을 삭제한다(D1 batch).

**삭제:**

- `POST /html/:key/delete`로 처리한다. 문서, 원본, 청크를 D1 batch로 함께 삭제한다.
- 성공하면 303 → `/html?deleted=1`.

---

# 5. 렌더링

## 5.1 흐름

```
GET RENDER_ORIGIN/{documentKey}
1. Fetch Metadata 검사 (3.6)
2. 렌더링 세션 확인 → 없으면 핸드오프 (3.4 경로 B)
3. documentKey 형식 검사 (base62 22자) → 아니면 404
4. 문서와 blob_id 조회 → 없으면 404
5. ReadableStream으로 응답:
   - seq=0 청크를 읽고, 앞 64KB 안에서 스토리지 대체 스크립트 삽입 위치를 찾아 주입 (5.4)
   - seq=1부터는 한 청크씩 조회해 그대로 흘려보냄
6. 보안 헤더 적용 (5.2)
```

- 청크는 한 번에 하나씩 조회한다. 메모리에 1MB 이상 올리지 않는다.
- HTML은 템플릿 엔진을 거치지 않는다. 바이트 그대로 내보내고, 5.4의 스크립트만 삽입한다.
- 응답 압축은 Cloudflare 엣지가 처리한다. Worker CPU를 쓰지 않는다.

## 5.2 응답 헤더

렌더링 호스트의 **모든 응답**(200, 302, 404, 오류)에 미들웨어로 적용한다. 미들웨어는 `await next()` **이후에** 최종 응답의 헤더를 덮어쓴다. 그래야 오류 처리기가 새 응답 객체를 만들어도 헤더가 빠지지 않는다.

```
Content-Security-Policy:
  sandbox allow-scripts allow-forms allow-modals;
  default-src 'none';
  script-src 'unsafe-inline' 'unsafe-eval' https: blob:;
  style-src 'unsafe-inline' https:;
  img-src data: blob: https:;
  font-src data: https:;
  media-src data: blob: https:;
  connect-src https: wss:;
  worker-src blob:;
  frame-src https:;
  object-src 'none';
  base-uri 'none';
  form-action 'none';
  frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow
Cache-Control: no-store
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000
```

| 응답 | Content-Type |
| --- | --- |
| 문서 | `text/html; charset=utf-8` |
| 404·오류 | `text/plain; charset=utf-8` |
| `/__box/*` (MVP 2) | `text/javascript; charset=utf-8` |

- 렌더링 응답에는 `Set-Cookie`를 넣지 않는다. 세션을 발급하는 `/__auth`만 예외다.
- 로컬 개발(http)에서는 `Strict-Transport-Security`를 생략한다.
- 로컬 개발(`DEV_MODE=1`)에서는 `https:`를 허용하는 모든 지시어에 `http:`도 함께 허용한다. 로컬 두 호스트가 http라서, 그렇지 않으면 격리 테스트의 요청이 CSP에서 먼저 막혀 Fetch Metadata 검사를 검증할 수 없다. 운영 정책은 바뀌지 않는다.

### 정책 설명

| 항목 | 이유 |
| --- | --- |
| `sandbox`에 `allow-same-origin` 없음 | 문서가 opaque origin이 되어 렌더링 호스트의 쿠키와 스토리지에도 접근할 수 없다. **절대 추가하지 않는다** |
| `allow-forms` | JS로 처리하는 폼(`onsubmit` + `preventDefault`)이 동작하게 한다. 실제 전송은 `form-action 'none'`으로 막는다 |
| `allow-modals` | `alert`, `confirm` 사용 |
| `allow-popups` 없음 | 새 창 열기 차단 |
| 외부 HTTPS 스크립트·요청 허용 | CDN 허용 목록은 보안 경계가 아니다 ([decisions.md](decisions.md) D-08) |
| `frame-src https:` | 지도·영상 임베드 허용. 안쪽 iframe도 sandbox 제약을 물려받는다 |

## 5.3 격리 보장

| 시도 | 결과 | 막는 장치 |
| --- | --- | --- |
| 관리 화면 내용 읽기 | 불가 | 다른 출처(SOP, CORS) + Fetch Metadata 403 |
| 관리 호스트에 하위 요청 (`<img>`, fetch, 응답 시간 측정) | 403 | Fetch Metadata (쿠키 전송 여부와 무관) |
| 관리 기능 실행 (삭제 등) | 불가 | CSRF 토큰 + Origin + Fetch Metadata + `form-action 'none'` |
| 쿠키 읽기 | 불가 | opaque origin, 관리 쿠키는 host-only + HttpOnly |
| 다른 렌더링 문서 읽기 | 불가 | opaque origin + Fetch Metadata 403 |
| 관리 화면 창 조작 | 불가 | 관리 화면 COOP, 렌더링 문서 sandbox |
| meta 태그로 CSP 완화 | 불가 | meta CSP는 헤더 정책에 추가로 적용될 뿐이며, `sandbox`는 meta에서 무시된다 |
| 외부로 데이터 전송 | 가능 | 수용 |
| 가짜 입력 화면 표시 | 가능 | 수용 (렌더링 호스트는 키를 묻지 않는다는 안내, 주소창으로 구분) |

**장치 하나가 실패했을 때 남는 방어:**

- **CSP 헤더가 누락된 경우:** 문서가 렌더링 호스트 출처로 실행된다. 그래도 관리 호스트와는 출처가 달라서 관리 화면을 읽거나 조작할 수 없다. 렌더링 쿠키는 HttpOnly라서 읽을 수 없다.
- **브라우저가 Fetch Metadata를 지원하지 않는 경우:** 같은 사이트 구성에서는 하위 요청에 관리 쿠키가 실릴 수 있다. 그래도 응답을 읽을 수 없고, 상태 변경은 CSRF 토큰으로 막힌다.

## 5.4 스토리지 대체 스크립트

opaque origin에서는 `localStorage`·`sessionStorage`에 접근하면 예외가 발생한다. 서버가 메모리 기반 대체 구현을 문서 앞부분에 주입한다.

- **구현:** `Storage`와 같은 인터페이스(`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`)를 가진 메모리 객체를 `Object.defineProperty(window, 'localStorage', ...)`로 덮어쓴다. `sessionStorage`도 같게 처리한다.
- **주입 위치:** 첫 청크의 앞 64KB만 ASCII로 검사해서 다음 순서로 찾는다.
  1. 첫 `<head` 시작 태그가 닫히는 `>` 바로 뒤
  2. 없으면 `<!DOCTYPE ...>` 바로 뒤
  3. 그것도 없으면 문서 맨 앞
- `<!DOCTYPE>` 앞에는 넣지 않는다. 그 앞에 넣으면 쿼크 모드로 렌더링된다.
- **형식:** 사용자 데이터를 포함하지 않는 정적 문자열이다. 렌더링 CSP가 `'unsafe-inline'`을 허용하므로 인라인 스크립트로 넣는다.
- **실패 시:** 최선 노력(best-effort) 방식이다. 위치를 잘못 찾아도 보안에는 영향이 없다.
- **착수 시 검증 필요:** Chrome·Safari·Firefox에서 sandbox 문서의 `window.localStorage`를 덮어쓸 수 있는지 확인한다. 막히는 브라우저가 있으면 이 기능을 제외하고 안내 문구만 남긴다.

---

# 6. 데이터베이스 (D1)

시각은 모두 Unix epoch 밀리초(INTEGER)로 저장한다.

## 6.1 access_keys

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | INTEGER PK | |
| name | TEXT NOT NULL | 사용자 이름 (최대 100자) |
| role | TEXT NOT NULL | `EDITOR` / `VIEWER` |
| key_hash | TEXT UNIQUE NOT NULL | SHA-256 hex |
| key_prefix | TEXT NOT NULL | 식별용 앞 8자 |
| revoked_at | INTEGER | 회수 시각 |
| last_used_at | INTEGER | 마지막 로그인 |
| created_at | INTEGER NOT NULL | |

## 6.2 sessions

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | TEXT PK | 세션 ID의 SHA-256 hex |
| key_id | INTEGER NOT NULL | access_keys.id |
| host | TEXT NOT NULL | `APP` / `RENDER` |
| family_id | TEXT NOT NULL | 관리 세션 ID 해시 (관리 세션은 자기 자신) |
| csrf_token | TEXT | 관리 세션만 |
| expires_at | INTEGER NOT NULL | 발급 후 30일 |
| created_at | INTEGER NOT NULL | |

인덱스: `key_id`, `family_id`

## 6.3 login_failures

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| ip | TEXT NOT NULL | |
| at | INTEGER NOT NULL | 실패 시각 |

인덱스: `(ip, at)`. 실패를 기록할 때 1일이 지난 행을 함께 지운다.

## 6.4 html_blobs, html_chunks

| html_blobs | 타입 | 설명 |
| --- | --- | --- |
| id | INTEGER PK | |
| size | INTEGER NOT NULL | 전체 바이트 수 |
| created_by | INTEGER NOT NULL | access_keys.id |
| created_at | INTEGER NOT NULL | |

| html_chunks | 타입 | 설명 |
| --- | --- | --- |
| blob_id | INTEGER NOT NULL | html_blobs.id |
| seq | INTEGER NOT NULL | 0부터 |
| data | BLOB NOT NULL | 최대 1MB |

PK: `(blob_id, seq)`

## 6.5 html_documents

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | INTEGER PK | |
| document_key | TEXT UNIQUE NOT NULL | base62 22자 |
| title | TEXT NOT NULL | 최대 200자 |
| description | TEXT | 최대 2,000자 |
| links | TEXT NOT NULL DEFAULT '[]' | JSON 배열, 최대 10개 |
| blob_id | INTEGER NOT NULL | html_blobs.id (현재 원본) |
| html_size | INTEGER NOT NULL | 현재 원본의 바이트 수 (목록 표시용) |
| version | INTEGER NOT NULL DEFAULT 1 | 동시 수정 감지 |
| created_by | INTEGER NOT NULL | access_keys.id |
| updated_by | INTEGER NOT NULL | access_keys.id |
| created_at | INTEGER NOT NULL | |
| updated_at | INTEGER NOT NULL | |

인덱스: `document_key`(UNIQUE), `updated_at`, `blob_id`

## 6.6 마이그레이션

- 스키마는 `packages/db`의 Drizzle 정의로 관리하고, `drizzle-kit generate`로 SQL 마이그레이션을 만든다.
- 적용은 `wrangler d1 migrations apply`로 한다. 로컬은 `--local`, 운영은 `--remote`.

---

# 7. 라우팅 및 미들웨어

## 7.1 관리 호스트 (`apps/admin`)

| Method | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/` | - | 302 → `/html` |
| GET | `/healthz` | 없음 | 상태 확인 |
| GET | `/static/*` | 없음 | CSS·JS (Workers Static Assets) |
| GET | `/login` | 없음 | 로그인 화면 |
| POST | `/login` | 없음 | 로그인 (Origin 검사 + 속도 제한) |
| POST | `/logout` | 로그인 | 로그아웃 |
| GET | `/auth/render` | 로그인 | 핸드오프 토큰 발급 후 렌더링 호스트로 302 |
| PUT | `/uploads` | EDITOR | HTML 원본 업로드 (본문 10MB) |
| GET | `/html` | 전체 | 목록 (HTMX 요청이면 목록 조각만) |
| GET | `/html/new` | EDITOR | 등록 화면 |
| POST | `/html` | EDITOR | 등록 |
| GET | `/html/:key` | 전체 | 상세 |
| GET | `/html/:key/source` | 전체 | 원본 `text/plain` 표시 |
| GET | `/html/:key/download` | 전체 | 원본 다운로드 |
| GET | `/html/:key/edit` | EDITOR | 수정 화면 |
| POST | `/html/:key` | EDITOR | 수정 |
| POST | `/html/:key/delete` | EDITOR | 삭제 |

- `/html/new`는 `/html/:key`보다 먼저 등록한다.
- `/source`, `/download`는 `text/plain; charset=utf-8`과 `nosniff`로 응답한다. 관리 호스트는 사용자 HTML을 `text/html`로 절대 반환하지 않는다.
- `PUT /uploads`를 제외한 모든 요청은 본문을 64KB로 제한한다.

## 7.2 렌더링 호스트 (`apps/render`)

| Method | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/healthz` | 없음 | 상태 확인 |
| GET | `/__auth` | 토큰 | 핸드오프 → 렌더링 세션 발급 |
| GET | `/:documentKey` | 전체 | 렌더링 |
| 그 외 | | | 404 |

## 7.3 미들웨어 순서

**관리 호스트:**

```
1. 보안 헤더 (7.4, await next() 이후 덮어쓰기)
2. Fetch Metadata 검사 (3.6)
3. 세션 로드 (쿠키만 읽음, 본문 파싱 전)
4. 인증·권한 (라우트별)
5. 본문 크기 제한 (라우트별 10MB / 64KB)
6. CSRF·Origin 검사 (POST, PUT)
7. 핸들러
```

**렌더링 호스트:**

```
1. 렌더링 보안 헤더 (5.2, await next() 이후 덮어쓰기)
2. Fetch Metadata 검사
3. 세션 로드 및 인증 (/__auth, /healthz 제외)
4. 핸들러
```

- 인증을 본문 읽기보다 먼저 수행한다. 인증되지 않은 요청이 본문을 업로드하지 못하게 하기 위해서다.
- 보안 헤더 미들웨어를 가장 바깥에 두어 413·403·302·오류 응답에도 헤더가 붙게 한다.
- 정적 파일(`/static/*`)은 Workers Static Assets가 Worker 코드보다 먼저 응답한다. 그래서 정적 파일에는 7.4의 헤더가 붙지 않는다. 비밀 값이 없는 CSS·JS라 문제는 없지만, `_headers` 파일로 `X-Content-Type-Options: nosniff`는 지정한다.

## 7.4 관리 호스트 보안 헤더

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  font-src 'self';
  frame-src 'none';
  object-src 'none';
  base-uri 'none';
  form-action 'self' <RENDER_ORIGIN>;
  frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: same-origin
Cache-Control: no-store, no-transform
Strict-Transport-Security: max-age=31536000
```

- `form-action`에 `RENDER_ORIGIN`을 넣는다. 브라우저는 폼 제출 뒤 이어지는 리다이렉트에도 `form-action`을 적용하는데, 로그인 폼은 렌더링 호스트 핸드오프(3.4)로 리다이렉트되기 때문이다. 빠뜨리면 Chrome이 로그인 후 이동을 막는다(구현 중 확인).
- 관리 화면 응답은 **압축하지 않는다** ([decisions.md](decisions.md) D-14).
  - Cloudflare 엣지는 HTML 응답을 자동으로 압축한다.
  - `Cache-Control: no-transform`으로 압축을 막는다.
  - 배포 후 실제로 압축되지 않는지 확인한다 (9.4). 압축이 된다면 회사 도메인으로 옮길 때 Compression Rules로 끈다.
- 로컬 개발(http)에서는 `Strict-Transport-Security`를 생략한다.

## 7.5 상태 코드

| 코드 | 상황 |
| --- | --- |
| 200 | 정상 |
| 302 | 미인증 → 로그인, 핸드오프 이동 |
| 303 | POST 성공 후 이동 (PRG) |
| 401 | HTMX 요청 중 세션 만료 (`HX-Redirect` 헤더 동반) |
| 403 | 권한 없음, CSRF·Origin·Fetch Metadata 검사 실패 |
| 404 | 문서 없음, 알 수 없는 경로 |
| 409 | 동시 수정 충돌 |
| 413 | 본문 크기 초과 |
| 422 | 입력 검증 실패 (폼 재표시, 업로드는 JSON 오류) |
| 429 | 로그인 속도 제한 |
| 500 | 서버 오류 (내부 정보 노출 금지) |

---

# 8. 프론트엔드 규칙

## 8.1 HTMX

- 2.x 버전을 정적 파일로 자체 호스팅한다.
- **목록 검색과 페이지네이션에만** 쓴다. 등록·수정·삭제는 일반 폼과 PRG로 처리한다 ([decisions.md](decisions.md) D-12).
- 설정: `<meta name="htmx-config" content='{"allowEval":false,"includeIndicatorStyles":false,"selfRequestsOnly":true}'>`
- 검색 입력: `hx-get="/html" hx-trigger="input changed delay:300ms" hx-target="#list" hx-push-url="true" hx-sync="this:replace"`

## 8.2 JavaScript

- 모든 JS는 `/static/*`의 외부 파일로 둔다. 인라인 `<script>`와 인라인 이벤트 핸들러는 쓰지 않는다 (CSP `script-src 'self'`).
- 페이지별 초기값이 필요하면 `data-*` 속성으로 전달한다. CSRF 토큰도 `<meta name="csrf-token">` 또는 폼의 hidden 필드에서 읽는다.
- 쓰는 곳:
  - 파일 드롭, 인코딩 판별, 경고, 업로드 (4.6)
  - 링크 행 추가·삭제
  - `data-confirm` 삭제 확인
  - URL 복사
- 링크 행 추가·삭제는 JS가 꺼져 있어도 기본 1행은 동작하게 만든다.

## 8.3 화면 출력

- 모든 사용자 입력(제목, 설명, 링크 이름·URL, 사용자 이름)은 Hono JSX의 기본 이스케이프로 출력한다.

## 8.4 디자인

UI 디자인 가이드(토큰, 레이아웃, 컴포넌트, 문구)는 [ui.md](ui.md)를 따른다.

---

# 9. 운영

## 9.1 설정

| 이름 | 종류 | admin | render | 설명 |
| --- | --- | :---: | :---: | --- |
| `DB` | D1 바인딩 | O | O | 같은 D1 데이터베이스 |
| `APP_ORIGIN` | 변수 | O | O | 관리 호스트 출처 |
| `RENDER_ORIGIN` | 변수 | O | O | 렌더링 호스트 출처 |
| `HANDOFF_SECRET` | 시크릿 | O | O | 핸드오프 토큰 서명 키 (32바이트 이상 난수). 두 앱이 같은 값을 쓴다 |
| `DEV_MODE` | 변수 | O | O | 로컬에서만 `1` (9.2) |
| `API_ORIGIN` | 변수 | - | - | API 호스트 출처. api 앱만 쓴다 (api 앱은 `DB`, `APP_ORIGIN`, `RENDER_ORIGIN`도 쓰고 `HANDOFF_SECRET`은 쓰지 않는다) |

- 운영 시크릿은 `wrangler secret put`으로 등록한다.
- 로컬에서는 `.dev.vars` 파일을 쓰고, 이 파일은 저장소에 커밋하지 않는다.

## 9.2 로컬 개발

```
pnpm install
pnpm db:migrate:local      # 로컬 D1에 마이그레이션 적용
pnpm key create --local --name 개발자 --role EDITOR
pnpm dev                   # render(:8788) → admin(:8787) → api(:8789) 순서로 실행
```

- 주소: `http://app.localhost:8787`, `http://render.localhost:8788`, `http://api.localhost:8789` (MCP `/mcp`, REST `/api/v1`). Chrome과 Firefox는 `*.localhost`를 루프백 주소로 해석한다.
- 세 Worker가 같은 로컬 D1을 보도록 `wrangler dev --persist-to ../../.wrangler/state`로 상태 디렉터리를 공유한다.
- 동시에 띄우면 같은 SQLite 파일을 함께 열다가 `SQLITE_BUSY`로 실패한다. `scripts/dev.ts`가 앞 앱의 `/healthz`가 응답한 뒤 다음 앱을 띄운다. 디버거 포트도 앱마다 고정한다(9230~9232).
- `DEV_MODE=1`일 때만 다음을 완화한다.
  - 쿠키 이름의 `__Host-` 접두사와 `Secure` 속성을 생략한다.
  - HSTS를 끈다.
- `pnpm build:css`로 Tailwind CSS를 빌드한다. `pnpm dev`는 감시 모드로 함께 실행한다.

## 9.3 배포 (로컬 검증 후)

처음 한 번:

1. `wrangler d1 create render-box`로 D1 데이터베이스를 만들고, ID를 세 앱의 `wrangler.toml`에 넣는다.
2. 세 앱 `wrangler.toml`의 `APP_ORIGIN`, `RENDER_ORIGIN`, `API_ORIGIN`을 실제 주소(`https://<worker 이름>.<계정 서브도메인>.workers.dev`)로 바꾼다. 다른 호스트의 GET은 이 주소로 이동시키므로 틀리면 모든 화면이 열리지 않는다.
3. `HANDOFF_SECRET`을 admin과 render에 **같은 값**으로 `wrangler secret put`한다 (api는 쓰지 않는다).

배포할 때마다:

1. `pnpm db:migrate:remote` (새 마이그레이션이 없으면 아무것도 하지 않는다)
2. `pnpm deploy:prod`: render → admin → api 순서. admin은 배포 전에 CSS·HTMX를 빌드한다 (`build:assets`, 빌드 결과는 저장소에 없다).
   - `pnpm deploy`는 pnpm 내장 명령이라 스크립트 이름을 `deploy:prod`로 했다.
3. `pnpm check:headers` (9.4)
4. 처음이면 `pnpm key create --remote ...`로 첫 키를 발급한다.

## 9.4 배포 후 점검

`pnpm check:headers`(`scripts/check-headers.ts`)가 운영 URL에 실제 요청을 보내 확인한다. 주소는 각 앱의 `wrangler.toml`에서 읽는다.

- 세 호스트의 `/healthz`가 200이다.
- 렌더링 호스트의 404 응답에 CSP `sandbox`가 있고 `allow-same-origin`이 없다.
- 관리 호스트의 HTML 응답에 `Content-Encoding`이 없다 (`Accept-Encoding: gzip, br`로 요청).
- 관리·렌더링 응답에서 CSP 헤더가 정확히 1개고, HSTS가 있다.
- API의 `GET /mcp`는 405, 키 없는 REST 요청은 401이다.

## 9.5 로그·백업

- 로그인 실패, 속도 제한, 키 회수, Fetch Metadata 403을 `console.log`로 남기고 Workers Logs에서 확인한다. 키 원문과 세션 ID는 로그에 남기지 않는다.
- 백업은 D1 Time Travel(특정 시점 복구)을 쓴다. 무료 플랜의 보존 기간은 배포할 때 확인한다.
- 운영 환경의 오류 응답에는 스택 트레이스를 노출하지 않는다.

---

# 10. 테스트 계획

단위·통합 테스트는 `@cloudflare/vitest-pool-workers`로 실제 Workers 런타임과 로컬 D1에서 실행한다.

## 10.1 인증

- 유효한 키로 로그인하면 관리·렌더링 세션이 모두 생성된다.
- 잘못된 키와 회수된 키는 같은 실패 메시지를 받는다.
- 키를 회수하면 다음 요청부터 관리·렌더링 모두 즉시 로그아웃된다.
- 역할 변경이 다음 요청부터 반영된다.
- 만료된 세션(`expires_at` 경과)은 거부되고, 다음 로그인 때 삭제된다.
- 로그아웃하면 같은 family의 렌더링 세션도 삭제되고, 다른 기기의 세션은 유지된다.
- 로그인 POST에 `Origin`이 없거나 다른 출처면 거부된다.
- IP 속도 제한에 걸리면 429를 받는다.
- 핸드오프 토큰이 만료됐거나, 서명이 위조됐거나, 회수된 키의 세션이면 모두 거부된다.
- 세션 없이 렌더링 URL에 직접 접근하면 로그인 후 해당 문서로 돌아온다.
- `next`/`return` 우회 시도는 모두 기본 경로로 이동한다: `//evil.com`, `/%09/evil.com`, `/\evil.com`, `https://evil.com`, 허용 접두사 밖의 경로
- HTMX 검색 중 세션이 만료되면 401과 `HX-Redirect`를 받고, 로그인 후 원래 목록 URL로 돌아온다.

## 10.2 권한

- VIEWER가 등록·수정·삭제·업로드를 직접 호출하면 403을 받는다.
- VIEWER 화면에는 등록·수정·삭제 버튼이 없다.

## 10.3 문서 관리

- 파일 등록, 붙여넣기 등록, 제목 자동 채움이 동작한다.
- EUC-KR 파일이 UTF-8로 변환되어 한글이 정상 표시된다.
- 10MB를 넘는 파일은 브라우저에서 차단되고, 서버를 직접 호출하면 413을 받는다.
- `Content-Length`가 실제 본문보다 작게 거짓으로 적힌 업로드는 중단된다.
- 한글 위주의 9MB HTML을 등록할 수 있고, 원본이 바이트 단위로 동일하게 복원된다 (청크 경계 검증).
- 1MB, 1MB+1바이트, 정확히 10MB 크기에서 청크 분할과 복원이 정확하다.
- 상대 경로 스크립트·스타일과 `http:` 리소스는 경고가 표시되지만 저장할 수 있다.
- 상대 경로 `<img>`는 선택한 파일이면 `data:` 이미지로, 선택하지 않았으면 빈 상자 SVG로 저장된다. 스크립트·주석 안의 `<img>` 텍스트는 바뀌지 않는다.
- 다음은 422를 받는다: 제목 누락, 201자 제목, 2,001자 설명, NUL 포함 업로드, 다른 사용자의 `upload_id`, 이미 연결된 `upload_id`
- 링크:
  - 0개, 1개, 10개 저장 가능, 입력 순서 유지
  - 다음은 422: 11개, `javascript:` URL
  - 이름만 있고 URL이 없는 행, `https://`만 있는 행은 오류 없이 빠진다
  - 빈 행 무시, 이름이 없으면 호스트명으로 표시
- 수정:
  - 정보만 수정하면 원본과 `html_size`가 그대로다. HTML을 교체하면 갱신되고, 이전 원본의 청크는 삭제된다.
  - 링크 추가·삭제·순서 변경이 반영된다.
- 같은 `version`으로 두 번 저장하면 두 번째는 409를 받는다.
- 1시간이 지난 연결되지 않은 업로드는 다음 업로드 때 정리된다.
- 삭제 후 상세·렌더링은 404이고, 청크가 남지 않는다.
- 검색: 제목 부분 일치, 키 접두 일치, `%`·`_` 포함 검색어
- document_key: 형식(base62 22자), 분포 편향 없음, 충돌 시 재시도

## 10.4 렌더링

- HTML·CSS·JS가 실행되고 `alert`·`confirm`이 동작한다.
- `cdn.tailwindcss.com`, `esm.sh`, jsDelivr를 쓰는 문서가 정상 렌더링된다.
- JS로 처리하는 폼(`preventDefault`)은 동작하고, 실제 폼 전송은 차단된다.
- `localStorage.setItem`/`getItem`이 동작한다 (5.4 검증 결과에 따름).
- `<!DOCTYPE html>`로 시작하는 문서가 표준 모드로 렌더링된다 (주입 위치 검증).
- `<head>`가 첫 64KB 밖에 있는 문서도 깨지지 않는다 (문서 맨 앞에 주입).
- 여러 청크로 된 문서가 끊김 없이 이어져 렌더링된다.

## 10.5 보안 (격리)

**CI 필수 — 렌더링 호스트:** 200·302·404·500 응답 모두 CSP 헤더가 정확히 1개이고, `sandbox`가 있으며 `allow-same-origin`이 없다.

**CI 필수 — 관리 호스트:**

- 모든 응답에 렌더링 CSP가 없다.
- 어떤 경로도 사용자 HTML을 `text/html`로 반환하지 않는다.
- 화면에 인라인 `<script>`와 인라인 이벤트 핸들러가 없다.

**CI 필수 — 불변성:** `/auth/render`를 포함한 관리 호스트의 모든 GET 라우트는 호출 전후로 DB가 변하지 않는다. 렌더링 호스트에서는 세션을 발급하는 `/__auth`만 예외다.

**격리 검증 (Playwright, Chromium·Firefox·WebKit, 로컬 `wrangler dev`):**

다음 HTML을 등록하고 렌더링한다. 관리 앱에 테스트용 요청 기록 미들웨어를 두고(`DEV_MODE`에서만), **서버에 도착한 요청의 `Cookie`, `Sec-Fetch-Site`, 응답 코드**를 확인한다.

```
<script>
  fetch(APP + '/html', { credentials: 'include' });
  navigator.sendBeacon(APP + '/html');
  try { document.cookie } catch (e) { report('cookie-blocked') }
  try { localStorage.getItem('x') } catch (e) { report('storage-error') }
  window.opener && (window.opener.location = 'https://evil.example');
</script>
<img src="APP/html">
<script src="APP/html"></script>
<meta http-equiv="Content-Security-Policy" content="default-src *">
<form action="APP/html/xxx/delete" method="POST"><button>x</button></form>
```

| 확인 항목 | 기대 결과 |
| --- | --- |
| 관리 호스트로 간 하위 요청 (`fetch`, `sendBeacon`, `<img>`, `<script>`) | 모두 `Sec-Fetch-Site: cross-site`, 403 |
| 위 요청의 응답 | 렌더링 문서가 읽을 수 없음 |
| 관리 쿠키 전송 여부 | 기록만 한다 (Fetch Metadata가 막으므로 합격 기준이 아님) |
| `document.cookie` | 예외 |
| 폼 전송 | 차단 |
| `window.opener` | `null` |
| meta CSP | 정책 완화 없음 |

**릴리스 전 수동 점검:** Playwright WebKit은 실제 Safari와 다르므로, 위 항목을 실제 Safari에서 한 번 더 확인한다 ([decisions.md](decisions.md) D-34).

## 10.6 CPU 시간 실측 (1단계)

무료 플랜의 CPU 10ms 한도를 지킬 수 있는지 확인한다.

- **로컬:** `wrangler dev`는 CPU 한도를 강제하지 않는다. 대신 요청 처리에 쓴 CPU 시간을 측정해 기록한다. 대상은 1MB, 5MB, 10MB 문서의 업로드, 렌더링, 소스 다운로드다.
- **운영:** 배포 후 Workers 대시보드에서 요청별 CPU 시간 지표로 같은 항목을 확인한다.
- **판정:** 10MB가 한도 안이면 최대 크기를 10MB로 확정한다. 한도를 넘으면 한도 안에 드는 크기로 최대 크기를 낮추고 [prd.md](prd.md)에 반영한다.

---

# 11. API 서버 (`apps/api`): MCP와 REST

브라우저가 아닌 클라이언트가 개인 접근 키로 문서를 올리고 고치는 경로다. AI 클라이언트(Claude Code 등)는 MCP(`POST /mcp`), 스크립트·CI는 REST(`/api/v1`)를 쓴다 ([decisions.md](decisions.md) D-32, D-33). 두 경로는 인증과 문서 처리 코드(`src/service.ts`)를 함께 쓰고, 브라우저 화면과 같은 저장 구조·검증 규칙을 쓴다 (`packages/documents`).

## 11.1 전송 방식

- **Streamable HTTP, 상태 없음:** `POST /mcp` 하나가 JSON-RPC 메시지 하나를 받고, JSON 응답 하나를 돌려준다. SSE 스트림과 `Mcp-Session-Id`는 쓰지 않는다. `GET`·`DELETE /mcp`는 405.
- **지원 메서드:** `initialize`(프로토콜 `2025-06-18`, `2025-03-26`, `2024-11-05`), `ping`, `tools/list`, `tools/call`. 알림(id 없음)은 202. 일괄(배열) 요청은 받지 않는다.
- SDK 없이 직접 구현했다. 상태 없는 요청·응답만 필요하고, 무료 플랜 CPU 한도 안에서 가볍게 동작해야 하기 때문이다. 호환성은 공식 SDK 클라이언트로 검증한다 (11.6).

## 11.2 인증과 보호

- **인증:** `Authorization: Bearer rb_...` 헤더의 키를 매 요청마다 조회한다. 회수된 키는 바로 막힌다. 실패하면 401과 `WWW-Authenticate: Bearer`.
- **실패 횟수 제한:** 로그인과 같은 `login_failures` 테이블을 쓴다. 같은 IP에서 키 인증이 10번 실패하면 웹 로그인과 API(MCP·REST) 모두 30초 잠긴다.
- **Origin 검사:** MCP 클라이언트, curl, CI는 `Origin`을 보내지 않는다. `/mcp`와 `/api/*` 모두 `Origin`이 있고 `API_ORIGIN`이 아니면 403으로 거부해, 웹 페이지(렌더링 문서 포함)가 이 엔드포인트를 쓰지 못하게 한다. 브라우저에서 `Authorization` 헤더를 붙인 다른 출처 요청은 CORS 사전 요청에서도 막힌다(CORS 헤더를 주지 않는다).
- **쿠키를 쓰지 않으므로** CSRF 토큰은 필요 없다.
- **MCP 요청 크기:** 본문 약 2MB, HTML 1MB까지. 큰 JSON을 파싱하면 CPU 시간이 들기 때문에 웹 업로드(10MB)보다 작게 잡았다. 실측(10.6) 후 조정한다.
- 정식 주소가 아닌 호스트의 GET은 `API_ORIGIN`으로 이동시킨다 (관리·렌더링 앱과 같다).
- 응답은 `Cache-Control: no-store`.

## 11.3 도구

| 도구 | 권한 | 설명 |
| --- | --- | --- |
| `upload_html` | EDITOR | `title`, `html`, `description?`, `links?` → `document_key`, `render_url`, `admin_url` |
| `update_html` | EDITOR | `document_key`와 바꿀 항목만. 빠진 항목은 유지, 렌더링 URL은 그대로 |
| `list_html` | 전체 | `query?`, `page?` (20개씩). 웹 목록과 같은 검색 |
| `get_html` | 전체 | 문서 정보, `include_source: true`면 HTML 원본 (1MB 이하) |

- `tools/list`는 키 역할에 맞는 도구만 보여 준다. VIEWER에게는 `list_html`, `get_html`만 보인다. 호출 시에도 역할을 다시 검사한다.
- **삭제 도구는 없다.** 되돌릴 수 없는 작업은 웹 화면에서 사람이 확인하고 한다.
- **입력 검증:** 제목·설명·링크 규칙은 웹 화면과 같은 함수(`validateDocumentFields`)를 쓴다. 잘못된 입력, 없는 문서, 동시 수정 충돌은 `isError: true` 도구 결과로 돌려줘 AI가 고쳐서 다시 호출하게 한다. 프로토콜 오류(알 수 없는 도구 등)만 JSON-RPC 오류로 응답한다.
- **동시 수정:** `update_html`은 읽은 시점의 `version`으로 낙관적 잠금을 건다. 충돌하면 새로 올린 HTML을 지우고 "다시 시도" 결과를 돌려준다.
- **이미지:** MCP로 올리는 HTML은 그대로 저장한다. 같은 폴더 이미지 처리(4.6)는 하지 않는다. 대신 `initialize`의 안내문과 도구 설명에 "이미지는 data: URL이나 https 주소로 넣는다"를 적는다.
- `tools/call`과 REST 요청마다 `access_keys.last_used_at`을 갱신한다. MCP는 `{event: "mcp_tool", tool, keyId}`를 로그로 남긴다.

## 11.4 REST API (`/api/v1`)

스크립트·CI용. HTML은 **요청 본문 그대로**(raw bytes) 받아 디코딩 없이 1MB 청크로 저장한다 (4.3과 같은 `storeUpload`). JSON 파싱이 없어 CPU 시간이 크기에 비례해 늘지 않으므로 한도는 웹 업로드와 같은 10MB다.

| 요청 | 권한 | 응답 |
| --- | --- | --- |
| `POST /html?title=&description=&link=` | EDITOR | 201, `Location`, `ETag`, 문서 정보. `link`는 반복 가능, `이름\|주소` 또는 주소만 |
| `PUT /html/:key/source` | EDITOR | HTML 교체. 주소 유지 |
| `PATCH /html/:key` | EDITOR | JSON `{title?, description?, links?}` (64KB까지). 빠진 항목 유지, 빈 배열·빈 문자열은 지움 |
| `GET /html?q=&page=` | 전체 | 목록 20개씩 (웹 목록과 같은 검색) |
| `GET /html/:key` | 전체 | 문서 정보, `ETag: "<version>"` |
| `GET /html/:key/source` | 전체 | 원본 바이트. `application/octet-stream`, `Content-Disposition: attachment`, `CSP: sandbox`로 이 출처에서 실행되지 않게 한다 |

- **동시 수정:** `If-Match: "<version>"`을 보내면 버전이 다를 때 412(`version_mismatch`). 없으면 직전에 읽은 버전으로 낙관적 잠금만 건다 (충돌 시 409).
- **오류 형식:** `{"error": {"code", "message"}}`. 코드는 `unauthorized`, `locked`, `forbidden`, `invalid_fields`, `not_found`, `too_large`, `empty`, `nul_byte`, `conflict`, `version_mismatch`, `bad_if_match`, `bad_json`, `origin_not_allowed`.
- 크기: `Content-Length`가 10MB를 넘으면 본문을 읽기 전에 413. 길이 없는(chunked) 본문은 저장 중 10MB를 넘는 순간 중단하고 지운 청크를 정리한다.
- **삭제 API는 없다** (MCP와 같은 이유).
- 이미지 처리(4.6)는 하지 않는다. 올린 HTML을 그대로 저장한다.
- 버전은 경로(`/api/v1`)로 나눈다. 다른 `/api/*`는 404.

## 11.5 클라이언트 설정

Claude Code:

```sh
claude mcp add --transport http render-box https://render-box-api.<계정>.workers.dev/mcp \
  --header "Authorization: Bearer rb_..."
```

- 키는 클라이언트 설정 파일에 평문으로 저장된다. 잃어버리면 웹과 마찬가지로 회수하고 다시 발급한다.

## 11.6 테스트

- `e2e/mcp.spec.ts`: 공식 SDK 클라이언트(`@modelcontextprotocol/sdk`)로 연결한다.
  - EDITOR: 4개 도구 확인, 올리기 → 수정 → 원본 확인 → 목록 검색 → 렌더링 화면에서 실제 표시
  - VIEWER: 읽기 도구 2개만 보이고, 올리기는 도구 오류
  - 입력 오류, 1MB 초과, 없는 문서는 도구 오류
  - 틀린 키는 연결 실패, 브라우저 `Origin`은 403
- Claude Code에서 실제로 HTML을 만들어 올리고 렌더링되는 것을 확인했다.
- `e2e/api.spec.ts`: REST API.
  - 올리기(한글 제목·링크) → 정보·원본 바이트 확인(EUC-KR 그대로) → `If-Match`로 교체 → 오래된 버전은 412 → `PATCH` → 검색 → 렌더링 화면 표시
  - 3MB는 통과, 10MB 초과는 413
  - VIEWER 쓰기 403, 제목 없음·잘못된 링크 400, 빈 본문 422, 없는 문서·경로 404, 키 없음 401, 브라우저 `Origin` 403

---

# 12. MVP 2 설계 메모

MVP 1 완료 후 착수한다.

## 12.1 저장 전 미리보기

- 두 호스트가 다른 사이트(`workers.dev`)이면, 관리 화면에서 렌더링 호스트로 보내는 POST에는 렌더링 쿠키(`SameSite=Lax`)가 실리지 않는다. 그래서 핸드오프와 같은 방식의 **서명 토큰**으로 인증한다.
- 흐름:
  1. 미리보기할 HTML을 `PUT /uploads`로 올린다.
  2. 관리 앱이 `{ uploadId, keyId, exp: 60초 }`를 서명한 토큰을 발급한다.
  3. 새 창으로 `RENDER_ORIGIN/__preview?token=...`(GET)을 연다.
  4. 렌더링 앱이 토큰을 검증하고, 해당 업로드를 렌더링과 같은 헤더로 반환한다.
- 연결되지 않은 업로드는 4.3 규칙에 따라 정리된다.

## 12.2 플로팅 툴바

- **기능:** 문서 제목, 렌더링 URL 복사, 관리 화면 상세로 이동, 접기
- **주입:** 문서 **맨 끝**에 `<script src="/__box/toolbar.<hash>.js" data-...>`를 덧붙인다 ([decisions.md](decisions.md) D-16). 마지막 청크를 보낸 뒤 덧붙이면 되므로 CPU 부담이 없다.
- **`/__box/*` 응답:** `text/javascript`, 장기 캐시, `Cross-Origin-Resource-Policy: cross-origin`, 인증 없음
- **구현:**
  - 표준 Web API로 만든다. Custom Element를 등록하지 않는다.
  - host 요소를 `document.documentElement`에 붙이고 closed Shadow DOM을 쓴다.
  - host 요소에 인라인 스타일 `all: initial !important; position: fixed !important; z-index: 2147483647 !important`를 준다.
  - `data-*` 값은 `textContent`로만 출력한다.
  - 권한 있는 동작은 하지 않는다.
- `?bare=1`이면 툴바를 주입하지 않는다.

## 12.3 문서 복제

- `POST /html/:key/duplicate` (EDITOR)
- 원본 청크를 새 blob으로 복사하고, 새 document_key를 발급한다. 제목에 "(사본)"을 붙이고 링크도 복사한다.

---

# 13. 이후 확장 기술 메모

| 기능 | 메모 |
| --- | --- |
| 버전 관리 | HTML을 교체할 때 이전 blob을 지우지 않고 `html_document_versions(document_id, version, blob_id, ...)`로 남긴다. 저장 용량(D1 500MB)을 고려해 문서당 보관 개수를 제한한다 |
| 회사 도메인 | 도메인 DNS가 Cloudflare에 있으면 Workers Custom Domain을 연결하고 `APP_ORIGIN`/`RENDER_ORIGIN`만 바꾼다. 관리 화면 압축은 Compression Rules로 끈다 |
| 저장 용량 확장 | D1 용량이 부족해지면 HTML 원본을 R2로 옮긴다 (결제 수단 등록 필요). `html_blobs`에 저장 위치 컬럼을 추가한다 |
| 코드 에디터 (Monaco) | 원본은 페이지에 넣지 않고 `/html/:key/source`에서 받아 와 로드한다 |
| 비로그인 공개 | 문서별 공개 설정 |

---

# 14. 기술 원칙

1. 올라온 HTML은 신뢰하지 않는다. 걸러내지 않고 실행하되, 별도 호스트와 sandbox로 격리한다.
2. 격리를 한 가지 장치에 의존하지 않는다. 출처 분리, CSP sandbox, Fetch Metadata 중 하나가 실패해도 관리 화면은 안전해야 한다.
3. 사용자 HTML은 관리 화면 HTML에 절대 섞지 않는다. 원본은 렌더링 호스트(`text/html`)나 `text/plain`으로만 제공한다.
4. 인증과 권한은 서버에서 매 요청마다 확인한다.
5. 무료 플랜 안에서 동작한다. 서버는 큰 데이터를 해석하지 않고 자르고 이어 붙이기만 하며, 무거운 처리는 브라우저에서 한다.
6. 보안 헤더는 미들웨어로 강제하고, CI와 배포 후 점검으로 상시 검증한다.
