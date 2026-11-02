# 02 아키텍처 — KNOWFLOW-AI

> **조건부**: `00_LEAN.md` 린 검증 통과 전 초안이다. 통과 전 정식 개발 금지.
> 그림(정본): 시스템 구조 [`diagrams/01-system-architecture.md`](diagrams/01-system-architecture.md) · RAG·작업 흐름 [`diagrams/02-rag-and-job-flow.md`](diagrams/02-rag-and-job-flow.md) · 요약 [`diagrams/architecture.mmd`](diagrams/architecture.mmd)(코드가 생기면 `deps2mmd`로 재생성). 그림의 사실은 복사하지 않는다.
> 테이블·RLS: [`05_DATA_MODEL.md`](05_DATA_MODEL.md). 화면: [`03_SCREENS_UX.md`](03_SCREENS_UX.md). API: [`04_API.md`](04_API.md).
> 채택 패턴: [`blueprints/contracts/JOBS.md`](blueprints/contracts/JOBS.md)(작업·재시도), [`ACCESS.md`](blueprints/contracts/ACCESS.md)(서비스 키), [`rag-chat/adr.md`](blueprints/rag-chat/adr.md)(pgvector+전문검색). 조직·역할 다중 테넌트는 MVP 제외.

## 1. 구성 요소
| 요소 | 책임 | 기술 | 소유 경로 |
|---|---|---|---|
| 화면 | 렌더링, 서버에서 인증 상태 확인 | Next.js App Router (버전 미확인: 착수 시 최신 stable 확인) | `apps/web/app` (제안) |
| Route Handlers | 인증, 입력 검증, 소유권 교차 검증, 오류 응답 | Next.js | `apps/web/app/api` (제안) |
| 서비스 계층 | projects·sources·reports·usage 업무 로직, DB 접근 | TypeScript | `apps/web/src/services` (제안) |
| AI 오케스트레이션 | 검색, 프롬프트 구성, 모델 라우팅(제안), 사용량 기록 | 공급자 인터페이스 뒤에 Claude API | `apps/web/src/ai` (제안) |
| 쿼터·rate limit (제안) | 사용자별 질문·자료 한도 확인 | `plans`·`user_quotas` | 서비스 계층 |
| 인용 검증 (제안) | 인용 ID가 실제 검색된 청크인지 코드로 확인 | 서버 코드 | AI 오케스트레이션 |
| 작업 큐 | 처리 작업 보관·상태 | `processing_jobs`(Supabase 기반, 구현 방식 미정 §5) | `supabase/migrations` |
| Worker | 추출·청킹·임베딩·색인·상태 갱신 | 웹 요청과 분리된 실행 환경(미정 §5) | `apps/worker` (제안) |
| Supabase | Auth, PostgreSQL+RLS, pgvector+전문검색, Storage | Supabase | `supabase/` |
| 외부 공급자 | LLM, 임베딩 | Claude API, 임베딩 모델 미정 | 인터페이스 뒤 |

## 2. 경계 규칙 (누가 누구를 부르나)
| 호출자 | 대상 | 방법 | 금지 |
|---|---|---|---|
| 브라우저 | Route Handlers | HTTPS, Supabase 세션 쿠키 | AI 공급자·서비스 키 직접 접근 |
| 브라우저 | Supabase | 사용자 JWT + RLS가 허용한 읽기만 | 쓰기·상태 전이 직접 수행 |
| Route Handlers | 서비스 계층 | 함수 호출 | 요청 본문 user_id 신뢰, 장시간 처리 |
| 서비스 계층 | 작업 큐 | `processing_jobs` 행 생성(멱등 키 포함) | Worker 직접 호출 |
| Worker | Supabase | 서비스 키로 상태 갱신·청크 저장 | 서비스 키를 브라우저·로그에 노출 |
| AI 오케스트레이션 | 검색 함수 | `project_id`·`user_id` 강제 함수 호출 | 프로젝트 간 검색, 근거 없는 출처 생성 |
| 서비스·Worker | AI·임베딩 공급자 | 인터페이스 어댑터 | 공급자 SDK를 업무 로직에 직접 의존 |
| 서비스 | 웹 URL | SSRF·리디렉션 검사 후 fetch | 사설망·메타데이터 주소 접근 |
| 저장소 경로 | Storage | 첫 폴더 = `user_id`, 읽기는 서명 URL | 공개 버킷에 원본 저장 |
- 가져온 웹 텍스트는 신뢰하지 않는 데이터로 다룬다(프롬프트 인젝션 방어).
- 상태 전이는 서버 함수만 수행한다. 사용자는 재시도·취소 요청만 보낸다([JOBS.md](blueprints/contracts/JOBS.md)).

## 3. 주요 흐름
| 흐름 | 요약 | 그림·근거 |
|---|---|---|
| 자료 수집 | 검증 → 원본 저장 → 해시 중복 확인 → 작업 생성 → Worker 처리 → 완료/실패 | [`02-rag-and-job-flow §1`](diagrams/02-rag-and-job-flow.md) |
| 자료 처리 상태 | `queued`→`processing`→`completed`/`failed`, 사용자 재시도 | [`02-rag-and-job-flow §2`](diagrams/02-rag-and-job-flow.md) |
| 질의응답 | 쿼터 → 하이브리드 검색 → 생성 → 인용 검증(실패 시 1회 재생성) → 저장 | [`02-rag-and-job-flow §3`](diagrams/02-rag-and-job-flow.md) |
| 사용자 흐름 | 가입→첫 자료→첫 질문, 리포트 | [`flow-F-01.mmd`](diagrams/flow-F-01.mmd)~[`F-04`](diagrams/flow-F-04.mmd) |
| 화면 이동 | 사이트맵·레이아웃 | [`sitemap.mmd`](diagrams/sitemap.mmd), [`04-screen-map-and-layout`](diagrams/04-screen-map-and-layout.md) |

## 4. 매체 확장 포인트
| 확장 대상 | 방법 | MVP |
|---|---|---|
| 새 매체 | Worker의 매체별 추출 단계(어댑터)만 추가. 후행 단계(정규화·청킹·임베딩·색인)는 공통 | pdf·url만 |
| 인용 위치 | `source_chunks.locator` jsonb 키만 늘린다. 뷰어는 source_type별 렌더러 | 페이지·문자 범위 |
| 단계 표 | [`05_DATA_MODEL.md#4`](05_DATA_MODEL.md) | 추출·OCR·전사는 이후 |
| 공급자·모델 교체 | 인터페이스 뒤 + `embedding_model` 기록으로 재색인 대상 식별 | Claude API |

## 5. 미정 (Phase 0 결정 기록 대상)
| 항목 | 후보 | 상태 |
|---|---|---|
| 작업 큐 | Supabase 기반(pgmq 또는 테이블 폴링), 별도 큐 | MVP는 Supabase 기반 제안. 처리량 한도 **미확인**(착수 시 측정) |
| Worker 실행 환경 | 서버리스 함수, 상시 컨테이너 | 큰 PDF 처리 시간 측정 후 결정. **팀장 결정 필요** |
| 임베딩 모델 | 다국어 모델(후보: bge-m3 등) | 한국어 골든셋 비교 후 결정. 라이선스·순위 **미확인** |
| 하이브리드 검색 | 벡터 + 전문검색 | 한국어 키워드 방식(PGroonga·pg_trgm) 실험 후 확정, Supabase 확장 가능 여부 **미확인** |
| 청킹 크기·겹침 | — | 골든셋 실험 후 ADR로 기록 |
| 인프라·배포 | — | `01_PRD.md#8` 보안 레벨(L1→L2)에 맞춰 결정. `docs/adr/`에 ADR 작성 |
