# render-box — UI 디자인 가이드

- 독자: 개발자, 디자이너
- 범위: 관리 화면 5개(로그인, 목록, 등록, 상세, 수정)와 오류 페이지. 렌더링 화면(사용자 HTML)은 디자인 대상이 아니다.
- 관련 문서: [prd.md](prd.md) 6장(화면), [design.md](design.md) 8장(프론트엔드 규칙)

---

## 0. 대전제: CSP와 정적 빌드에 맞추기

관리 화면 CSP는 `script-src 'self'`, `style-src 'self'`다. 그래서 다음을 지킨다.

- JS는 `data-state` 같은 `data-*`, `hidden`, `disabled`, `aria-*` **속성만** 바꾼다. 클래스 문자열을 조립하거나 `style`을 쓰지 않는다.
- 상태에 따른 모양은 `data-[state=dragover]:…`, `group-data-[copied=true]:…` 같은 Tailwind 변형 클래스로 JSX에 미리 적어 둔다.
- 이렇게 하면 빌드된 CSS에서 클래스가 빠지지 않고, 인라인 style도 필요 없다.

---

## 1. 디자인 방향

**조용하고 촘촘한 업무 도구로 만든다. 흰 바탕에 회색 선, 강조색은 파란색 하나만 쓴다.**

사용자가 이 화면에 머무는 시간은 몇 초다. 올리는 사람은 파일을 놓고, 제목을 확인하고, 저장하고, URL을 복사하면 끝이다. 보는 사람은 메신저 링크를 눌러 새 창으로 넘어간다. 관리 화면의 역할은 "다음에 무엇을 누르면 되는지"를 한눈에 보여 주고 물러나는 것이다. 장식(그라데이션, 그림자, 일러스트, 애니메이션)은 넣지 않는다.

- **비개발자를 위해 (올리는 사람은 개발자가 아닐 때가 많다):** 문구는 기술 용어 없이 "무슨 일이 생겼는지, 저장은 되는지, 이제 무엇을 하면 되는지"를 문장으로 말한다. 경고는 노랑, 실패는 빨강이며 색과 문장을 함께 쓴다.
- **개발자를 위해:** 문서 ID와 URL은 고정폭 글꼴로 그대로 보여 주고 버튼 뒤에 숨기지 않는다. 목록은 표로 촘촘하게(본문 14px) 만든다.
- 화면마다 primary 버튼은 하나만 둔다.

---

## 2. 디자인 토큰 (Tailwind CSS v4)

### 다크 모드: MVP에서는 하지 않는다

- 체류 시간이 짧고, 실제 콘텐츠(사용자 HTML)는 별도 창에서 자체 스타일로 열린다. 다크 모드를 넣으면 대비 QA 범위가 두 배가 된다.
- 색은 모두 의미 기반 CSS 변수로 정의한다. 나중에 `@media (prefers-color-scheme: dark)`에서 변수만 덮어쓰면 다크 모드를 추가할 수 있다.
- `<meta name="color-scheme" content="light">`와 `html { color-scheme: light }`를 지정한다. OS가 다크 모드일 때 폼 컨트롤만 어둡게 섞이는 것을 막기 위해서다.

### `apps/admin/src/styles/app.css`

```css
@import "tailwindcss";
@source "../";                       /* JSX */
@source "../../public/static/js";    /* JS가 다루는 data-* 변형 확인용 */

/* HTMX 로딩 표시: includeIndicatorStyles=false이므로 직접 정의 */
@custom-variant htmx-request (&.htmx-request, .htmx-request &);

@theme {
  --font-sans: -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo",
    "Malgun Gothic", "맑은 고딕", "Noto Sans KR", "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "D2Coding", monospace;

  /* 바탕·선·글자 */
  --color-canvas: #F9FAFB;       /* 페이지 바탕 */
  --color-surface: #FFFFFF;      /* 카드, 표, 입력 */
  --color-line: #E5E7EB;         /* 구분선, 카드 테두리 */
  --color-line-input: #878F9C;   /* 입력·드롭존·secondary 버튼 테두리 (흰 바탕 대비 3.26:1) */
  --color-fg: #111827;           /* 본문 17.7:1 */
  --color-fg-muted: #4B5563;     /* 보조 글자 7.6:1 */
  --color-fg-subtle: #6B7280;    /* 메타·placeholder 4.8:1 */

  /* 강조 */
  --color-primary: #2563EB;      /* 흰 글자 5.2:1 */
  --color-primary-hover: #1D4ED8;
  --color-primary-soft: #EFF6FF;
  --color-primary-line: #BFDBFE;
  --color-focus: #2563EB;

  /* 상태 */
  --color-danger: #DC2626;
  --color-danger-fg: #B91C1C;
  --color-danger-soft: #FEF2F2;
  --color-danger-line: #FECACA;
  --color-warning-fg: #92400E;
  --color-warning-soft: #FFFBEB;
  --color-warning-line: #FDE68A;
  --color-success-fg: #166534;
  --color-success-soft: #F0FDF4;
  --color-success-line: #BBF7D0;
  --color-info-fg: #1E40AF;
}

@layer base {
  html { color-scheme: light; }
  body { @apply bg-canvas text-fg font-sans text-sm antialiased; }
}
```

### 타이포 스케일

Tailwind 기본 스케일만 쓰고, 굵기는 400/500/600 세 가지만 쓴다.

| 용도 | 클래스 | 크기 |
| --- | --- | --- |
| 로그인 서비스명 | `text-2xl font-semibold` | 24/32 |
| 페이지 제목(h1) | `text-xl font-semibold` | 20/28 |
| 섹션 제목(h2) | `text-base font-semibold` | 16/24 |
| 본문·표·버튼·라벨 | `text-sm` (라벨은 `font-medium`) | 14/20 |
| 설명 문단 | `text-sm leading-6 whitespace-pre-line break-keep` | 14/24 |
| 메타·힌트·오류 문구 | `text-xs` | 12/16 (최소 크기) |
| 문서 ID·URL·코드 | `font-mono text-xs` | |

- 한글 제목과 본문은 `break-keep`을, URL과 ID는 `break-all`을 쓴다.
- 크기·날짜·개수는 `tabular-nums`로 자릿수를 맞춘다.
- 입력란은 `text-base sm:text-sm`으로 둔다. iOS는 16px 미만 입력란에 포커스가 가면 화면을 확대하기 때문이다.

### 간격 (4px 단위)

| 용도 | 값 |
| --- | --- |
| 페이지 좌우 | `px-4 sm:px-6` |
| 페이지 상하 | `py-6 sm:py-8` |
| 섹션 간 | `space-y-8` |
| 폼 필드 간 | `space-y-5` |
| 라벨과 입력 | `mb-1.5` |
| 입력과 힌트/오류 | `mt-1.5` |
| 카드 안쪽 | `p-4 sm:p-6` |
| 버튼 묶음 | `gap-2` |

### 반경, 그림자, 아이콘

- **반경:** 버튼·입력은 `rounded-md`(6px), 카드·배너·드롭존·표 외곽은 `rounded-lg`(8px), 배지는 `rounded`(4px)다. 스피너 외에는 `rounded-full`을 쓰지 않는다.
- **그림자:** 쓰지 않는다. 영역은 테두리(`border-line`)와 바탕색 차이(canvas/surface)로 구분한다. 모달, 드롭다운, 토스트처럼 떠 있는 레이어가 없기 때문이다.
- **아이콘:** Lucide(ISC 라이선스)의 path를 `<Icon name>` JSX 컴포넌트에 인라인 SVG로 넣는다.
  - 기본 `size-4`, 빈 상태 `size-8`, `stroke-width 1.75`, `currentColor`, `aria-hidden="true"`
  - 사용하는 아이콘: external-link, copy, check, upload, file-code, x, trash-2, triangle-alert, info, circle-check, shield, plus, search, loader, arrow-left

---

## 3. 공통 레이아웃

```
┌──────────────────────────────────────────────────────────────┐
│ [로고] render-box     Tamna [편집자] ▾  이태수  도움말  로그아웃  │  h-14, bg-surface, border-b
└──────────────────────────────────────────────────────────────┘
  ← Tamna 목록                                (상세·등록·수정에만)
  페이지 제목                                [페이지 주 행동]
  ──────────────────────────────────────────
  본문
                     render-box · GitHub                        ← 하단, 모든 화면
```

**상단 바:** `sticky top-0 z-10 h-14 border-b border-line bg-surface`

- 왼쪽: 로고(`/static/logo.svg`, `size-6`, `alt=""`) + "render-box"(`font-semibold`, `/html`로 가는 링크). `sm` 미만에서는 로고만(링크 `aria-label="render-box 목록"`).
- **모바일(`sm` 미만):** 프로젝트 이름은 `max-w-24`로 줄여 말줄임, [도움말]은 `circle-help` 아이콘(`aria-label`), 버튼 좌우 여백 `px-2`. 사용자 이름은 `md`부터 보인다.
- 오른쪽: 지금 프로젝트, 사용자 이름, [도움말], [로그아웃]
  - **지금 프로젝트:** 프로젝트 이름(`font-medium`, `max-w-40 truncate`) + **그 프로젝트에서의** 역할 배지(편집자/열람자). 역할은 키가 아니라 프로젝트마다 다르다 (design.md 3.9). 관리자 키(D-38)는 모든 프로젝트에서 badge-primary "관리자"로, 메뉴의 프로젝트 목록에도 "관리자"로 보인다.
  - 프로젝트가 둘 이상이면 `<details>` 메뉴가 된다. `<summary>`는 ghost 버튼 모양에 `chevron-down` 아이콘, 열면 다른 프로젝트 목록(이름 + 역할, `/html?project=<slug>` 링크)이 오른쪽 정렬로 뜬다. JS 없이 동작한다.
  - 지금 프로젝트가 없는 화면(오류 페이지)에서는 프로젝트를 보여 주지 않는다.
  - [도움말]은 ghost 링크이고 `target="_blank"`(뒤에 `sr-only` "(새 창)")다. `HELP_URL`이 비어 있으면 숨긴다.
  - [로그아웃]은 POST 폼 버튼이고 ghost 스타일이다.
  - 사용자 이름은 `md`부터 보인다(`hidden md:inline`).

**하단:** 모든 화면 맨 아래 가운데에 "render-box · GitHub"(원본 저장소, `text-xs text-fg-subtle`, 새 창). 도움말과 달리 설정으로 바꾸지 않는다.

**아이콘:** 파비콘은 `logo.svg`, iOS 홈 화면 아이콘은 `apple-touch-icon.png`(180px, 모서리 없음 — iOS가 둥글게 자른다). 렌더링 화면에는 아무것도 넣지 않는다.

**최대 폭:** 상단 바와 모든 화면이 같은 바깥 폭(`max-w-5xl mx-auto`)을 쓴다. 그래야 화면을 옮겨도 왼쪽 시작선이 움직이지 않는다. 오류 페이지(404·403·500 등)는 예외로 카드를 가운데에 둔다. 한 번 보고 떠나는 화면이라서다. 로그인 전에는 로그인 화면처럼 위아래로도 가운데, 로그인 뒤에는 상단 바 아래에서 가로로만 가운데. 렌더링 주소의 404도 같은 모양이다.

- 목록: 바깥 폭 그대로
- 등록·수정: 바깥 폭을 다 쓴다. `lg`(1024px)부터 두 칸 — 등록은 왼쪽 HTML·오른쪽 문서 정보, 수정은 왼쪽 문서 정보·오른쪽 HTML 교체. 그 아래 "안 되는 것" 안내와 버튼은 전체 폭. `lg` 미만은 한 줄로 쌓는다.
- 상세: 바깥 폭을 다 쓴다. 제목·버튼·렌더링 URL과 버전 목록은 전체 폭, 그 사이는 `lg`부터 두 칸 — 왼쪽 설명·관련 링크, 오른쪽(20rem) 정보·소스(버튼 세로). `lg` 미만은 설명 → 링크 → 정보 → 소스 → 버전 순으로 쌓는다.
- 저장 공간: 바깥 폭을 다 쓴다. 요약 카드는 `lg`부터 왼쪽 전체 사용량·막대, 오른쪽 "프로젝트별" 사용량(세로 구분선). 이전 버전 목록은 전체 폭.
- 프로젝트 없음 안내: 바깥 폭 안에서 `max-w-3xl` 카드, 왼쪽 정렬.
- 오류: 같은 바깥 폭 안에 `max-w-sm` 카드, 왼쪽 정렬
- 로그인: 상단 바가 없는 화면이라 가운데 `max-w-sm` 카드
- `html`에 `scrollbar-gutter: stable`: 스크롤바가 생기고 없어질 때 폭이 흔들리지 않게 자리를 늘 비워 둔다.
- 테스트: `e2e/layout.spec.ts`(모든 화면의 첫 블록이 로고와 같은 왼쪽 선, 360px에서 상단 바 한 줄, 오류 페이지는 가운데)

**반응형 기준점:**

- `sm`(640px): 버튼 묶음과 링크 행이 세로 쌓기에서 가로 배치로 바뀐다.
- `md`(768px): 목록이 카드 리스트에서 표로 바뀐다.

**모바일:** 개발자가 메신저 인앱 브라우저에서 링크를 여는 경우를 기준으로 한다.

- 로그인 화면이 모바일에서 가장 중요하다. 렌더링 URL을 처음 열면 로그인을 한 번 거치기 때문이다.
- 상세 화면은 첫 화면에 제목, [새 창에서 보기](전체 폭 primary), URL 복사가 보여야 한다.

**버튼:** 모든 화면에서 높이는 `h-10`(40px)이다. 모바일의 주요 행동 버튼은 `w-full sm:w-auto`로 둔다.

**목록으로 돌아가기:** 상세·등록·수정 상단에 "← {프로젝트} 목록" 링크를 둔다(`text-sm text-fg-muted hover:text-fg`). 문서의 프로젝트 목록(`/html?project=<slug>`)으로 간다.

**페이지 이동 (D-39):** 링크와 폼은 hx-boost로 본문만 바꾼다(깜빡임 없음). 마우스가 링크 근처(행 링크는 행 전체 + 64px)에 잠깐 머물면 미리 받아 두어, 누르면 바로 바뀐다. 바뀐 뒤 포커스는 `#main`(`tabindex="-1"`, outline 없음)으로 가고 live 영역에 "{제목} 화면"을 알린다. 로그인·업로드 폼·다운로드는 일반 이동이다.

- **진행 막대:** 이동이 80ms를 넘으면 화면 맨 위에 2px primary 막대가 좌우로 흐른다(`.nav-progress`, 동작 줄이기 설정이면 멈춘 막대). 누른 목록 행은 새 페이지가 올 때까지 `bg-primary-soft`. 바로 바뀌면 보이지 않는다.
- **뒤로 가기:** 최근 페이지는 떠날 때 모습 그대로(스크롤 위치 포함) 바로 돌아온다. 저장·삭제 같은 변경 뒤에는 서버에서 다시 받는다.

**지금 프로젝트 정하기:** `?project=<slug>` → 마지막으로 본 프로젝트(쿠키) → 배포 설정의 기본 프로젝트(`DEFAULT_PROJECT`, 멤버일 때) → 이름순 첫 프로젝트. 목록·등록·저장 공간이 이를 따르고, 상세·수정은 문서의 프로젝트를 지금 프로젝트로 보여 준다.

---

## 4. 화면별 와이어프레임과 상태

### SCR-01 로그인

```
                ┌──────────────────────────────────────┐
                │              [로고]                   │ size-12
                │            render-box                │ text-2xl
                │  HTML 파일을 주소 하나로 공유하는 곳       │ text-fg-muted
                │ ┌──────────────────────────────────┐ │
                │ │(i) 문서를 보려면 먼저 로그인하세요.   │ │ ← next가 있을 때만 (info 배너)
                │ └──────────────────────────────────┘ │
                │ 접근 키                               │
                │ [••••••••••••••••••••••••••••••••]   │ type=password
                │ (!) 키가 올바르지 않습니다. …          │ ← 실패 시
                │ [             로그인              ]   │ primary, w-full
                │ 키는 관리자에게 받으세요.               │ text-xs
                │ 한 번 로그인하면 30일 동안 유지됩니다.   │
                │ 사용 안내                              │ ← HELP_URL 링크(새 창), 비면 숨김
                │ ──────────────────────────────────── │
                │ [방패] 렌더링 화면은 키를 묻지 않습니다.  │ text-xs
                └──────────────────────────────────────┘
```

**배치와 입력 필드**

- 화면 가운데 정렬(`min-h-dvh grid place-items-center`), 카드는 `w-full max-w-sm`.
- 키 입력란: `type="password" autocomplete="current-password" autofocus`.
- 비밀번호 관리자가 키를 저장하고 채워 넣을 수 있도록 `username` 필드를 하나 숨겨 둔다.
  - `autocomplete="username"`, 값은 "render-box", `sr-only`, `tabindex="-1"`.

**실패 처리**

- 입력란에 `aria-invalid="true"`를 붙이고, 오류 문구를 `aria-describedby`로 연결한다.
- 입력값을 비우고 입력란에 다시 포커스한다.
- 서버는 키의 앞뒤 공백을 제거(trim)한 뒤 비교한다.

**제출 중:** 버튼을 `disabled`로 바꾸고 문구를 "키 확인 중…"으로 바꾼다. 핸드오프 리다이렉트를 두 번 거치므로 체감 지연이 있다.

### SCR-02 목록

```
[로고] render-box                    Tamna [편집자] ▾  이태수  도움말  로그아웃
────────────────────────────────────────────────────────────────────
[방패] 렌더링 화면은 키를 묻지 않습니다. …                      ← 한 줄 안내
(✓) 문서를 삭제했습니다.                                         ← deleted=1일 때
(!) 저장 공간이 얼마 남지 않았습니다 …                            ← 80% 이상 (100%면 error)
[DB] 저장 공간            123 MB / 400 MB · 이전 버전 45 MB       ← /storage 링크, max-w-xs
▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭                                               ← 사용량 막대
Tamna                                              [+ 새 HTML 등록]   ← 이 프로젝트의 EDITOR만
[돋보기  제목 또는 문서 ID로 검색                ] (스피너)
┌──────────────────────────────────────────────────────────────────────┐
│ 제목                              링크   크기     수정자   수정일      │
├──────────────────────────────────────────────────────────────────────┤
│ 회원가입 플로우 v3                   2   1.2 MB   김기획   오늘 14:05  [↗ 새 창] │
│ 이메일 인증 단계 추가, 약관 동의…  (설명 한 줄, truncate)                         │
└──────────────────────────────────────────────────────────────────────┘
21–40 / 전체 134개                                     [‹ 이전] [다음 ›]
```

**표 구성**

- 설명은 별도 열 없이 제목 아래 한 줄(`truncate`)로 보여 준다.

**행 클릭**

- `<tr class="relative">`로 두고, 제목 `<a>`에 `after:absolute after:inset-0`을 줘서 행 전체를 상세 링크로 만든다.
- [↗ 새 창]만 `relative z-10`으로 그 위에 올린다.
- [↗ 새 창] 링크 속성: `target="_blank" rel="noopener"`, `aria-label="{제목} 새 창에서 보기"`

**표기 규칙**

- 수정일: 오늘이면 "오늘 14:05", 올해면 "10월 28일", 그 이전이면 "2025. 3. 2."로 쓴다. `<time datetime title>`에 전체 시각을 넣는다.
- 크기: 1024 기준이다. 1MB 미만은 "340 KB"(정수), 1MB 이상은 "1.2 MB"(소수 한 자리)로 쓴다.

**모바일(md 미만):** 표 대신 `<ul>` 카드 리스트로 보여 준다. 서버가 두 마크업을 모두 출력하고 `hidden md:table` / `md:hidden`으로 전환한다.

**검색**

- `<form method="get" action="/html">` 안에 `<input type="search" name="q">`를 두고 HTMX 속성을 붙인다 (design.md 8.1). JS가 꺼져 있어도 Enter로 동작한다.
- 스피너: `opacity-0 htmx-request:opacity-100`
- 결과 개수는 `sr-only aria-live="polite"` 영역에 `hx-swap-oob`로 갱신한다.

**페이지네이션:** 이전/다음 버튼과 "21–40 / 전체 134개"만 둔다. 첫 페이지의 [이전]은 비활성화한다.

**프로젝트:** 지금 프로젝트의 문서만 보여 준다. 제목(h1)은 프로젝트 이름이다. 검색·페이지 이동도 같은 프로젝트 안에서 한다.

**저장 공간 요약**

- 막대는 인라인 `style` 대신 SVG `<rect width="37%">`로 그린다. 관리 화면 CSP가 style 속성을 막기 때문이다.
- 색: 평소 `fill-primary`, 경고 기준 이상 `fill-warning-fg`, 상한 이상 `fill-danger`. 100%를 넘어도 막대는 100%에서 멈춘다.
- 경고 기준(기본 80%)을 넘으면 warning 배너, 상한을 넘으면 error 배너(`role="alert"`)를 모두에게 보여 준다. 두 배너 모두 [이전 버전 정리하기] → `/storage`.

**빈 상태**

- 속한 프로젝트 없음: 목록 대신 전용 화면(`no-project.tsx`, 목록·등록·저장 공간 공통). 카드에 "아직 속한 프로젝트가 없습니다", 안내 문구, 이름과 키 앞자리(`rb_xxxxx…`, 고정폭), 관리자에게 보낼 `pnpm project grant …` 명령(읽기 전용 칸 + [명령 복사]). 상단 바에 프로젝트 메뉴는 없다.
- EDITOR: "아직 등록한 HTML이 없습니다" + [+ 새 HTML 등록] + "Claude Code 같은 AI 도구에서 바로 올릴 수도 있습니다. [AI 도구로 올리는 방법]"(도움말의 해당 절, 새 창. `HELP_URL`이 비면 숨김)
- VIEWER: "아직 등록된 문서가 없습니다"
- 검색 결과 0건: "'{q}'와(과) 맞는 문서가 없습니다" + [검색어 지우기]

### SCR-03 등록

```
← 목록
새 HTML 등록
┌ (!) 입력 내용을 확인해 주세요 ─────────────────────────┐  ← 422일 때, 필드로 가는 링크 목록
└───────────────────────────────────────────────────────┘
HTML                                  ( 파일로 올리기 | 직접 붙여넣기 )
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
            [업로드 아이콘]
   HTML 파일을 여기로 끌어다 놓거나  [파일 선택]
        .html, .htm 파일 · 최대 10MB
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
(i) EUC-KR 파일을 UTF-8로 변환했습니다.
┌ (!) 저장은 할 수 있지만, 일부가 표시되지 않을 수 있습니다 ─┐  ← warning 배너
└──────────────────────────────────────────────────────┘
제목 *            [회원가입 플로우 v3                    ]
설명              [                                     ]
관련 링크 (선택, 최대 10개)
[이름 (예: 기획서)    ] [https://                       ] [휴지통]
[+ 링크 추가]
▸ 업로드한 HTML에서 안 되는 것 (6가지)                     ← <details>, 기본 닫힘
──────────────────────────────────────────────────────
                                          [취소]  [저장]
```

**입력 방식 전환**

- "파일로 올리기 / 직접 붙여넣기"는 라디오 2개를 세그먼트 모양으로 만든다. 기본값은 파일이다.
- 모드를 바꾸면 다른 모드의 내용을 비운다.
- 내용이 있던 상태에서 바꾸면 "파일 선택을 해제했습니다" 또는 "붙여넣은 내용을 지웠습니다"를 보여 준다.

**드롭존 상태** (래퍼의 `data-state`)

| 상태 | 모양 | 내용 |
| --- | --- | --- |
| `empty` | 점선 2px `border-line-input`, hover 시 primary | 업로드 아이콘과 안내 문구 |
| `dragover` | 실선 primary, `bg-primary-soft` | "여기에 놓으세요" |
| `reading` | 기본 모양 + 스피너 | "파일을 읽는 중…" |
| `selected` | 파일 카드 | `[파일] 이름 · 크기 [다른 파일] [선택 해제]`. 파일 내용은 보여 주지 않는다 |
| `error` | 실선 danger, `bg-danger-soft` | 오류 문구 + [다른 파일 선택]. 제출을 막는다 |
| `reselect` | warning 테두리·바탕 | 422로 폼이 다시 표시된 경우: "보안 정책상 파일은 다시 선택해야 합니다" |

- `dragover` 상태는 파일을 창 위로 끌어오는 순간 켜진다. 드롭 영역이 아닌 곳에 놓아도 받는다. 영역을 빗나가면 브라우저가 HTML 파일 자체를 열어 입력 내용이 사라지기 때문에, `window`의 dragover/drop 기본 동작을 막는다.
- 빈 상태의 드롭존은 `<label for="html-file">`이다. 파일 입력은 `<input type="file" id="html-file" accept=".html,.htm,text/html" class="sr-only">`다.
- 여러 파일을 놓으면 error 상태로 "파일은 하나만 올릴 수 있습니다"를 보여 준다.

**붙여넣기:** `font-mono text-xs leading-5 h-64 resize-y`, `spellcheck="false"`. 아래에 "붙여넣은 내용 · 34 KB"를 표시한다. 입력이 500ms 멈추면 경고 검사를 한다.

**경고**

- 드롭존 아래 warning 배너에 표시한다. 제목에는 반드시 "저장은 할 수 있지만"을 넣는다.
- 문제가 된 경로를 최대 3개까지 예시로 보여 주고 나머지는 "외 N개"로 줄인다. 올리는 사람이 이 목록을 AI에게 다시 요청할 때 그대로 붙여넣을 수 있게 하기 위해서다.
- AI에게 고쳐 달라고 할 수 있는 경고(iframe 직접 접근)에는 항목 안에 **요청 상자**를 둔다: `border-warning-line bg-surface` 상자, 위에 "AI에게 보낼 요청"과 [복사](h-8 작은 버튼), 아래 요청 본문(`text-xs leading-5 break-keep wrap-anywhere`, 단어 중간에서 끊지 않는다).

**링크 행**

- 기본 1행이며, JS가 꺼져 있어도 이 1행은 동작한다.
- 배치: 데스크톱은 `sm:grid-cols-[12rem_1fr_auto]`로 한 줄에 놓는다.
- 행 추가·삭제:
  - 새 행은 `<template>`을 복제해 만든다. 추가하면 새 행의 이름 칸으로 포커스를 옮긴다.
  - 삭제하면 다음 행으로 포커스를 옮긴다.
  - 마지막 1행을 삭제하면 행을 없애지 않고 값만 비운다.
  - 10행이 되면 [+ 링크 추가]를 `disabled`로 바꾼다.
- URL 칸: `type="text" inputmode="url"`로 둔다. 브라우저 기본 검증 말풍선을 쓰지 않기 위해 폼에 `novalidate`를 준다.

**글자 수 제한:** `maxlength`로 막는다(제목 200, 설명 2000, 링크 이름 100, URL 1000).

**렌더링 환경 안내:** `<details>`를 쓰고 기본은 닫혀 있다. 내용은 prd.md 5.3 문구 그대로다.

**제출 흐름:** design.md 4.6 참고.

1. [저장]을 누르면 HTML을 `PUT /uploads`로 먼저 올린다.
2. 업로드 중에는 버튼을 `disabled`로 바꾸고 "저장하는 중…"과 스피너를 보여 준다.
3. 업로드가 성공하면 `upload_id`를 넣어 폼을 제출한다.
4. 업로드가 실패하면 폼을 제출하지 않고 드롭존을 error 상태로 바꾼다.

**422 재표시**

- 맨 위 error 배너(`role="alert"`, `tabindex="-1"`)로 포커스를 옮긴다. 배너의 오류 항목은 해당 필드로 가는 링크다.
- 오류가 난 필드에는 `aria-invalid`를 붙이고 오류 문구를 보여 준다.
- 입력값은 보존한다. 파일 모드였다면 드롭존은 `reselect` 상태로 둔다.

### SCR-04 상세

```
← 목록
┌ (✓) 저장했습니다 ────────────────────────────────────────┐  ← saved=1일 때
│ 아래 주소를 복사해 메신저로 공유하세요.                         │
│ [https://render-box-render.…/3fK9a…  ] [렌더링 URL 복사]     │ ← primary, autofocus
└─────────────────────────────────────────────────────────┘
회원가입 플로우 v3
[↗ 새 창에서 보기]  [렌더링 URL 복사]          [수정]  [삭제]
렌더링 URL  https://render-box-render.…/3fK9aQ2…  (font-mono text-xs, break-all)

설명 / 관련 링크 / 정보(<dl>) / 소스 [소스 보기 ↗] [소스 다운로드]

메모 2   이 문서를 볼 수 있는 사람은 누구나 메모를 남길 수 있습니다. …     (hint)
┌──────────────────────────────────────────────────────────────┐
│ 이개발 [v2] 오늘 14:20                                            │
│ 버튼 색이 너무 연해요                                    수정 삭제    │
│ 박디자인 [v3 현재] 오늘 15:02 (수정됨)                              │
│ …                                                              │
└──────────────────────────────────────────────────────────────┘
[ 이 문서에 대한 의견을 남겨 주세요                                 ]
[메모 남기기]

버전   HTML을 교체할 때마다 이전 HTML이 버전으로 남습니다. …            (hint)
┌──────────────────────────────────────────────────────────────┐
│ v3 [현재] [v1 복원]   김기획 · 오늘 14:05 · 35 KB      [↗ 보기] 소스  │
│ v2                    김기획 · 오늘 13:10 · 38 KB  [↗ 보기] 소스 [↺ 복원] [휴지통 삭제] │
│ v1                    …                                                            │
└──────────────────────────────────────────────────────────────┘
```

**버전 (`#versions`)**

- 최신 순. 첫 행이 현재 버전이고 badge-primary "현재"를 단다. 복원으로 생긴 버전에는 badge-neutral "v{n} 복원".
- 행 동작은 모두 `rowAction`(작은 텍스트 버튼). 삭제만 `rowActionDanger`.
  - [보기]: 현재는 렌더링 URL, 이전 버전은 `{렌더링}/{key}/v/{seq}`, 새 창. `aria-label="v{n} 보기 (새 창)"` — "새 창에서 보기" 버튼과 이름이 겹치지 않게 한다.
  - [소스]: `/html/:key/v/:seq/source`, 새 창.
  - [복원]·[삭제]: 이 프로젝트의 EDITOR이고 현재 버전이 아닐 때만. 둘 다 `data-confirm` POST 폼이다. 복원 폼에는 hidden `version`(동시 수정 검사)을 넣는다.
- 복원·삭제 뒤에는 `?notice=restored|version-deleted|conflict#versions`로 돌아와 맨 위 배너로 결과를 알린다.

**메모 (`#comments`)**

- 오래된 순. 이름(굵게), 버전 배지(현재 버전이면 badge-primary, 아니면 badge-neutral), 상대 시각, 수정했으면 "(수정됨)". 본문은 `whitespace-pre-wrap break-words`.
- [수정]은 내 메모에만. `<details>` 안의 textarea 폼이라 스크립트 없이 열린다. [삭제]는 내 메모, 또는 EDITOR면 모든 메모. `data-confirm` POST.
- 입력칸은 프로젝트 멤버 누구에게나(VIEWER 포함) 보인다. `required maxlength=2000`, 서버도 같은 규칙.
- 결과는 `#comments`로 돌아온다. 오류(`comment-invalid`, `comment-gone`)는 맨 위가 아니라 메모 섹션 안에 배너로 보인다(돌아온 위치에서 보이게).
- 목록(SCR-02)에는 "메모" 숫자 열, 모바일 카드에는 메타 줄에 "메모 n".

**버튼 위계**

- 평소 primary는 [새 창에서 보기] 하나다. [렌더링 URL 복사], [수정], [소스 …]는 secondary다.
- [삭제]는 테두리만 있는 danger 버튼으로 만들고, 오른쪽 끝에 따로 떨어뜨려 둔다.

**저장 직후 (`?saved=1`)**

- success 배너 안에 URL 칸과 primary [렌더링 URL 복사] 버튼을 두고, 이 버튼에 `autofocus`를 준다.
- primary가 두 개가 되지 않도록 [새 창에서 보기]를 secondary로 내린다.
- JS가 `history.replaceState`로 `?saved=1`을 지워서, 새로고침해도 배너가 다시 뜨지 않게 한다.
- HTML을 교체했다면(`?saved=1&replaced=1`) 문구를 "주소는 그대로이니 이미 공유한 링크로 최신 내용을 볼 수 있습니다."로 바꾼다.

**URL 복사**

- `navigator.clipboard.writeText`로 복사한다.
- 성공하면 `data-copied="true"`를 2초 동안 유지하고, 아이콘과 문구를 "복사했습니다"로 바꾼다. 같은 내용을 live 영역으로 알린다.
- 실패하면 `readonly` URL 칸의 텍스트를 선택해 두고 직접 복사하라고 안내한다.

**삭제:** `<form method="post" action="/html/:key/delete" data-confirm="…">`로 만든다. 확인은 브라우저 기본 `confirm()`을 쓰고 커스텀 모달은 만들지 않는다.

**모바일 순서:** 제목 → [새 창에서 보기](w-full) → [URL 복사](w-full) → 설명 → 링크 → 정보 → 소스 → [수정] [삭제] 순서로 쌓는다. 실수로 누르지 않도록 삭제는 맨 아래에 둔다.

**빈 섹션:** 설명이나 링크가 없어도 섹션을 숨기지 않는다. "설명이 없습니다", "관련 링크가 없습니다"를 `text-fg-subtle`로 보여 준다.

### SCR-06 저장 공간 (`/storage`)

```
← 목록
저장 공간
┌ 카드 ─────────────────────────────────────────┐
│ 123 MB                              / 400 MB  │ text-2xl / text-fg-muted
│ ▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭                                 │ 목록과 같은 막대
│ 현재 문서 78 MB · 이전 버전 45 MB                 │
│ ─────────────────────────────────────────────  │
│ Tamna 60 MB · Demo 18 MB                        │ ← 내가 속한 프로젝트별
│ 400 MB가 차면 업로드가 막힙니다. 오래된 버전을 자동으로 지우지 않습니다. │
└───────────────────────────────────────────────┘
이전 버전 (지우면 공간이 많이 생기는 순서)
┌──────────────────────────────────────────────┐
│ [ ] 회원가입 플로우 v3 · v2  Tamna   38 KB  문서 │
│ [ ] … · v1  지워도 공간이 늘지 않음    29 KB  문서 │
└──────────────────────────────────────────────┘
[휴지통 선택한 버전 지우기]                              ← danger, data-confirm
```

- 내가 속한 프로젝트의 이전 버전만 보인다. 체크박스는 내가 EDITOR인 프로젝트의 버전에만 있다. 지울 수 있는 버전이 없으면 버튼 대신 "버전을 지우려면 그 프로젝트의 편집 권한이 필요합니다."
- 프로젝트가 둘 이상인 사람에게는 행마다 프로젝트 이름을 덧붙인다(`text-fg-subtle`).
- 정렬은 "지웠을 때 늘어나는 공간"이 큰 순서다. 다른 버전과 원본을 함께 쓰는 버전은 0이라 뒤로 가고, "다른 버전과 같은 HTML이라 지워도 공간이 늘지 않음"을 붙인다.
- 지운 뒤에는 `?deleted=N`으로 돌아와 "이전 버전 N개를 지웠습니다"(0이면 "지운 버전이 없습니다").

### SCR-05 수정

```
← 회원가입 플로우 v3
문서 수정
┌ (!) 다른 사람이 먼저 수정했습니다 ──────────────────────────┐  ← 409일 때만
│ 박운영님이 10월 30일 09:12에 이 문서를 수정해서, 내 변경은 저장하지 │
│ 않았습니다. 입력한 내용은 아래에 그대로 남아 있습니다.               │
│ [↗ 최신 내용 확인 (새 창)]                                        │
└──────────────────────────────────────────────────────────┘
제목 * / 설명 / 관련 링크                    (등록 화면과 같은 컴포넌트)
HTML 교체
┌──────────────────────────────────────────────────────┐
│ 현재 HTML  2.4 MB · 마지막 수정 박운영, 10월 30일 09:12      │ bg-canvas
└──────────────────────────────────────────────────────┘
새 파일을 올리지 않으면 지금 HTML이 그대로 유지됩니다.
( 파일로 올리기 | 직접 붙여넣기 )  [드롭존]
[교체 예정] 저장하면 HTML이 이 파일로 바뀝니다. 공유한 주소는 그대로입니다.
                                    [취소]  [저장]   (409 후: [내 내용으로 다시 저장])
```

**교체 여부:** 파일을 선택하거나 내용을 붙여넣으면 [교체 예정] 배지를 보여 준다. 저장할 때 HTML이 있을 때만 업로드하고 `upload_id`를 함께 보낸다 (design.md 4.8). [교체 취소]를 누르면 내용을 비우고 배지를 숨긴다.

**409**

- 별도 페이지를 띄우지 않고, 409 상태 코드로 이 폼을 다시 보여 준다.
- 배너에 `role="alert"`를 주고 포커스를 옮긴다.
- hidden `version`에는 **최신 값**을 넣는다. 버튼 문구는 "내 내용으로 다시 저장"으로 바꾼다.

**[취소]:** 상세 화면으로 돌아간다. 이탈 경고(beforeunload)는 넣지 않는다.

### 오류 페이지 (관리 호스트, 공통 템플릿)

| 코드 | 제목 | 설명 | 버튼 |
| --- | --- | --- | --- |
| 403 (권한) | 편집 권한이 필요합니다 | 지금 키로는 문서를 보기만 할 수 있습니다. 등록·수정·삭제가 필요하면 관리자에게 편집 권한을 요청하세요. | [목록으로] |
| 403 (CSRF·Origin) | 요청을 처리하지 못했습니다 | 페이지를 오래 열어 두었거나 다른 창에서 로그아웃했을 수 있습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요. | [목록으로] |
| 404 | 문서를 찾을 수 없습니다 | 삭제되었거나 주소가 잘못되었습니다. 주소를 보낸 사람에게 확인해 주세요. | [목록으로] |
| 413 | 파일이 너무 큽니다 | 한 번에 올릴 수 있는 HTML은 10MB까지입니다. 이미지가 많이 들어 있다면 이미지 크기를 줄여 다시 만들어 주세요. | [목록으로] |
| 500 | 일시적인 오류가 발생했습니다 | 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요. | [목록으로] |

- 상태 코드 숫자는 제목 위에 작게(`text-xs font-mono text-fg-subtle`) 표시한다.
- 렌더링 호스트의 404(text/plain) 문구: "문서를 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다."

---

## 5. 컴포넌트와 Tailwind 클래스

```text
/* 버튼 */
btn       = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md text-sm font-medium
             whitespace-nowrap transition-colors
             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus
             disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:pointer-events-none"
primary   = btn + "bg-primary text-white hover:bg-primary-hover"
secondary = btn + "border border-line-input bg-surface text-fg hover:bg-canvas"
danger    = btn + "border border-danger-line bg-surface text-danger-fg hover:bg-danger-soft"
ghost     = btn + "px-3 text-fg-muted hover:bg-canvas hover:text-fg"
icon-btn  = "inline-flex size-10 items-center justify-center rounded-md text-fg-muted
             hover:bg-canvas hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2
             focus-visible:outline-focus"                               (aria-label 필수)
spinner   = "size-4 animate-spin motion-reduce:animate-none"

/* 입력 */
label     = "mb-1.5 block text-sm font-medium text-fg"
input     = "block w-full h-10 rounded-md border border-line-input bg-surface px-3 text-base sm:text-sm
             text-fg placeholder:text-fg-subtle
             focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus
             focus-visible:border-focus
             aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-danger"
textarea  = input에서 h-10 대신 "min-h-24 py-2 leading-6 resize-y"
code-area = textarea + "font-mono text-xs leading-5 h-64"
hint      = "mt-1.5 text-xs text-fg-subtle"
field-err = "mt-1.5 flex items-start gap-1 text-xs text-danger-fg"

/* 세그먼트 (라디오) */
seg-wrap  = "inline-flex rounded-md border border-line-input p-0.5 bg-surface"
seg-item  = "has-[:checked]:bg-primary-soft has-[:checked]:text-info-fg
             has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus
             rounded px-3 h-8 inline-flex items-center text-sm text-fg-muted cursor-pointer"

/* 배지 */
badge         = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
badge-neutral = badge + "border border-line bg-canvas text-fg-muted"        (열람자)
badge-primary = badge + "bg-primary-soft text-info-fg"                      (편집자)
badge-warning = badge + "bg-warning-soft text-warning-fg border border-warning-line"  (교체 예정)

/* 표 */
table-wrap = "overflow-hidden rounded-lg border border-line bg-surface"
th         = "bg-canvas px-4 py-2.5 text-left text-xs font-medium text-fg-muted"
tr         = "relative border-t border-line hover:bg-canvas"
td         = "px-4 py-3 align-top"
td-num     = td + "text-right tabular-nums text-fg-muted whitespace-nowrap"
row-title  = "font-medium text-fg break-keep after:absolute after:inset-0
              focus-visible:outline-none focus-visible:after:outline-2
              focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
row-desc   = "mt-0.5 truncate text-xs text-fg-subtle"
row-action = "relative z-10 inline-flex items-center gap-1 rounded-md px-2 h-8 text-sm
              text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus"

/* 알림 배너 (아이콘 size-5 shrink-0) */
alert         = "flex gap-3 rounded-lg border p-4 text-sm"
alert-success = alert + "border-success-line bg-success-soft"   role="status"
alert-info    = alert + "border-primary-line bg-primary-soft"   role="status"
alert-warning = alert + "border-warning-line bg-warning-soft"   role="status"
alert-error   = alert + "border-danger-line bg-danger-soft"     role="alert" tabindex="-1"
safety-line   = "flex items-center gap-2 text-xs text-fg-subtle"

/* 빈 상태 */
empty       = "rounded-lg border border-dashed border-line-input bg-surface px-6 py-12 text-center"

/* 카드·정보 */
card     = "rounded-lg border border-line bg-surface p-4 sm:p-6"
dl       = "grid grid-cols-[5rem_1fr] gap-x-4 gap-y-2 text-sm"
```

---

## 6. UI 문구

### 전역·로그인

| 위치 | 문구 |
| --- | --- |
| 역할 배지 | 편집자 / 열람자 (지금 프로젝트에서의 역할) / 관리자 (모든 프로젝트) |
| 프로젝트 메뉴 | {프로젝트 이름} [역할] ▾ (aria-label: 프로젝트 {이름}, 바꾸기) |
| 상단·로그인 링크 | 도움말 / 사용 안내 / 하단: render-box · GitHub |
| 안전 안내 | 렌더링 화면은 키를 묻지 않습니다. 문서 안에서 키를 입력하라고 하면 가짜 화면이니 입력하지 마세요. |
| 로그인 부제 | HTML 파일을 주소 하나로 공유하는 곳 |
| 라벨 / 버튼 | 접근 키 / 로그인 (제출 중: 키 확인 중…) |
| 안내 | 키는 관리자에게 받으세요. 한 번 로그인하면 30일 동안 유지됩니다. |
| next 있을 때 | 문서를 보려면 먼저 로그인하세요. 로그인하면 바로 문서가 열립니다. |
| 실패 | 키가 올바르지 않습니다. 복사할 때 앞뒤에 빈칸이 들어가지 않았는지 확인하고, 계속 안 되면 관리자에게 문의하세요. |
| 키 비움 | 접근 키를 입력해 주세요. |
| 429 | 로그인 시도가 너무 많습니다. 30초 뒤에 다시 시도해 주세요. |

### 목록

| 위치 | 문구 |
| --- | --- |
| 제목 / 버튼 | {프로젝트 이름} / + 새 HTML 등록 |
| 저장 공간 | 저장 공간 {사용} / {상한} · 이전 버전 {크기} |
| 경고 배너 | 저장 공간이 얼마 남지 않았습니다 / {사용} / {상한}를 쓰고 있습니다. 가득 차면 업로드가 막힙니다. 이전 버전 정리하기 |
| 가득 참 배너 | 저장 공간이 가득 찼습니다 / 지금은 새로 올리거나 HTML을 교체할 수 없습니다. 이전 버전 정리하기 |
| 프로젝트 없음 | 아직 속한 프로젝트가 없습니다 / 문서를 보거나 올리려면 프로젝트에 들어가 있어야 합니다. 관리자에게 아래 키를 프로젝트에 넣어 달라고 요청하세요. 넣어 주면 이 화면을 새로 고치는 것만으로 바로 보입니다. / 관리자에게 함께 보낼 명령 / 명령 복사 |
| AI 안내(빈 상태) | Claude Code 같은 AI 도구에서 바로 올릴 수도 있습니다. AI 도구로 올리는 방법 |
| 검색 placeholder | 제목 또는 문서 ID로 검색 |
| 열 | 제목 · 메모 · 링크 · 크기 · 수정자 · 수정일 |
| 삭제 후 | 문서를 삭제했습니다. |
| 빈 상태(편집자) | 아직 등록한 HTML이 없습니다 / 파일을 올리면 팀원이 열어 볼 수 있는 주소가 만들어집니다. |
| 빈 상태(열람자) | 아직 등록된 문서가 없습니다 / 편집자가 문서를 올리면 여기에 표시됩니다. |
| 검색 0건 | '{q}'와(과) 맞는 문서가 없습니다 / 제목 일부나 문서 ID 앞부분으로 찾을 수 있습니다. / 검색어 지우기 |

### 등록·수정

| 위치 | 문구 |
| --- | --- |
| 입력 방식 | 파일로 올리기 / 직접 붙여넣기 |
| 드롭존 | HTML 파일을 여기로 끌어다 놓거나 [파일 선택] · .html, .htm 파일 · 최대 10MB |
| 드롭존(수정) | 교체할 HTML 파일을 끌어다 놓거나 [파일 선택] |
| 드래그 중 / 읽는 중 | 여기에 놓으세요 / 파일을 읽는 중… |
| 크기 초과 | 10MB를 넘는 파일은 올릴 수 없습니다. (선택한 파일: 12.3 MB) 이미지가 많이 들어 있다면 이미지 크기를 줄여 다시 만들어 주세요. |
| 확장자 오류 | HTML 파일(.html, .htm)만 올릴 수 있습니다. |
| 여러 HTML 파일 | HTML 파일은 하나만 올릴 수 있습니다. (HTML 하나와 이미지 여러 개는 함께 놓을 수 있음) |
| 빈 파일 | 파일 내용이 비어 있습니다. 다른 파일을 선택해 주세요. |
| 다시 선택 | 보안 정책상 파일은 다시 선택해야 합니다. 같은 파일을 다시 끌어다 놓아 주세요. |
| 붙여넣기 placeholder | <!DOCTYPE html>로 시작하는 HTML 코드를 붙여넣으세요 |
| HTML 없음 | HTML 파일을 올리거나 코드를 붙여넣어 주세요. |
| EUC-KR | EUC-KR 파일을 UTF-8로 변환했습니다. 한글이 깨지지 않았는지 저장 후 한 번 확인해 주세요. |
| 경고 제목 | 저장은 할 수 있지만, 일부가 표시되지 않을 수 있습니다 |
| 경고: 상대 경로 | 이 파일만 올라가므로 함께 있던 스크립트·스타일 파일은 동작하지 않습니다. HTML 안에 포함해서 다시 만들어 주세요. 예: js/app.js 외 3개 |
| 이미지 연결 제목 (info) | HTML이 쓰는 이미지 파일을 함께 넣을 수 있습니다 |
| 이미지 연결 본문 | 이 HTML은 함께 올라가지 않는 이미지 파일을 쓰고 있습니다. 파일을 선택하면 HTML 안에 넣어(base64) 함께 저장합니다. 선택하지 않은 이미지는 빈 상자로 표시됩니다. |
| 이미지 일괄 선택 | [여러 파일 한 번에 선택] 파일 이름이 같은 경로에 자동으로 연결합니다 |
| 이미지 행 | 경로(고정폭) · 선택하지 않으면 빈 상자로 표시됩니다 / 파일명 · 크기 · [파일 선택] / [바꾸기] |
| 이미지 요약 | 이미지 3개 중 1개 선택 · 나머지 2개는 빈 상자로 표시됩니다 |
| 이미지 미연결 | 이름이 맞는 경로가 없어 연결하지 못한 파일: a.png, b.png |
| 이미지 형식 오류 | photo.heic은(는) 이미지 파일이 아닙니다. |
| 이미지 포함 후 초과 | 이미지를 넣으니 10MB를 넘습니다. (12.3 MB) 이미지 크기를 줄여서 다시 선택해 주세요. |
| 경고: http | 보안 연결(https)이 아닌 리소스는 브라우저가 차단합니다. 예: http://… |
| 경고: iframe 직접 접근 | iframe 안의 문서를 직접 읽는 코드가 있어, iframe과 연결된 부분(화면 위 표시, 클릭하면 이동 등)이 동작하지 않습니다. 렌더링 화면은 보안상 iframe과 서로 다른 출처로 열립니다. 아래 요청을 AI에게 보내 고치세요. 예: fr.contentDocument |
| 경고 안 요청 상자 | "AI에게 보낼 요청" + [복사] (복사 후 "복사했습니다", 클립보드를 못 쓰면 글을 선택하고 "선택해 두었습니다 (Ctrl+C)"). 본문: 원인(sandbox라 서로의 document에 접근 불가), 고칠 방법(postMessage로 위치 전달·동작 요청), 고쳐야 할 코드 목록(최대 10곳) |
| 제목 힌트 | 파일의 제목으로 자동 입력했습니다. 필요하면 고치세요. |
| 제목 오류 | 제목을 입력해 주세요. / 제목은 200자까지 쓸 수 있습니다. |
| 설명 힌트 | 줄바꿈은 그대로 표시됩니다. 최대 2,000자 |
| 링크 안내 | 이름을 비우면 사이트 주소(예: www.figma.com)로 표시됩니다. |
| 링크 placeholder | 이름 (예: 기획서) / https:// |
| 링크 상한 | 링크는 10개까지 넣을 수 있습니다. |
| 링크 오류 | http:// 또는 https://로 시작하는 주소만 넣을 수 있습니다. (주소가 빈 행은 오류 없이 저장하지 않는다) |
| 오류 요약 | 입력 내용을 확인해 주세요 |
| 환경 안내 summary | 업로드한 HTML에서 안 되는 것 (6가지) |
| 현재 HTML | 현재 HTML {크기} · 마지막 수정 {이름}, {일시} / 새 파일을 올리지 않으면 지금 HTML이 그대로 유지됩니다. |
| 교체 예정 | 저장하면 HTML이 이 파일로 바뀝니다. 공유한 주소는 그대로입니다. |
| 업로드 실패 | 파일을 올리지 못했습니다. 네트워크를 확인하고 다시 저장해 주세요. |
| 409 | 다른 사람이 먼저 수정했습니다 / {이름}님이 {일시}에 이 문서를 수정해서, 내 변경은 저장하지 않았습니다. 입력한 내용은 아래에 그대로 남아 있습니다. 확인한 뒤 다시 저장하면 내 내용으로 바뀝니다. |
| 409 버튼 | 최신 내용 확인 (새 창) / 내 내용으로 다시 저장 |
| 등록 제목 | 새 HTML 등록 · {프로젝트 이름} |
| 저장 공간 부족 | 저장 공간이 부족합니다. 목록의 저장 공간에서 이전 버전이나 안 쓰는 문서를 지운 뒤 다시 저장해 주세요. |

### 상세

| 위치 | 문구 |
| --- | --- |
| 버튼 | 새 창에서 보기 / 렌더링 URL 복사 / 소스 보기 / 소스 다운로드 / 수정 / 삭제 |
| 저장 직후 | 저장했습니다 / 아래 주소를 복사해 메신저로 공유하세요. |
| 교체 후 | 저장했습니다 / 주소는 그대로이니 이미 공유한 링크로 최신 내용을 볼 수 있습니다. |
| 복사 | 복사했습니다 / 자동 복사가 안 됩니다. 주소를 선택해 두었으니 Ctrl+C(Mac은 ⌘C)를 눌러 복사하세요. |
| 비어 있음 | 설명이 없습니다. / 관련 링크가 없습니다. |
| 삭제 confirm | '{제목}' 문서를 삭제할까요? 삭제하면 되돌릴 수 없고, 이미 공유한 주소도 더 이상 열리지 않습니다. |
| 버전 안내 | HTML을 교체할 때마다 이전 HTML이 버전으로 남습니다. 렌더링 URL은 항상 현재 버전을 보여 줍니다. |
| 버전 행 | v{n} [현재] [v{m} 복원] / {이름} · {일시} · {크기} / 보기 · 소스 · 복원 · 삭제 |
| 복원 confirm | v{n}을(를) 복원할까요? 지금 HTML은 이전 버전으로 남고, 렌더링 URL에서 v{n} 내용이 보입니다. |
| 버전 삭제 confirm | v{n}을(를) 지울까요? 지우면 되돌릴 수 없습니다. |
| 복원 후 / 충돌 | 버전을 복원했습니다 / 복원한 내용이 새 버전으로 추가되었고, 렌더링 URL은 그대로입니다. · 복원하지 못했습니다 / 그 사이 다른 사람이 문서를 수정했습니다. … |
| 현재 버전 삭제 시도 | 현재 버전은 지울 수 없습니다 (400) |

### 저장 공간

| 위치 | 문구 |
| --- | --- |
| 제목 | 저장 공간 / 이전 버전 (지우면 공간이 많이 생기는 순서) |
| 요약 | 현재 문서 · 이전 버전 · (프로젝트별) |
| 안내 | {상한}가 차면 업로드가 막힙니다. 오래된 버전을 자동으로 지우지 않습니다. (가득 차면: 가득 차서 새로 올리기와 HTML 교체가 막혀 있습니다. …) |
| 공유 원본 | 다른 버전과 같은 HTML이라 지워도 공간이 늘지 않음 |
| 버튼 / confirm | 선택한 버전 지우기 / 선택한 이전 버전을 지울까요? 지우면 되돌릴 수 없습니다. 현재 버전은 지워지지 않습니다. |
| 결과 | 이전 버전 {n}개를 지웠습니다 / 지운 버전이 없습니다 |

---

## 7. 접근성 체크 포인트

1. **대비:** 위 토큰은 대비를 모두 계산해 확인했다. `fg-subtle`보다 연한 색은 글자에 쓰지 않는다.
2. **포커스:** 모든 상호작용 요소에 `focus-visible:outline-*`을 준다. box-shadow ring 대신 outline을 쓴다(Windows 고대비 모드에서 보이도록). `outline-none`만 단독으로 쓰지 않는다.
3. **드롭존 키보드:** 실제 `<input type="file" class="sr-only">`가 탭 순서에 들어간다. 드래그는 보조 수단이다. 상태가 바뀌면 `aria-live="polite"`로 알린다.
4. **폼:** 모든 입력에 보이는 `<label>`을 둔다. 오류는 `aria-invalid`와 `aria-describedby`로 연결한다. 422/409가 나면 오류 배너로 포커스를 옮긴다.
5. **동적 영역:** 목록 결과 개수와 URL 복사 결과는 live 영역으로 알린다. 성공·경고 배너는 `role="status"`, 오류 배너는 `role="alert"`다.
6. **링크 행:** 행을 추가하거나 삭제하면 포커스를 옮긴다(SCR-03 링크 행 참고). 아이콘 버튼에는 행 번호를 포함한 `aria-label`을 준다.
7. **새 창 링크:** 아이콘과 함께 `sr-only` "(새 창)" 텍스트를 넣는다.
8. **색만으로 구분하지 않는다:** 상태는 아이콘과 제목 문장을 함께 써서 전달한다.
9. **동작 줄이기:** 스피너에 `motion-reduce:animate-none`을 준다.
10. **기타:**
    - `<html lang="ko">`
    - 페이지마다 고유한 `<title>`
    - 본문으로 건너뛰기 링크

---

## 8. 하지 말아야 할 것

1. **관리 화면 안에 렌더링 결과를 넣지 않는다.** 미리보기 iframe, 썸네일, HTML 원본 텍스트 모두 해당한다 (D-03, D-11).
2. **사라지는 토스트로 중요한 결과를 알리지 않는다.** 저장, 409, 422, 경고는 모두 페이지에 남는 배너로 보여 준다.
3. **삭제 확인용 커스텀 모달을 만들지 않는다.** `confirm()`으로 충분하다.
4. **사용자에게 기술 용어와 상태 코드를 그대로 보여 주지 않는다.** "422", "CSP", "CORS" 같은 말은 쓰지 않는다.
5. **JS에서 클래스 이름을 조립하거나 인라인 style을 쓰지 않는다** (0번 규칙).
