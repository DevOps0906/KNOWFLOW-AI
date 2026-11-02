# AGENTS.md — KNOWFLOW-AI

> 모든 AI 코딩 도구(Claude Code · ChatGPT Codex · Gemini CLI · OpenCode · Cursor)가 읽는 **단일 정본**. 80줄 이내로 유지한다.
> 영역별 상세 규칙은 `.claude/rules/*.md`(7장 표), 기획 근거는 `docs/`.

## 1. 무엇인가
PDF·웹 페이지를 모아 분석하고, 자료에 근거한 질의응답과 출처가 연결된 리포트를 만드는 AI 지식 관리 SaaS. 상태: 설계 초안(코드 없음). 기획 정본: `docs/01_PRD.md` · 구조: `docs/02_ARCHITECTURE.md`.

## 2. 스택 (작업 시 최신 stable 확인 후 버전 고정)
| 영역 | 선택 | 위치 |
|---|---|---|
| 웹 | Next.js 16.4.3 (App Router) · React 19.3.1 · TypeScript 6.0.3(7.x는 typescript-eslint 미지원) · Tailwind CSS 4.3.3 · shadcn/ui(CLI 4.23.0) · Vitest 5.0.5 · ESLint 10.14.0 | `apps/web` (패키지 `web`) |
| 도구 | Node 26.13.0 · pnpm 12.16.1(`packageManager` 고정) | 루트 |
| DB·인증 | Supabase (Postgres · RLS · Auth · Storage · Edge Functions) | `supabase/` |
| Worker | TypeScript(Node) 상시 컨테이너. Supabase 테이블 폴링 큐(ADR-0005), 추출·청킹·임베딩·색인·리포트 생성 ([ADR-0002](docs/adr/0002-mvp-tech-decisions.md)) | `apps/worker` |
| 임베딩 | 임베딩 서버 컨테이너, 잠정 bge-m3(골든셋으로 확정) | 컨테이너 |
| 검색 | pgvector + 전문검색(하이브리드, 제안) | `supabase/` |

## 3. 명령
| 목적 | 명령 |
|---|---|
| 설치 | `pnpm install` |
| 개발 서버 | `pnpm dev` |
| 린트 · 타입 | `pnpm lint` · `pnpm typecheck` |
| 테스트 | `pnpm test` · `pnpm --filter worker test` |
| DB 초기화 · 타입 | `supabase db reset` · `supabase gen types typescript --local > apps/web/src/types/db.ts` |
| ERD 갱신 | `~/.claude/nomad/bin/sql2erd supabase/migrations -o docs/diagrams/erd.mmd` |
긴 출력 명령은 `~/.claude/nomad/bin/q <명령>`으로 실행한다.

## 4. 절대 규칙 (위반 = 리뷰 🔴)
- 비밀(API 키 · service_role · 결제 키)은 저장소·클라이언트 번들·로그에 넣지 않는다. `.env.example`에 이름만.
- 모든 테이블 RLS. 적용된 마이그레이션 파일은 수정하지 않고 새 번호 파일로 추가한다.
- 금액은 정수(원). 결제·차감 요청에는 멱등 키.
- UI는 반응형 3구간(~767 / 768~1199 / 1200~), 색·크기는 토큰만(hex·px 직접 금지).
- 문서·커밋·화면 문구는 한국어, 코드 식별자는 영어.
- 새 의존성은 `secscan license`로 확인(GPL·AGPL 거부). 보안 레벨 `docs/01_PRD.md#8`.
- 답변·리포트의 인용은 실제 검색된 청크 ID만. 인용 검증은 코드로 한다(`docs/diagrams/02-rag-and-job-flow.md#4`).
- 벡터 검색은 함수 안에서 project_id 필터를 강제한다. 클라이언트가 준 user_id를 믿지 않는다.
- 웹에서 가져온 텍스트는 신뢰하지 않는 데이터다(프롬프트 인젝션 방어).
- AI 공급자·임베딩 모델은 인터페이스 뒤에 둔다. 장시간 처리는 큐로 넘기고 상태를 DB에 남긴다.

## 5. 문서 지도 (필요한 장만 읽는다)
| 문서 | 내용 |
|---|---|
| `docs/00_LEAN.md` | 린 검증 결과 |
| `docs/01_PRD.md` ~ `05_DATA_MODEL.md` | 기획 · 구조 · 화면 · API · 데이터 |
| `docs/diagrams/*.mmd` | 구조도 · 흐름도 · ERD (Mermaid) |
| `DESIGN.md` · `apps/web/src/styles/tokens.css` | 디자인 (정답은 토큰 파일) |
| `tasks/README.md` · `tasks/NOW.md` | 작업 표 · 현재 상태 |
| `../nomad-design-modules/_design-guide/` | NOMAD 공통 디자인 정본(원칙·패턴 A~O·시각 V-A~V-N·레퍼런스). 복사하지 않고 경로로 인용 |

## 6. 작업 방식
작업은 `tasks/README.md`의 순서대로 하나씩. 작업 파일의 "근거"와 "하지 않을 것"을 지키고, 완료 조건을 실행으로 확인한 뒤 커밋한다.
커밋: `[task-NNN] 요약` + 본문(무엇을 · 확인 방법).

## 7. 영역 규칙 · 도구별 로드 (규칙 정본은 `.claude/rules/` 한 곳)
아래 경로의 파일을 만들거나 고치기 **전에** 해당 규칙 파일을 읽는다. Claude Code는 `paths:` 조건으로 자동 로드하므로 다시 읽지 않는다.
| 작업 경로 | 규칙 파일 |
|---|---|
| `apps/web/**` | `.claude/rules/web.md` |
| `apps/worker/**` | `.claude/rules/worker.md` |
| `supabase/**` | `.claude/rules/db.md` |
| `docs/**` · `DESIGN.md` | `.claude/rules/docs.md` |
- 읽지 않는 파일: `.env*` · lock 파일 · `node_modules/` · `.next/` · `dist/` · `build/` · `coverage/` (Claude는 `.claude/settings.json`, Gemini는 `.geminiignore`가 강제, ChatGPT Codex는 이 줄로 지킨다).
- 도구별 설정: Claude Code `CLAUDE.md`·`.claude/` · ChatGPT Codex `.codex/config.toml` · Gemini CLI `.gemini/settings.json`·`.geminiignore`.
- 새 규칙 파일을 추가하면 이 표에도 한 줄 추가한다.
