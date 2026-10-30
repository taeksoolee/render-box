# render-box

기획·운영자가 올린 HTML을 개발자·디자이너가 URL 하나로 바로 열어 보는 사내 도구입니다.

AI로 만든 HTML 프로토타입을 메신저로 주고받는 대신, 파일을 올리면 고유 URL이 생깁니다. 받은 사람은 링크를 눌러 새 창에서 실제 동작을 확인합니다. 올라온 HTML은 관리 화면과 분리된 렌더링 호스트에서 격리되어 실행됩니다.

## 상태

설계 완료, MVP 1 구현 전

## 문서

| 문서 | 독자 | 내용 |
| --- | --- | --- |
| [docs/prd.md](docs/prd.md) | 기획자, 팀 전체 | 목적, 사용 흐름, 로드맵, 화면, 완료 기준 |
| [docs/design.md](docs/design.md) | 개발자 | 시스템 구성, 인증, 렌더링 격리, DB, 라우팅, 테스트 계획 |
| [docs/decisions.md](docs/decisions.md) | 설계를 다시 검토하는 사람 | 주요 결정과 기각한 대안 |

설계를 바꾸려면 먼저 [docs/decisions.md](docs/decisions.md)에서 해당 결정의 기각 이유를 확인하세요.

## 기술 스택

Node.js, Hono, HTMX, PostgreSQL, Drizzle ORM, Tailwind CSS, Docker
