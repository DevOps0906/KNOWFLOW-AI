# ADR-0005 DB 테스트 환경과 작업 큐 방식

- 상태: 채택 (2026-11-02, task-004 착수 전)
- 날짜: 2026-11-02

| 항목 | 내용 |
|---|---|
| 맥락 | 개발 PC에 Docker·Supabase CLI가 없어 `supabase db reset` 기반 검증을 할 수 없다. 그래도 RLS·권한 회수·쿼터 동시성은 실제 Postgres에서 검증해야 한다. ADR-0002는 큐를 "pgmq 우선, 불가 시 테이블 폴링"으로 열어 두었다. |
| 선택 | 아래 표. |
| 대안 | Docker Desktop 설치(무겁고 관리자 권한 필요), 클라우드 개발 프로젝트(비용·외부 상태), PGlite(WASM, 단일 연결이라 동시성 검증 불가), pgmq 유지(확장 의존, 로컬 검증 불가). |
| 결과 | Docker 없이 로컬·CI에서 같은 테스트가 돈다. 실제 Supabase와의 차이(기본 권한·auth 스키마)는 호환 준비 스크립트로 흉내 내므로, 개발 Supabase 프로젝트가 생기면 같은 마이그레이션을 한 번 적용해 확인한다. |

| 항목 | 결정 |
|---|---|
| 로컬 DB 테스트 | `embedded-postgres`로 실제 Postgres 서버를 띄우고 Vitest + `pg`로 테스트. 연결은 `TEST_DATABASE_URL`이 있으면 그것을 쓴다 |
| CI DB 테스트 | GitHub Actions Postgres 17 서비스 컨테이너, 같은 테스트 |
| Supabase 호환 준비 | 테스트 전용 SQL: 역할 `anon`·`authenticated`·`service_role`, `auth.users`·`auth.uid()`·`auth.role()`(요청 JWT 클레임에서 읽음), Supabase 기본 권한(public 테이블·시퀀스·함수 ALL, 함수 PUBLIC EXECUTE)·`service_role` BYPASSRLS·`supabase_auth_admin`(auth.users INSERT 주체)을 재현, `storage` 최소 스키마. 검사는 superuser가 아니라 `SET LOCAL ROLE` + JWT 클레임으로만. 운영 마이그레이션에는 들어가지 않는다 |
| 작업 큐 | pgmq 대신 `processing_jobs` 테이블 폴링(`FOR UPDATE SKIP LOCKED` + `locked_until` 임대). `enqueue_job`은 같은 트랜잭션에서 행만 만든다 |
| pgvector | 벡터 컬럼과 함께 task-013에서 활성화 |
| 실제 Supabase 확인 | Storage 정책·가입 트리거·Auth 연동은 흉내로 검증할 수 없다 → `docs/security/supabase-verify.md` 목록으로 관리하고 task-005 완료 전 개발 Supabase 프로젝트에서 확인 |
| DB 타입 생성 | Supabase CLI가 Docker를 요구하면 개발 Supabase 프로젝트 연결 시점으로 미룬다(그 전까지 `apps/web/src/types/db.ts`는 만들지 않는다) |
