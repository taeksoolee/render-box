# render-box — 기술 설계

- 문서 상태: 확정 (MVP 1 착수 기준)
- 독자: 개발자
- 관련 문서:
  - [prd.md](prd.md) — 제품 요구사항 (기능, 화면, 문서 필드, 완료 기준)
  - [decisions.md](decisions.md) — 주요 결정과 기각한 대안

이 문서는 [prd.md](prd.md)의 요구사항을 **어떻게 구현하는지**를 다룬다. 기능 정의와 화면 구성은 prd.md를 기준으로 한다.

---

# 1. 시스템 구성

## 1.1 호스트

| 호스트 | 환경 변수 | 역할 | 예시 |
| --- | --- | --- | --- |
| 관리 | `APP_ORIGIN` | 로그인, 목록, 등록·수정·삭제, 상세, 소스 | `https://render-box.example.com` |
| 렌더링 | `RENDER_ORIGIN` | 사용자 HTML 반환만 | `https://view.render-box.example.com` |

- 두 호스트는 **출처(origin)는 다르고 사이트(site)는 같다**(같은 등록 도메인).
- 출처가 다르므로 브라우저의 동일 출처 정책(SOP)이 렌더링 문서와 관리 화면을 기본적으로 분리한다.
- 쿠키는 `__Host-` 접두사로 host-only가 되어 서로의 호스트로 전송되지 않는다.
- 사이트가 같아서 생기는 문제는 Fetch Metadata 검사로 막는다 (3.6). 하위 요청에 `SameSite=Lax` 쿠키가 실릴 수 있다는 점이 그 문제다.
- 렌더링 호스트를 완전히 다른 등록 도메인으로 두는 것도 가능하다. 다만 그러면 MVP 2 미리보기(11.1)에 서명 토큰이 추가로 필요하다. MVP는 와일드카드 인증서와 DNS 관리가 쉬운 서브도메인을 쓴다.

## 1.2 애플리케이션

- Node.js LTS + `@hono/node-server` 단일 프로세스로 실행한다.
- 요청의 `Host` 헤더로 관리 앱과 렌더링 앱을 나누어 라우팅한다. 알 수 없는 Host는 404.
- 두 앱의 미들웨어 체인은 **완전히 분리**한다. 관리 앱 CSP와 렌더링 CSP가 한 응답에 함께 붙으면 안 된다 (7.3).
- 리버스 프록시(TLS 종료) 뒤에서 실행한다. 프록시는 보안 헤더를 수정하거나 제거하지 않아야 한다 (9.3).

## 1.3 기술 스택

| 영역 | 기술 | 비고 |
| --- | --- | --- |
| Runtime | Node.js LTS | |
| Web | Hono | Host 기반 라우팅 |
| UI | Hono JSX (SSR) + HTMX 2.x | HTMX는 목록 검색·페이지네이션에만 사용 |
| CSS | Tailwind CSS | 빌드 시 정적 CSS 생성 |
| DB | PostgreSQL | |
| ORM | Drizzle ORM | |
| Validation | Zod | |
| 압축 | Hono `compress` (gzip) | 렌더링 응답과 정적 파일에만 적용 |
| 테스트 | Vitest, Playwright (Chromium) | |
| 배포 | Docker | |

---

# 2. 위협 모델

| 위협 주체 | 예시 | 대응 |
| --- | --- | --- |
| **신뢰할 수 없는 HTML 코드** (주 위협) | AI가 생성한 코드, 인터넷에서 복사한 코드, 오염된 CDN 패키지 | 렌더링 격리 (5장) |
| 키 유출 | 메신저나 문서에 키가 노출됨 | 개인별 키 즉시 회수, 세션 즉시 무효화 |
| 외부 사이트 | 로그인된 사용자를 노린 CSRF, 리다이렉트 악용 | CSRF 토큰, Origin·Fetch Metadata 검사, `next` 검증 |
| 같은 사이트의 다른 사내 서비스 | `*.example.com`의 다른 서비스 | host-only 쿠키, Origin 검사 |

**범위 밖 (수용한 위험):**

- 악의적인 EDITOR가 VIEWER를 노리는 경우. EDITOR는 신뢰하는 내부 인원으로 가정한다.
  - 이 경우에도 렌더링 문서는 격리되어 있어 키나 세션을 탈취할 수 없다.
  - 가능한 것은 가짜 입력 화면을 띄우는 정도다. 렌더링 호스트는 키를 절대 묻지 않는다고 안내해 대응한다 (3.4).
- 렌더링 문서의 무한 루프나 과도한 리소스 사용. 해당 탭에만 영향을 준다.
- 렌더링 문서가 외부로 데이터를 보내는 것. 문서가 접근할 수 있는 비밀 값이 없으므로 막지 않는다.

---

# 3. 인증 및 권한

## 3.1 접근 키

- 형식: `rb_` + base62 32자 (약 190bit 난수)
- DB에는 SHA-256 해시만 저장한다. 키가 충분히 긴 난수라서 bcrypt 같은 느린 해시는 필요 없다.
- 식별용으로 앞 8자(`key_prefix`)를 저장하고, 목록과 로그에서 이 값으로 키를 구분한다.
- 키 원문은 발급할 때 터미널에 한 번만 출력하고 어디에도 저장하지 않는다.
- 키는 삭제하지 않고 회수(`revoked_at`)만 한다. 문서의 등록자·수정자 기록을 보존하기 위해서다.

### 키 관리 CLI

| 명령 | 설명 |
| --- | --- |
| `key:create --name <이름> --role EDITOR\|VIEWER` | 키를 발급하고 원문을 1회 출력 |
| `key:list` | 이름, 역할, prefix, 마지막 사용일, 회수 여부 표시 |
| `key:revoke <prefix>` | 키를 회수하고 해당 키의 모든 세션 삭제 |
| `key:set-role <prefix> EDITOR\|VIEWER` | 역할 변경 (다음 요청부터 즉시 반영) |

최초 설치 시에는 운영자가 `key:create --role EDITOR`로 첫 키를 만든다. 별도 초기화 절차는 없다.

## 3.2 로그인 (관리 호스트)

1. `GET /login`: 키 입력란 하나만 있는 화면을 보여준다.
2. `POST /login`: 키 해시로 조회한다. 유효하고 회수되지 않은 키면 관리 세션을 발급하고 `last_used_at`을 갱신한다.
3. 렌더링 세션 핸드오프(3.4)를 거쳐 원래 페이지로 이동한다.
4. 실패하면 "키가 올바르지 않습니다"를 보여준다. 회수된 키도 같은 메시지를 쓴다.

로그인 요청 보호:

- 로그인 전에는 세션이 없어 CSRF 토큰을 쓸 수 없다. 대신 `Origin == APP_ORIGIN`이면서 `Sec-Fetch-Site: same-origin`인 요청만 받는다. 이 헤더가 없거나 값이 다르면 거부한다.
- IP 기준 속도 제한: 10분 안에 10회 실패하면 해당 IP에 30초 동안 429를 응답한다.
- 계정 잠금은 두지 않는다. 키는 추측이 불가능하고, 잠금은 사내 NAT 환경에서 전원을 잠그는 부작용만 있다.
- 리버스 프록시 뒤에서는 `TRUST_PROXY`가 설정된 경우에만 `X-Forwarded-For`를 IP로 쓴다. 운영 환경(`NODE_ENV=production`)에서 이 값이 없으면 서버가 시작을 거부한다.

## 3.3 세션

| 항목 | 관리 세션 | 렌더링 세션 |
| --- | --- | --- |
| 쿠키 이름 | `__Host-rb_app` | `__Host-rb_render` |
| 쿠키 속성 | `HttpOnly; Secure; SameSite=Lax; Path=/` | 동일 |
| 만료 | 발급 후 30일 (절대 만료) | 동일 |
| CSRF 토큰 | 있음 | 없음 (렌더링 호스트에는 상태를 바꾸는 요청이 없음) |

- 세션 ID는 256bit 난수다. 쿠키에는 원문을, DB에는 SHA-256 해시를 저장한다.
- 매 요청마다 세션과 키를 함께 조회한다. 키가 회수되었으면 세션을 삭제하고 로그인 화면으로 보낸다. 역할도 매 요청 키에서 읽는다.
- 렌더링 세션은 핸드오프로만 만든다. 이때 근거가 된 관리 세션의 ID 해시를 `family_id`에 기록한다.
- 로그아웃(`POST /logout`)하면 같은 `family_id`의 세션을 관리·렌더링 모두 삭제한다. 다른 기기의 세션은 유지된다.
- `last_seen_at`은 마지막 갱신 후 1분 이상 지난 요청에서만 갱신한다.

## 3.4 렌더링 세션 핸드오프

렌더링 호스트에는 로그인 화면이 없다. 대신 관리 호스트가 짧은 서명 토큰을 발급하고, 렌더링 호스트가 그 토큰으로 세션을 만든다.

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

토큰:

- 형식: `base64url(payload) + "." + HMAC-SHA256(payload, HANDOFF_SECRET)`
- payload: `{ sid: 관리 세션 ID 해시, exp: 발급 후 60초, return }`
- 토큰 발급은 서버에 상태를 만들지 않는다. 따라서 `GET /auth/render`는 DB를 변경하지 않는다.
- 렌더링 호스트는 다음 순서로 처리한다.
  1. 서명과 만료를 검증한다.
  2. `sid`로 관리 세션과 키가 유효한지 확인한다.
  3. 렌더링 세션을 만든다.
- `return`은 렌더링 호스트의 상대 경로이거나, 출처가 정확히 `APP_ORIGIN`인 URL만 허용한다. 검증은 3.7의 규칙을 따른다.
- 토큰은 URL에 담기지만 60초 뒤 만료된다. 렌더링 응답은 `Referrer-Policy: no-referrer`라서 토큰이 다른 사이트로 전달되지 않는다. 브라우저 방문 기록에는 남지만 만료 후에는 쓸 수 없다.

## 3.5 CSRF

- 관리 호스트의 모든 POST는 세션의 CSRF 토큰을 검증한다. 토큰은 폼의 hidden input(`_csrf`)으로 전달한다.
- 추가로 `Origin == APP_ORIGIN`을 요구한다. `Origin`이 없거나 `null`이면 거부한다.
- 서비스 자신의 폼과 링크에는 `rel="noreferrer"`를 쓰지 않는다. `noreferrer`로 제출한 POST는 `Origin: null`이 되어 위 검사에서 거부된다.
- HTMX는 GET(목록 검색)에만 쓰므로 HTMX 요청에는 CSRF 토큰이 필요 없다.

## 3.6 Fetch Metadata 검사

브라우저가 요청에 붙이는 `Sec-Fetch-*` 헤더로 요청이 어디서 시작됐는지 판단하고, 허용하지 않은 요청을 거부한다. 쿠키가 실렸는지와 무관하게 동작하므로, 브라우저마다 다른 쿠키 정책에 의존하지 않는다.

**관리 호스트 (모든 경로, `/healthz` 제외):**

| 조건 | 처리 |
| --- | --- |
| `Sec-Fetch-Site` 헤더 없음 (구형 브라우저, CLI 도구) | 허용 |
| `same-origin` 또는 `none` (주소창 직접 입력, 북마크) | 허용 |
| `Sec-Fetch-Mode: navigate` + `GET` + `Sec-Fetch-Dest: document` | 허용 (메신저 링크 클릭 등 최상위 이동) |
| 그 외 | 403 |

- 렌더링 문서(opaque origin)가 관리 호스트로 보내는 이미지·스크립트·fetch 요청에는 `Sec-Fetch-Site: cross-site`가 붙으므로 모두 403이 된다.
- 다른 사이트가 보내는 POST(CSRF)도 같은 규칙에 걸려 한 번 더 막힌다.

**렌더링 호스트:**

| 경로 | 허용 조건 |
| --- | --- |
| `GET /:documentKey`, `GET /__auth` | 헤더 없음, `same-origin`, `none`, 또는 `navigate` + `GET` + `document` |
| `GET /__box/*` (MVP 2) | 모두 허용 (opaque origin 문서가 스크립트로 불러옴) |
| `POST /__preview` (MVP 2) | 11.1 참고 |

렌더링 문서가 렌더링 호스트의 다른 문서를 하위 요청으로 불러오는 것도 이 규칙으로 막힌다.

관리 호스트의 모든 응답에는 `Cross-Origin-Resource-Policy: same-origin`도 함께 적용한다.

## 3.7 리다이렉트 대상 검증 (`next`, `return`)

문자열 비교로 검증하지 않는다. 브라우저는 URL에서 탭과 개행 문자를 제거하므로, `/%09/evil.com` 같은 값이 문자열 검사를 통과한 뒤 `//evil.com`이 될 수 있다.

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

HTMX 요청 중 세션이 만료되면 `next`에는 요청 경로가 아니라 `HX-Current-URL` 헤더의 경로를 쓴다. 요청 경로는 목록 조각(fragment)을 반환하는 경로이기 때문이다.

## 3.8 권한 검사

- 권한표는 [prd.md](prd.md) 3.3을 따르고, 라우트별 권한은 7.1 표를 기준으로 한다.
- 검사는 라우트 단위로 서버에서 한다. 화면에서 버튼을 숨기는 것은 편의 기능일 뿐 통제 수단이 아니다.

---

# 4. 문서 처리

## 4.1 document_key

- base62(`[0-9A-Za-z]`) 22자, 암호학적 난수 (약 131bit)
- 거부 샘플링(rejection sampling)으로 생성해 modulo bias를 없앤다.
- UNIQUE 충돌이 나면 새 값으로 1회 재시도하고, 다시 실패하면 500을 반환한다.
- 생성 후에는 변경하지 않는다. 렌더링 URL은 `RENDER_ORIGIN/{document_key}`다.
- `_`를 쓰지 않으므로 `__auth`, `__box`, `__preview` 같은 예약 경로와 충돌하지 않는다.

## 4.2 입력 검증 (서버)

| 항목 | 규칙 | 실패 응답 |
| --- | --- | --- |
| 요청 본문 | 11MB 이하 | 413 (안내 페이지) |
| 제목 | 공백 제외 1~200자 | 422 |
| 설명 | 최대 2,000자 | 422 |
| 링크 | 4.3 참고 | 422 |
| HTML | 비어 있지 않음, UTF-8 바이트 기준 10MB 이하, NUL 문자 없음 | 422 / 413 |

- 서버는 HTML **내용**을 필터링하거나 정화(sanitize)하지 않는다.
- 문자열 인코딩 검증은 서버에서 하지 않는다. `Request.formData()`가 텍스트 필드를 이미 디코딩하므로 서버에서는 의미가 없다. 인코딩 판별은 브라우저에서 처리한다 (4.4).

## 4.3 링크

- 폼 필드: `link_label`, `link_url`을 같은 순서로 반복해서 전송한다. 서버는 같은 인덱스끼리 짝지어 처리한다.
- 처리 규칙:
  - 이름과 URL이 모두 빈 행은 무시한다.
  - 이름만 있고 URL이 없으면 422를 반환한다.
  - 빈 행을 뺀 링크가 10개를 넘으면 422를 반환한다.
  - 이름은 최대 100자, URL은 최대 1,000자다.
  - URL은 `new URL()`로 파싱해 스킴이 `http:` 또는 `https:`인 것만 허용한다. `javascript:` 같은 스킴은 거부한다.
- 저장: `links` JSONB 배열(`[{ "label": "...", "url": "..." }]`)에 입력 순서대로 저장한다. 수정할 때는 제출된 목록으로 통째로 교체한다.
- 출력: 이름이 비어 있으면 `new URL(url).hostname`을 표시하고, `<a href target="_blank" rel="noopener noreferrer">`로 렌더링한다.

## 4.4 브라우저 사전 처리 (등록·수정 화면 JS)

파일을 선택했을 때 다음 순서로 처리한다.

1. **크기 검사:** `file.size`가 10MB를 넘으면 제출을 막는다.
2. **인코딩 판별:**
   - 먼저 `new TextDecoder('utf-8', { fatal: true })`로 디코딩한다.
   - 실패하면 `new TextDecoder('euc-kr')`로 다시 디코딩하고 변환 사실을 안내한다.
   - 변환한 내용에 `<meta charset="euc-kr">`가 있으면 `utf-8`로 바꾼다.
3. **제목 자동 채움:** 제목이 비어 있으면 `<title>` 내용을 넣고, `<title>`이 없으면 확장자를 뺀 파일명을 넣는다.
4. **필드 설정:** 디코딩한 문자열을 숨겨진 `<textarea name="html">`에 넣는다. 수정 화면에서는 `replace_html=1`도 함께 설정한다 (4.7).

파일과 붙여넣기 모두에 대해 경고 검사를 한다. 정규식 기반 휴리스틱이므로 오탐과 미탐이 있을 수 있다.

- `<img>`, `<script>`, `<link>`, `<source>`, `<video>`, `<audio>`의 `src`/`href`가 상대 경로인 경우를 찾는다. `http(s):`, `data:`, `blob:`, `//`, `#`, `mailto:`로 시작하지 않으면 상대 경로로 본다.
- `http:`로 시작하는 리소스를 찾는다.

## 4.5 전송

- 일반 HTML 폼으로 보낸다: `method="POST"`, `enctype="multipart/form-data"`. HTMX는 쓰지 않는다.
- urlencoded를 쓰지 않는 이유: UTF-8 바이트가 `%XX`로 인코딩되면서 본문이 최대 3배로 커진다.
- 성공하면 303으로 상세 화면 `?saved=1`로 이동한다 (PRG 패턴).
- 실패하면 422와 함께 폼을 다시 렌더링한다. 입력값은 보존하되 파일 입력은 비운다. 브라우저 제약상 파일 입력은 서버가 다시 채울 수 없다.

## 4.6 목록 쿼리

- `html_content`는 SELECT하지 않는다.
- 제목 검색은 `ILIKE '%' || ? || '%' ESCAPE '\'`로 한다. 검색어의 `%`, `_`, `\`는 이스케이프한다.
- document_key 검색은 접두 일치(`LIKE ? || '%'`)로 한다.
- 정렬은 `updated_at DESC`, 페이지 크기는 20, 페이지네이션은 OFFSET 방식이다.
- 문서 수가 수백 건 수준이므로 검색용 인덱스(pg_trgm 등)는 두지 않는다.

## 4.7 상세·수정·삭제

**상세**
- HTML 원본을 상세 화면 HTML에 넣지 않는다.
- 원본은 `GET /html/:key/source`(`text/plain`, inline)와 `GET /html/:key/download`(`text/plain`, `Content-Disposition: attachment`)로만 제공한다.

**수정**
- 기존 HTML을 수정 화면에 싣지 않는다. 그래서 잘린 내용이 저장될 경로가 없다.
- HTML 교체 여부는 hidden 필드 `replace_html`로 판단한다.
  - `replace_html=1`일 때만 `html` 필드를 검증하고 저장한다.
  - 그 외에는 `html` 필드를 무시한다.
- 동시 수정 방지:
  - 폼에 hidden `version` 필드를 넣는다.
  - `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?`로 갱신한다.
  - 갱신된 행이 없으면 409를 반환한다. 이때 현재 수정자와 수정일을 보여주고, 입력한 값은 보존한다.
- 성공하면 `updated_by`와 `updated_at`을 갱신하고, HTML을 교체했다면 `html_size`도 갱신한다.

**삭제**
- `POST /html/:key/delete`로 물리 삭제한다.
- 성공하면 303으로 `/html?deleted=1`로 이동한다.

---

# 5. 렌더링

## 5.1 흐름

```
GET RENDER_ORIGIN/{documentKey}
1. Fetch Metadata 검사 (3.6)
2. 렌더링 세션 확인 → 없으면 핸드오프 (3.4 경로 B)
3. documentKey 형식 검사 (base62 22자) → 아니면 404
4. html_content 조회 → 없으면 404
5. 스토리지 대체 스크립트 주입 (5.4)
6. 보안 헤더와 함께 반환 (gzip)
```

HTML은 템플릿 엔진을 거치지 않는다. 원본 문자열에 5.4의 스크립트만 삽입해 응답 본문으로 반환한다.

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
| `/__box/*` (MVP 2) | `text/javascript; charset=utf-8` (`nosniff` 때문에 정확히 일치해야 실행된다) |

- 렌더링 응답에는 `Set-Cookie`를 넣지 않는다. 세션을 발급하는 `/__auth`만 예외다.

### 정책 설명

| 항목 | 이유 |
| --- | --- |
| `sandbox`에 `allow-same-origin` 없음 | 문서가 opaque origin이 되어 렌더링 호스트의 쿠키와 스토리지에도 접근할 수 없다. **절대 추가하지 않는다** |
| `allow-forms` | JS로 처리하는 폼(`onsubmit` + `preventDefault`)이 동작하게 한다. 이 플래그가 없으면 submit 이벤트 자체가 발생하지 않는다. 실제 전송은 `form-action 'none'`으로 막는다 |
| `allow-modals` | `alert`, `confirm` 사용 |
| `allow-popups` 없음 | 새 창 열기 차단 |
| 외부 HTTPS 스크립트·요청 허용 | 문서는 이미 임의의 인라인 스크립트를 실행할 수 있으므로 CDN 허용 목록은 보안 경계가 아니다 ([decisions.md](decisions.md) D-08) |
| `frame-src https:` | 지도·영상 임베드를 허용한다. 안쪽 iframe도 sandbox 제약을 물려받는다 |
| `base-uri`, `object-src`, `form-action` 차단 | 동작에 필요 없는 위험 기능 제거 |

## 5.3 격리 보장

렌더링 문서의 코드가 할 수 있는 것과 없는 것:

| 시도 | 결과 | 막는 장치 |
| --- | --- | --- |
| 관리 화면 내용 읽기 | 불가 | 다른 출처(SOP, CORS) + Fetch Metadata 403 |
| 관리 호스트에 하위 요청 보내기 (`<img>`, fetch, 응답 시간 측정) | 403 | Fetch Metadata (쿠키 전송 여부와 무관) |
| 관리 화면 기능 실행 (삭제 등) | 불가 | CSRF 토큰 + Origin 검사 + Fetch Metadata + `form-action 'none'` |
| 쿠키 읽기 | 불가 | 렌더링 문서는 opaque origin, 관리 쿠키는 host-only + HttpOnly |
| 다른 렌더링 문서 읽기 | 불가 | opaque origin + Fetch Metadata 403 |
| 관리 화면 창 조작 | 불가 | 관리 화면 COOP, 렌더링 문서 sandbox |
| meta 태그로 CSP 완화 | 불가 | meta CSP는 헤더 정책에 추가로 적용될 뿐이고, `sandbox`는 meta에서 무시된다 |
| 외부로 데이터 전송 | 가능 | 수용 (문서가 접근할 수 있는 비밀이 없다) |
| 가짜 입력 화면 표시 | 가능 | 수용 (렌더링 호스트는 키를 묻지 않는다는 안내, 주소창으로 구분 가능) |

**장치 하나가 실패했을 때 남는 방어:**

- **CSP 헤더가 누락된 경우**
  - 문서가 렌더링 호스트 출처로 실행된다.
  - 관리 호스트와는 출처가 달라서 관리 화면을 읽거나 조작할 수 없다.
  - 렌더링 쿠키는 HttpOnly라서 읽을 수 없다.
  - 렌더링 호스트의 다른 문서는 읽을 수 있다. 다만 그 문서의 키를 알아야 한다.
- **브라우저가 Fetch Metadata를 지원하지 않는 경우**
  - 하위 요청에 관리 쿠키가 실릴 수 있다.
  - 그래도 응답을 읽을 수 없고, 상태 변경은 CSRF 토큰으로 막힌다.
  - 남는 위험은 응답 시간을 측정해 정보를 추측하는 정도다.

## 5.4 스토리지 대체 스크립트

opaque origin에서는 `localStorage`나 `sessionStorage`에 접근하면 예외가 발생한다. 서버가 메모리 기반 대체 구현을 문서 맨 앞에 주입해 이를 피한다.

- **구현:** `Storage`와 같은 인터페이스(`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`)를 가진 메모리 객체를 만들고, `Object.defineProperty(window, 'localStorage', ...)`로 덮어쓴다. `sessionStorage`도 같은 방식으로 처리한다.
- **주입 위치:**
  1. 첫 `<head>` 시작 태그 바로 뒤
  2. `<head>`가 없으면 `<!DOCTYPE>` 바로 뒤
  3. 둘 다 없으면 문서 맨 앞
- `<!DOCTYPE>` 앞에는 절대 넣지 않는다. 그러면 브라우저가 쿼크 모드로 렌더링한다.
- **형태:** 사용자 데이터가 들어가지 않는 정적 문자열이다. 렌더링 CSP가 `'unsafe-inline'`을 허용하므로 인라인 스크립트로 넣는다.
- **실패 시:** 주입은 최선 노력(best-effort) 방식이다. 위치 탐색이 틀려도 보안에는 영향이 없다.
- **착수 시 검증 필요:** Chrome·Safari·Firefox에서 sandbox 문서의 `window.localStorage`를 덮어쓸 수 있는지 확인한다. 막히는 브라우저가 있으면 이 기능을 빼고 안내 문구만 남긴다.

---

# 6. 데이터베이스

## 6.1 access_keys

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | BIGINT PK | |
| name | VARCHAR(100) NOT NULL | 사용자 이름 |
| role | VARCHAR(10) NOT NULL | `EDITOR` / `VIEWER` |
| key_hash | CHAR(64) UNIQUE NOT NULL | SHA-256 hex |
| key_prefix | VARCHAR(12) NOT NULL | 식별용 앞 8자 |
| revoked_at | TIMESTAMPTZ | 회수 시각 |
| last_used_at | TIMESTAMPTZ | 마지막 로그인 |
| created_at | TIMESTAMPTZ NOT NULL | |

## 6.2 sessions

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | CHAR(64) PK | 세션 ID의 SHA-256 hex |
| key_id | BIGINT FK NOT NULL | access_keys.id |
| host | VARCHAR(10) NOT NULL | `APP` / `RENDER` |
| family_id | CHAR(64) NOT NULL | 관리 세션 ID 해시 (관리 세션은 자기 자신) |
| csrf_token | CHAR(43) | 관리 세션만 |
| expires_at | TIMESTAMPTZ NOT NULL | 발급 후 30일 |
| last_seen_at | TIMESTAMPTZ NOT NULL | |
| created_at | TIMESTAMPTZ NOT NULL | |

인덱스: `key_id`, `family_id`, `expires_at`. 만료된 세션은 하루 한 번 삭제한다.

## 6.3 html_documents

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | BIGINT PK | |
| document_key | CHAR(22) UNIQUE NOT NULL | |
| title | VARCHAR(200) NOT NULL | |
| description | VARCHAR(2000) | |
| links | JSONB NOT NULL DEFAULT '[]' | `[{ "label": "기획서", "url": "https://..." }]`, 최대 10개 |
| html_content | TEXT NOT NULL | 최대 10MB, TOAST 자동 압축 |
| html_size | INTEGER NOT NULL | UTF-8 바이트 수 |
| version | INTEGER NOT NULL DEFAULT 1 | 동시 수정 감지 |
| created_by | BIGINT FK NOT NULL | access_keys.id |
| updated_by | BIGINT FK NOT NULL | access_keys.id |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

- 인덱스: `document_key`(UNIQUE), `updated_at`
- 링크는 항상 문서와 함께 읽고 쓰며 링크 단위로 검색하지 않는다. 그래서 별도 테이블 대신 JSONB 컬럼에 둔다. 형식 검증은 서버(Zod)에서 한다.

---

# 7. 라우팅 및 미들웨어

## 7.1 관리 호스트 (`APP_ORIGIN`)

| Method | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/` | - | 302 → `/html` |
| GET | `/healthz` | 없음 | 상태 확인 (Fetch Metadata 검사 제외) |
| GET | `/static/*` | 없음 | CSS·JS |
| GET | `/login` | 없음 | 로그인 화면 |
| POST | `/login` | 없음 | 로그인 (Origin 검사 + 속도 제한) |
| POST | `/logout` | 로그인 | 로그아웃 |
| GET | `/auth/render` | 로그인 | 핸드오프 토큰을 발급하고 렌더링 호스트로 302 |
| GET | `/html` | 전체 | 목록 (HTMX 요청이면 목록 조각만 반환) |
| GET | `/html/new` | EDITOR | 등록 화면 |
| POST | `/html` | EDITOR | 등록 (본문 11MB) |
| GET | `/html/:key` | 전체 | 상세 |
| GET | `/html/:key/source` | 전체 | 원본을 `text/plain`으로 표시 |
| GET | `/html/:key/download` | 전체 | 원본 다운로드 |
| GET | `/html/:key/edit` | EDITOR | 수정 화면 |
| POST | `/html/:key` | EDITOR | 수정 (본문 11MB) |
| POST | `/html/:key/delete` | EDITOR | 삭제 |

- `/html/new`는 `/html/:key`보다 먼저 등록한다.
- `/source`와 `/download`는 `text/plain; charset=utf-8`과 `nosniff`로 응답한다. 관리 호스트는 사용자 HTML을 `text/html`로 절대 반환하지 않는다.
- 본문 11MB가 허용되는 두 라우트를 제외한 모든 요청은 본문을 64KB로 제한한다.

## 7.2 렌더링 호스트 (`RENDER_ORIGIN`)

| Method | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/healthz` | 없음 | 상태 확인 |
| GET | `/__auth` | 토큰 | 핸드오프 토큰으로 렌더링 세션 발급 |
| GET | `/:documentKey` | 전체 | 렌더링 |
| 그 외 | | | 404 |

## 7.3 미들웨어 순서

**관리 호스트:**

```
1. 보안 헤더 (7.4, await next() 이후 덮어쓰기)
2. Fetch Metadata 검사 (3.6)
3. 세션 로드 (쿠키만 읽음, 본문 파싱 전)
4. 인증·권한 (라우트별)
5. 본문 크기 제한 (라우트별 11MB / 64KB)
6. CSRF·Origin 검사 (POST)
7. 핸들러
```

**렌더링 호스트:**

```
1. 렌더링 보안 헤더 (5.2, await next() 이후 덮어쓰기)
2. gzip 압축
3. Fetch Metadata 검사
4. 세션 로드 및 인증 (/__auth, /healthz 제외)
5. 핸들러
```

- 인증을 본문 파싱보다 먼저 수행한다. 그래야 인증되지 않은 요청이 서버에 11MB를 버퍼링시키지 못한다.
- 보안 헤더 미들웨어를 가장 바깥에 두어 413·403·302·오류 응답에도 헤더가 붙게 한다.
- 두 호스트의 체인은 Host 분기 이후에 각각 구성하고 서로 공유하지 않는다. 따라서 모든 응답의 CSP 헤더는 정확히 1개다.

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
  form-action 'self';
  frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: same-origin
Strict-Transport-Security: max-age=31536000
```

- 관리 호스트 응답은 **압축하지 않는다**. 이유는 [decisions.md](decisions.md) D-14 참고.
- 정적 파일(`/static/*`)은 비밀 값이 없으므로 압축하고 오래 캐시한다. 파일명에 내용 해시를 넣는다.

## 7.5 상태 코드

| 코드 | 상황 |
| --- | --- |
| 200 | 정상 |
| 302 | 미인증 → 로그인, 핸드오프 이동 |
| 303 | POST 성공 후 이동 (PRG) |
| 401 | HTMX 요청 중 세션 만료 (`HX-Redirect` 헤더 동반) |
| 403 | 권한 없음, CSRF·Origin·Fetch Metadata 검사 실패 |
| 404 | 문서 없음, 알 수 없는 경로·Host |
| 409 | 동시 수정 충돌 |
| 413 | 본문 크기 초과 (안내 페이지) |
| 422 | 입력 검증 실패 (폼 재표시) |
| 429 | 로그인 속도 제한 |
| 500 | 서버 오류 (내부 정보 노출 금지) |

---

# 8. 프론트엔드 규칙

## 8.1 HTMX

- 2.x 버전을 정적 파일로 자체 호스팅한다.
- **목록 검색과 페이지네이션에만** 쓴다. 등록·수정·삭제는 일반 폼과 PRG 패턴으로 처리한다 ([decisions.md](decisions.md) D-12).
- 설정: `<meta name="htmx-config" content='{"allowEval":false,"includeIndicatorStyles":false,"selfRequestsOnly":true}'>`
- 검색 입력: `hx-get="/html" hx-trigger="input changed delay:300ms" hx-target="#list" hx-push-url="true" hx-sync="this:replace"`

## 8.2 JavaScript

- 모든 JS는 `/static/*` 아래 외부 파일로 둔다. 인라인 `<script>`와 인라인 이벤트 핸들러(`onclick=` 등)는 쓰지 않는다 (CSP `script-src 'self'`).
- 페이지별 초기값이 필요하면 `data-*` 속성으로 전달한다.
- JS를 쓰는 곳:
  - 파일 드롭, 인코딩 판별, 경고 표시 (4.4)
  - 링크 행 추가·삭제
  - `replace_html` 설정 (4.7)
  - `data-confirm` 속성을 읽어 삭제 전 확인
  - URL 복사
- 링크 행 추가·삭제는 JS가 꺼져 있어도 기본 1행은 동작하도록 만든다.

## 8.3 화면 출력

- 모든 사용자 입력(제목, 설명, 링크 이름·URL, 사용자 이름)은 Hono JSX의 기본 이스케이프로 출력한다.

---

# 9. 운영

## 9.1 환경 변수

| 변수 | 설명 |
| --- | --- |
| `APP_ORIGIN` | 관리 호스트 출처 |
| `RENDER_ORIGIN` | 렌더링 호스트 출처 |
| `DATABASE_URL` | PostgreSQL 연결 |
| `HANDOFF_SECRET` | 핸드오프 토큰 서명 키 (32바이트 이상 난수) |
| `TRUST_PROXY` | 신뢰할 프록시 (운영 필수) |
| `NODE_ENV` | `production` / `development` |

## 9.2 로컬 개발

- 호스트는 `http://app.localhost:3000`과 `http://render.localhost:3000`을 쓴다. Chrome과 Firefox는 `*.localhost`를 루프백 주소로 해석한다.
- `NODE_ENV=development`일 때만 다음을 완화한다.
  - 쿠키 이름의 `__Host-` 접두사를 생략한다.
  - 쿠키의 `Secure` 속성을 생략한다.
  - HSTS를 끈다.
- 개발용 시드: `key:create`로 EDITOR 키와 VIEWER 키를 하나씩 만든다.

## 9.3 배포

- Docker 이미지 하나로 컨테이너 하나를 띄우고, PostgreSQL과 함께 운영한다.
- 리버스 프록시가 TLS를 종료하고 두 호스트의 요청을 같은 컨테이너로 전달한다.
- 프록시 요구사항:
  - 애플리케이션이 붙인 보안 헤더를 수정하거나 제거하지 않는다. nginx `add_header`가 상위 헤더를 덮어쓰지 않는지 확인한다.
  - 관리 호스트 응답을 압축하지 않는다 (7.4).
  - 요청 본문 제한을 11MB 이상으로 설정한다.

## 9.4 배포 후 헤더 점검

배포 파이프라인의 마지막 단계에서 운영 환경에 실제 요청을 보내 다음을 확인한다.

- 렌더링 호스트 404 응답에 CSP `sandbox`가 있고 `allow-same-origin`이 없다.
- 관리 호스트 응답에 `Content-Encoding`이 없다.
- 두 호스트의 모든 응답에서 CSP 헤더가 정확히 1개다.

## 9.5 로그·백업

- 로그인 실패, 속도 제한, 키 회수, Fetch Metadata 403을 로그로 남긴다. 키 원문과 세션 ID는 로그에 남기지 않는다.
- PostgreSQL은 매일 백업한다.
- 운영 환경의 오류 응답에는 스택 트레이스를 노출하지 않는다.

---

# 10. 테스트 계획

## 10.1 인증

- 유효한 키로 로그인하면 관리·렌더링 세션이 모두 생성된다.
- 잘못된 키와 회수된 키는 같은 실패 메시지를 받는다.
- 키를 회수하면 다음 요청에서 관리·렌더링 모두 즉시 로그아웃된다.
- 역할 변경이 다음 요청부터 반영된다.
- 로그아웃하면 같은 family의 렌더링 세션도 삭제되고, 다른 기기의 세션은 유지된다.
- 로그인 POST에 `Origin`이 없거나 다른 출처면 거부된다.
- IP 속도 제한에 걸리면 429가 반환된다.
- 핸드오프 토큰이 만료(60초 경과)됐거나, 서명이 위조됐거나, 회수된 키의 세션이면 모두 거부된다.
- 세션 없이 렌더링 URL에 직접 접근하면 로그인 후 해당 문서로 돌아온다.
- `next`/`return` 우회 시도는 모두 기본 경로로 이동한다: `//evil.com`, `/%09/evil.com`, `/\evil.com`, `https://evil.com`, 허용 접두사 밖의 경로.
- HTMX 검색 중 세션이 만료되면 401과 `HX-Redirect`가 반환되고, 로그인 후 원래 목록 URL로 돌아온다.

## 10.2 권한

- VIEWER가 등록·수정·삭제 POST를 직접 호출하면 403이 반환된다.
- VIEWER 화면에는 등록·수정·삭제 버튼이 없다.

## 10.3 문서 관리

- 파일 등록, 붙여넣기 등록, 제목 자동 채움이 동작한다.
- EUC-KR 파일은 UTF-8로 변환되어 한글이 정상 표시된다.
- 10MB 초과 파일은 브라우저에서 차단되고, 서버를 직접 호출하면 413이 반환된다.
- 한글 위주 9MB HTML을 등록할 수 있다.
- 상대 경로 이미지와 `http:` 리소스는 경고가 표시되지만 저장은 가능하다.
- 다음 입력은 422가 반환된다: 제목 누락, 201자 제목, 2,001자 설명, NUL 문자 포함.
- 링크:
  - 0개, 1개, 10개를 저장할 수 있고 입력 순서가 유지된다.
  - 다음은 422가 반환된다: 11개, `javascript:` URL, 이름만 있고 URL 없음, 1,001자 URL.
  - 빈 행은 무시된다.
  - 이름이 없으면 호스트명으로 표시된다.
- 수정:
  - 정보만 수정하면 HTML과 `html_size`가 바뀌지 않는다.
  - HTML을 교체하면 HTML과 `html_size`가 갱신된다.
  - 링크 추가·삭제·순서 변경이 그대로 반영된다.
- 같은 `version`으로 두 번 저장하면 두 번째는 409가 반환된다.
- 삭제 후 상세와 렌더링은 404가 반환된다.
- 검색: 제목 부분 일치, 키 접두 일치, `%`·`_`가 포함된 검색어가 모두 정상 동작한다.
- document_key는 base62 22자 형식이고, 분포에 편향이 없으며, 충돌 시 재시도한다.

## 10.4 렌더링

- HTML·CSS·JS가 실행되고 `alert`·`confirm`이 동작한다.
- `cdn.tailwindcss.com`, `esm.sh`, jsDelivr를 쓰는 문서가 정상 렌더링된다.
- JS로 처리하는 폼(`preventDefault`)은 동작하고, 실제 폼 전송은 차단된다.
- `localStorage.setItem`과 `getItem`이 동작한다. 단, 5.4 검증 결과에 따라 달라질 수 있다.
- `<!DOCTYPE html>`로 시작하는 문서가 표준 모드로 렌더링된다 (주입 위치 검증).

## 10.5 보안 (격리)

**CI 필수 — 렌더링 호스트:** 200·302·404·500 응답 모두 CSP 헤더가 정확히 1개이고, `sandbox`가 있으며 `allow-same-origin`이 없다.

**CI 필수 — 관리 호스트:**
- 모든 응답에 렌더링 CSP와 `Content-Encoding`이 없다.
- 어떤 경로도 사용자 HTML을 `text/html`로 반환하지 않는다.
- 화면에 인라인 `<script>`와 인라인 이벤트 핸들러가 없다.

**CI 필수 — 불변성:** 모든 GET 라우트를 호출하기 전후로 `access_keys`와 `html_documents` 테이블이 변하지 않는다. `sessions.last_seen_at` 갱신은 예외다.

**격리 검증 (Playwright, Chromium 자동화):**

다음 HTML을 등록하고 렌더링한다. 관리 호스트에는 테스트용 요청 기록 미들웨어를 둔다(개발 환경 한정). 이 미들웨어로 **서버에 도착한 요청의 `Cookie`, `Sec-Fetch-Site`, 응답 코드**를 확인한다.

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
| 관리 쿠키 전송 여부 | 기록만 함 (Fetch Metadata가 막으므로 합격 기준 아님) |
| `document.cookie` | 예외 |
| 폼 전송 | 차단 |
| `window.opener` | `null` |
| meta CSP | 정책 완화 없음 |

**릴리스 전 수동 점검:** 위 항목을 Safari와 Firefox에서 직접 확인한다. Playwright의 WebKit은 실제 Safari와 다르므로 자동화로 대체하지 않는다.

---

# 11. MVP 2 설계 메모

MVP 1 완료 후 착수한다. 아래는 검토 과정에서 확정한 결정이며, 착수할 때 상세화한다.

## 11.1 저장 전 미리보기

- 등록·수정 화면에서 다음 폼으로 제출한다: `<form method="POST" action="RENDER_ORIGIN/__preview" enctype="multipart/form-data" target="_blank" rel="noopener">`
- 두 호스트는 같은 사이트이므로 렌더링 세션 쿠키(`SameSite=Lax`)가 함께 전송된다.
- 렌더링 호스트는 다음을 모두 검증한다.
  - 렌더링 세션이 있고 역할이 EDITOR
  - `Origin == APP_ORIGIN`
  - `Sec-Fetch-Site: same-site` + `Sec-Fetch-Mode: navigate`
  - 본문 11MB 이하
- 렌더링과 같은 헤더와 대체 스크립트를 적용한다. 내용은 저장하지 않고 `no-store`로 응답한다.
- 관리 호스트 CSP의 `form-action`에 `RENDER_ORIGIN`을 추가한다.
- 렌더링 세션이 없으면 401 안내 페이지("관리 화면에서 다시 로그인해 주세요")를 띄운다. 로그인 시 핸드오프로 세션이 항상 생성되므로 드문 경우다.

## 11.2 플로팅 툴바

- **기능:** 문서 제목 표시, 렌더링 URL 복사, 관리 화면 상세로 이동, 접기. 미리보기에서는 URL 복사와 상세 이동을 숨긴다.
- **주입 위치:** 문서 **맨 끝**에 `<script src="/__box/toolbar.<hash>.js" data-...>`를 덧붙인다 ([decisions.md](decisions.md) D-16).
- **`/__box/*` 응답 헤더:**
  - `text/javascript`
  - `Cache-Control: public, max-age=31536000, immutable`
  - `Cross-Origin-Resource-Policy: cross-origin`
  - 인증 없음
- **구현:**
  - 표준 Web API로 만든다. Custom Element는 등록하지 않는다.
  - host 요소를 `document.documentElement`에 붙이고 closed Shadow DOM을 쓴다.
  - host 요소에 인라인 스타일 `all: initial !important; position: fixed !important; z-index: 2147483647 !important`를 지정한다.
  - `data-*` 값은 `textContent`로만 출력한다.
  - 툴바는 권한이 필요한 동작을 하지 않는다. 사용자 JS가 툴바를 조작할 수 있으므로 신뢰 표시로도 쓰지 않는다.
- `?bare=1`이면 툴바를 주입하지 않는다.

## 11.3 문서 복제

- `POST /html/:key/duplicate` (EDITOR)
- 새 document_key로 복사하고, 제목에 "(사본)"을 붙이며, 링크도 함께 복사한다. 등록자는 현재 사용자로 한다.

---

# 12. 이후 확장 기술 메모

| 기능 | 메모 |
| --- | --- |
| 버전 관리 | HTML을 교체할 때 이전 본을 `html_document_versions(document_id, version, html_content, html_size, created_by, created_at)`에 보관한다. 버전별 렌더링 경로는 `/:documentKey/v/:version` |
| 키 기반 API 업로드 | `Authorization: Bearer rb_...` + multipart. 쿠키를 쓰지 않는 경로이므로 CSRF 검사 대상이 아니다. Fetch Metadata 헤더가 없는 요청으로 허용된다 |
| 코드 에디터 (Monaco) | 원본은 페이지에 넣지 않고 `/html/:key/source`에서 받아 와 에디터에 로드한다. Monaco가 런타임에 스타일을 삽입하므로 관리 CSP `style-src`를 조정해야 한다 |
| 등록 시 상세 경고 | 서버 측 HTML 분석 (htmlparser2) |
| 비로그인 공개 | 렌더링 호스트를 별도 등록 도메인으로 분리하는 것을 먼저 검토한다 |
| 에셋 업로드 | S3 호환 스토리지, 문서별 경로 `/:documentKey/assets/*` |

---

# 13. 기술 원칙

1. 올라온 HTML은 신뢰하지 않는다. 걸러내지 않고 실행하되, 별도 호스트와 sandbox로 격리한다.
2. 격리를 한 가지 장치에 맡기지 않는다. 출처 분리, CSP sandbox, Fetch Metadata 중 하나가 실패해도 관리 화면은 안전해야 한다.
3. 사용자 HTML을 관리 화면 HTML에 절대 섞지 않는다. 원본은 렌더링 호스트(`text/html`)나 `text/plain`으로만 제공한다.
4. 인증과 권한은 서버에서 매 요청마다 확인한다.
5. 보안 헤더는 미들웨어로 강제하고, CI와 배포 후 점검으로 상시 검증한다.
