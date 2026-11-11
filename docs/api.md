# AI·스크립트로 올리기 안내

웹 화면을 거치지 않고 render-box에 HTML을 올리는 두 가지 방법을 설명합니다.

| 방법 | 이런 분께 | 한도 |
| --- | --- | --- |
| [MCP](#1-ai-도구에서-올리기-mcp) | Claude Code 같은 AI 도구로 HTML을 만들고 바로 공유하려는 분 | 1MB |
| [REST API](#2-스크립트에서-올리기-rest-api) | curl, 빌드 스크립트, CI에서 자동으로 올리려는 분 | 10MB |

두 방법 모두 **웹 로그인에 쓰는 개인 접근 키**를 그대로 씁니다. 따로 발급받을 것은 없습니다.

- 문서는 프로젝트(예: `tamna`)에 속하고, 키는 프로젝트마다 역할을 받습니다. 응답의 `project`가 문서의 프로젝트입니다.
- **편집자(EDITOR)인 프로젝트:** 올리기, 고치기, 조회
- **열람자(VIEWER)인 프로젝트:** 조회만
- **속하지 않은 프로젝트:** 문서가 없는 것처럼 404가 나옵니다.
- 올릴 때 편집할 수 있는 프로젝트가 하나면 프로젝트를 빼도 되고, 여럿이면 `project`를 넣어야 합니다.
- **관리자 키:** 모든 프로젝트(새로 만든 것 포함)에서 편집자와 같습니다. 목록·조회에 모든 프로젝트 문서가 나오고, 다른 키가 만든 문서도 고칠 수 있습니다. 편집할 수 있는 프로젝트가 여럿이므로 올릴 때는 `project`를 꼭 넣으세요. 키·프로젝트 관리 기능은 API에 없습니다.
- **문서 삭제:** 어느 방법으로도 할 수 없습니다. 실수로 지워지지 않도록 웹 화면에서만 삭제합니다.

## 주소

| 환경 | API 주소 |
| --- | --- |
| 로컬 개발 | `http://api.localhost:8789` |
| 운영 | `https://render-box-api.<계정>.workers.dev` (배포 후 확정) |

아래 예시는 주소와 키를 환경 변수로 둔다고 가정합니다.

```sh
export RB_API=http://api.localhost:8789
export RB_KEY=rb_...          # 본인 접근 키
```

> 키는 비밀번호와 같습니다. 채팅방, 저장소, 공유 문서에 붙여 넣지 마세요. 유출이 의심되면 운영자에게 회수와 재발급을 요청하세요.

---

## 1. AI 도구에서 올리기 (MCP)

### 연결 (Claude Code)

```sh
claude mcp add --transport http render-box "$RB_API/mcp" \
  --header "Authorization: Bearer $RB_KEY"
```

`claude mcp list`에서 `render-box`가 연결됨(✓)으로 보이면 준비가 끝난 것입니다. 다른 MCP 클라이언트도 **Streamable HTTP** 방식과 **`Authorization` 헤더**를 지원하면 같은 주소로 연결됩니다.

> 키는 클라이언트 설정 파일에 그대로 저장됩니다. 공용 PC에서는 연결하지 마세요. AI 도구용 키를 따로 받아 두면, 문제가 생겼을 때 그 키만 회수할 수 있습니다.

연결이나 도구 설명은 세션을 시작할 때 읽습니다. render-box가 업데이트되어 안내가 바뀌면 새 세션을 여세요.

### 이렇게 말하면 됩니다

- "회원가입 화면 HTML 만들어서 render-box에 올려 줘"
- "방금 만든 화면에서 버튼 색만 바꿔서 render-box 문서 업데이트해 줘"
- "render-box에서 '결제' 들어간 문서 찾아 줘"
- "render-box 문서 `AbCd...` 원본 가져와서 모바일 레이아웃으로 고쳐 줘"

올리고 나면 AI가 **렌더링 URL**을 알려 줍니다. 이 주소를 팀원에게 보내면 됩니다. 팀원은 로그인한 뒤 새 창에서 봅니다.

### 도구

| 도구 | 권한 | 하는 일 |
| --- | --- | --- |
| `upload_html` | 편집자 | 새 문서 올리기 → `render_url` |
| `update_html` | 편집자 | 넘긴 항목(HTML, 제목, 설명, 링크)만 바꾸기. 주소는 그대로, 이전 HTML은 버전으로 남음 |
| `list_html` | 전체 | 제목이나 문서 키로 찾기 |
| `get_html` | 전체 | 문서 정보와 HTML 원본(1MB 이하) |

### 알아 둘 점

- **HTML은 1MB까지 올릴 수 있습니다.** AI가 HTML 전체를 요청 안에 담아 보내야 하기 때문입니다. 더 큰 파일은 웹 화면이나 REST API로 올리세요.
- **경고 (`warnings`):** 렌더링에서 동작하지 않을 코드가 있으면 `upload_html`·`update_html`이 저장은 하고 결과에 경고를 붙입니다. 지금 검사하는 것은 iframe 직접 접근(`contentDocument`, `contentWindow.document`, `parent.document` 등)입니다. 결과 첫 줄에 "⚠ 저장은 했지만…" 문장이 오고, JSON에도 들어갑니다.

  ```json
  "warnings": [{ "code": "frame_access", "message": "iframe 안의 문서를 직접 읽는 코드가 있어 …", "examples": ["fr.contentDocument"] }]
  ```

  AI는 사용자에게 알리고 `postMessage` 방식으로 고쳐 `update_html`로 다시 올립니다. 경고 종류와 대처는 [사용 안내](guide.md#올릴-때-나오는-경고)에 있습니다. REST API는 HTML을 해석하지 않아 경고를 주지 않습니다.
- **같은 폴더의 이미지 파일은 함께 올라가지 않습니다.** 이미지는 HTML 안에 base64(`data:`)로 넣거나 `https://` 주소를 써야 합니다. AI에게도 그렇게 안내되어 있습니다.

---

## 2. 스크립트에서 올리기 (REST API)

모든 요청에 `Authorization: Bearer $RB_KEY` 헤더를 붙입니다. HTML 파일은 요청 본문에 **그대로** 보냅니다. 서버는 받은 바이트를 바꾸지 않고 저장하므로 EUC-KR 같은 인코딩도 그대로 유지됩니다.

### 새로 올리기

```sh
curl "$RB_API/api/v1/html" \
  -H "Authorization: Bearer $RB_KEY" \
  --url-query "project=tamna" \
  --url-query "title=회원가입 화면" \
  --url-query "description=1차 기획안" \
  --url-query "link=기획서|https://example.com/spec" \
  --url-query "link=https://figma.com/file/..." \
  --data-binary @signup.html
```

| 쿼리 | 필수 | 설명 |
| --- | :---: | --- |
| `project` | △ | 올릴 프로젝트 slug. 편집할 수 있는 프로젝트가 하나면 빼도 됩니다 |
| `title` | O | 제목 (최대 200자) |
| `description` | | 설명 (최대 2,000자) |
| `link` | | 관련 링크. 여러 번 쓸 수 있습니다(최대 10개). `이름\|주소` 또는 주소만. 주소가 빈 링크는 오류 없이 빠집니다 |

> 한글이나 공백이 있는 값은 `--url-query`로 넣으세요. 주소에 바로 쓰면 curl이 요청을 보내지 않습니다. `--url-query`는 curl 7.87 이상에서 쓸 수 있습니다.

응답 (`201 Created`):

```json
{
  "document_key": "wnajOnBv8zrEA5IsdXhHhf",
  "project": "tamna",
  "title": "회원가입 화면",
  "render_url": "https://render.../wnajOnBv8zrEA5IsdXhHhf",
  "admin_url": "https://admin.../html/wnajOnBv8zrEA5IsdXhHhf",
  "html_size": 48213,
  "version": 1
}
```

스크립트에서 렌더링 URL만 꺼내려면 이렇게 합니다.

```sh
curl -s "$RB_API/api/v1/html" -H "Authorization: Bearer $RB_KEY" \
  --url-query "title=회원가입 화면" --data-binary @signup.html | jq -r .render_url
```

### HTML 바꾸기 (주소 유지)

```sh
curl -X PUT "$RB_API/api/v1/html/<문서키>/source" \
  -H "Authorization: Bearer $RB_KEY" \
  --data-binary @signup.html
```

### 제목·설명·링크 바꾸기

보낸 항목만 바뀝니다. 빈 문자열을 보내면 설명이 지워지고, 빈 배열을 보내면 링크가 모두 지워집니다.

```sh
curl -X PATCH "$RB_API/api/v1/html/<문서키>" \
  -H "Authorization: Bearer $RB_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "회원가입 화면 v2", "links": [{"label": "기획서", "url": "https://example.com/spec"}]}'
```

### 조회

```sh
curl "$RB_API/api/v1/html" -H "Authorization: Bearer $RB_KEY" --url-query "q=회원가입"   # 목록·검색 (20개씩, &page=2 …, &project=tamna로 한 프로젝트만)
curl "$RB_API/api/v1/html/<문서키>" -H "Authorization: Bearer $RB_KEY"                 # 문서 정보
curl "$RB_API/api/v1/html/<문서키>/source" -H "Authorization: Bearer $RB_KEY" -o doc.html  # 원본 내려받기
curl "$RB_API/api/v1/html/<문서키>/versions" -H "Authorization: Bearer $RB_KEY"       # 버전 목록
```

HTML을 바꿀 때마다 이전 HTML은 버전으로 남습니다. 버전 목록의 `render_url`로 이전 버전을 볼 수 있고, 복원과 삭제는 웹 화면에서 합니다.

### 다른 사람의 수정 덮어쓰지 않기 (선택)

문서 정보 응답의 `version`(또는 `ETag` 헤더)을 수정 요청의 `If-Match` 헤더에 넣으면, 그 사이 누가 문서를 고쳤을 때 덮어쓰지 않고 `412`로 알려 줍니다.

```sh
curl -X PUT "$RB_API/api/v1/html/<문서키>/source" \
  -H "Authorization: Bearer $RB_KEY" -H 'If-Match: "3"' \
  --data-binary @signup.html
```

### 오류

오류는 항상 아래 형식이고, `message`는 그대로 사용자에게 보여 줘도 되는 한글 문장입니다.

```json
{ "error": { "code": "invalid_fields", "message": "제목을 입력해 주세요." } }
```

| 상태 | `code` | 뜻 |
| --- | --- | --- |
| 400 | `invalid_fields` | 제목·설명·링크가 규칙에 맞지 않음 |
| 400 | `bad_json`, `bad_if_match` | PATCH 본문이나 `If-Match` 형식이 잘못됨 |
| 401 | `unauthorized` | 키가 없거나 틀림, 또는 회수된 키 |
| 400 | `project_required` | 편집할 수 있는 프로젝트가 여럿인데 `project`를 빼고 올림 |
| 403 | `forbidden` | 그 프로젝트에서 열람자인데 쓰기를 시도함 |
| 404 | `project_not_found` | 속하지 않았거나 없는 프로젝트를 지정함 |
| 403 | `origin_not_allowed` | 브라우저 페이지에서 호출함 (지원하지 않음) |
| 404 | `not_found` | 없는 문서나 경로 |
| 409 | `conflict` | 같은 순간에 다른 수정이 먼저 저장됨. 다시 시도 |
| 412 | `version_mismatch` | `If-Match` 버전이 최신이 아님 |
| 413 | `too_large` | HTML이 10MB를 넘음 |
| 422 | `empty`, `nul_byte` | 본문이 비었거나 HTML이 아닌 파일(NUL 문자 포함) |
| 429 | `locked` | 키 인증 실패가 많아 잠김. 30초 뒤 다시 시도 |
| 507 | `storage_full` | 저장 공간(기본 400MB)이 가득 참. 웹 화면의 저장 공간에서 이전 버전이나 안 쓰는 문서를 지운 뒤 다시 시도 |

---

## 자주 묻는 질문

**웹 화면에서 올린 문서와 다른가요?**
같습니다. 어느 방법으로 올려도 같은 목록에 보이고, 웹 화면에서 고치거나 지울 수 있습니다.

**이미지가 깨져 보여요.**
API와 MCP는 HTML만 저장합니다. 이미지를 HTML 안에 base64로 넣거나 `https://` 주소를 쓰세요. 웹 화면에서 올리면 이미지 파일을 함께 넣을 수 있습니다.

**사내망·회사 PC에서 연결이 안 돼요.**
조직의 보안 프로그램이 이 주소로 가는 통신을 막고 있을 수 있습니다. 보안 정책을 피하는 방법을 쓰지 말고 보안 담당자에게 문의하세요.

**브라우저 JavaScript에서 바로 부를 수 있나요?**
아니요. 키가 페이지에 노출되지 않도록, 브라우저 페이지에서 오는 요청은 거부합니다.
