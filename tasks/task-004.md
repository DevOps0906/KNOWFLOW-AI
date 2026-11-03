# task-004 W1 Supabase 마이그레이션 12테이블 + idempotency_keys + 쓰기 RPC + RLS

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-003 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 · 키·권한 (RLS, 쓰기 권한 회수, 서비스 키) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md#1`, `docs/05_DATA_MODEL.md#2`, `docs/05_DATA_MODEL.md#6`, `docs/adr/0002-mvp-tech-decisions.md`, `docs/01_PRD.md#8-1` |
| 쓰기 허용 | `supabase/**`, `packages/db-tests/**`(새 패키지), `pnpm-workspace.yaml`(packages/* 추가만), 루트 `package.json`(scripts만)·`pnpm-lock.yaml`, `.github/workflows/ci.yml`(DB 테스트 job 추가만), `docs/diagrams/erd.mmd` |

## 할 것
- 13테이블(profiles·projects·sources·source_chunks·processing_jobs·conversations·messages·reports·report_citations·usage_events·plans·user_quotas) + `idempotency_keys` 마이그레이션, 모든 테이블 RLS
- 가입 트리거(profiles), 부분 유니크(진행 중 작업 1개), unique (project_id, content_hash), CHECK
- `processing_jobs`에 `user_id`·`locked_until`·`heartbeat_at` 추가(lease는 task-010이 사용), 소프트 삭제 컬럼
- pg_trgm 활성화(pgvector는 task-013). 검색 함수는 task-014
- 사용자 롤(authenticated·anon)의 테이블 INSERT/UPDATE/DELETE 권한 회수 → 모든 쓰기는 RPC(SECURITY DEFINER, `search_path` 고정, 함수 안에서 소유자 검증)
- 쿼터 5종 시드(`plans`, 한도는 `PRD#8-1`) + `consume_quota` RPC(원자적 차감·취소, 동시 요청에도 초과 불가), `enqueue_job` RPC(sources·processing_jobs 행 생성, 큐는 테이블 폴링), `idempotency_keys`(키·요청 해시·결과)
- 카탈로그 기반 RLS 게이트: `public` 전체 테이블 RLS 활성·정책 존재, SECURITY DEFINER 함수 `search_path`·EXECUTE 권한 점검
- Storage 버킷: 경로 첫 폴더 = user_id, 서명 URL만

## ADR-0005 반영 (팀장 결정, 2026-11-02)
- Docker·Supabase CLI 없음 → DB 테스트는 `packages/db-tests`(패키지 이름 `db-tests`): Vitest + `pg`, 로컬은 `embedded-postgres`로 실제 서버, `TEST_DATABASE_URL`이 있으면 그것 사용. CI는 Postgres 17 서비스 컨테이너.
- 테스트 전용 Supabase 호환 SQL(`packages/db-tests/bootstrap.sql`): 역할·auth 스키마·auth.uid()·Supabase 기본 권한 재현·storage 최소 스키마. 운영 마이그레이션(`supabase/migrations`)과 분리.
- 큐는 pgmq 대신 `processing_jobs` 테이블 폴링. `enqueue_job`은 행 생성만. pgvector는 task-013으로.
- DB 타입(`apps/web/src/types/db.ts`)은 개발 Supabase 프로젝트 연결 시점으로 미룸.

## 착수 전 challenger 반영 (팀장 결정)
- 규칙 정본: `docs/05_DATA_MODEL.md#7`(권한 REVOKE ALL·DEFINER 함수 규칙·쿼터·멱등 키·소프트 삭제·작성 주체). plans 시드는 `beta` 1종(한도 5개 = PRD 8-1), 월 경계 Asia/Seoul.
- 이 작업이 만드는 RPC: `consume_quota`(내부), `refund_quota`(service_role 전용), `claim_idempotency_key`(내부 헬퍼), `enqueue_job`(내부, 기능 RPC가 호출), `update_profile`(authenticated). 기능 쓰기 RPC는 각 기능 작업.
- 워크스페이스에 `packages/*` 추가. 루트 `test`는 db-tests 제외(`--filter '!db-tests'`), 새 루트 스크립트 `test:db`는 `pnpm --filter db-tests --fail-if-no-match test`. CI는 별도 `db` job(Postgres 17 서비스)에서 `test:db`.
- bootstrap은 ADR-0005 표대로(함수·시퀀스 기본 권한, PUBLIC EXECUTE, service_role BYPASSRLS, supabase_auth_admin). 단언은 `SET LOCAL ROLE` + JWT 클레임으로만.
- 실제 Supabase 확인 항목은 `docs/security/supabase-verify.md`(팀장 작성 완료).

## 하지 않을 것
- 적용된 마이그레이션 수정(새 번호 추가만), 앱 화면 코드, 검색 함수(task-014)

## 완료 조건 (실행 가능한 확인)
- [x] `pnpm test:db`가 빈 Postgres에 호환 SQL + 모든 마이그레이션을 순서대로 적용하고 통과
- [x] RLS 위반 테스트(타인 행 접근 실패, 직접 SELECT 금지 테이블) 통과 — CI `db` job으로 실행
- [x] anon 키로 테이블에 직접 INSERT 시 거부되는 테스트 통과
- [x] 카탈로그 게이트 테스트(RLS 미적용 테이블·search_path 미고정 DEFINER 함수·anon/authenticated에 열린 쓰기 권한이 있으면 실패) 통과
- [x] 테스트: `consume_quota` 동시 N연결 요청에서 차감 총량이 한도를 넘지 않음, `refund_quota`는 service_role만·음수 불가, authenticated가 consume·refund·enqueue를 직접 호출하면 거부
- [x] 테스트: 소프트 삭제된 프로젝트·하위 행이 SELECT에 안 보임, 같은 멱등 키 동시 요청에서 자원 1개, supabase_auth_admin으로 auth.users INSERT 시 profiles·user_quotas 생성
- [x] 게이트: anon EXECUTE 가능한 DEFINER 함수 0개, authenticated EXECUTE 목록 = 허용 목록, TRUNCATE·REFERENCES·TRIGGER 권한 0
- [x] `sql2erd supabase/migrations -o docs/diagrams/erd.mmd` 생성, `mmd-check` 통과
