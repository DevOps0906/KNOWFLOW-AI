# task-004 W1 Supabase 마이그레이션 12테이블 + idempotency_keys + 쓰기 RPC + RLS

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-003 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 · 키·권한 (RLS, 쓰기 권한 회수, 서비스 키) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md#1`, `docs/05_DATA_MODEL.md#2`, `docs/05_DATA_MODEL.md#6`, `docs/adr/0002-mvp-tech-decisions.md`, `docs/01_PRD.md#8-1` |
| 쓰기 허용 | `supabase/**`, `apps/web/src/types/db.ts`, `docs/diagrams/erd.mmd` |

## 할 것
- 12테이블(profiles·projects·sources·source_chunks·processing_jobs·conversations·messages·reports·report_citations·usage_events·plans·user_quotas) + `idempotency_keys` 마이그레이션, 모든 테이블 RLS
- 가입 트리거(profiles), 부분 유니크(진행 중 작업 1개), unique (project_id, content_hash), CHECK
- `processing_jobs`에 `user_id`·`locked_until`·`heartbeat_at` 추가(lease는 task-010이 사용), 소프트 삭제 컬럼
- pgvector·pg_trgm 활성화. vector 차원 컬럼·인덱스는 만들지 않음(task-013이 확정 후 추가), 검색 함수는 task-014
- 사용자 롤(authenticated·anon)의 테이블 INSERT/UPDATE/DELETE 권한 회수 → 모든 쓰기는 RPC(SECURITY DEFINER, `search_path` 고정, 함수 안에서 소유자 검증)
- 쿼터 5종 시드(`plans`, 한도는 `PRD#8-1`) + `consume_quota` RPC(원자적 차감·취소, 동시 요청에도 초과 불가), `enqueue_job` RPC(sources·processing_jobs 생성), `idempotency_keys`(키·요청 해시·결과)
- 카탈로그 기반 RLS 게이트: `public` 전체 테이블 RLS 활성·정책 존재, SECURITY DEFINER 함수 `search_path`·EXECUTE 권한 점검, pgmq 스키마를 API에 노출하지 않음
- Storage 버킷: 경로 첫 폴더 = user_id, 서명 URL만

## 하지 않을 것
- 적용된 마이그레이션 수정(새 번호 추가만), 앱 화면 코드, 검색 함수(task-014)

## 완료 조건 (실행 가능한 확인)
- [ ] `supabase db reset` 성공, `supabase gen types typescript --local > apps/web/src/types/db.ts`
- [ ] RLS 위반 테스트(타인 행 접근 실패, 직접 SELECT 금지 테이블) 통과 — CI 필수 게이트
- [ ] anon 키로 테이블에 직접 INSERT 시 거부되는 테스트 통과
- [ ] 카탈로그 게이트 테스트(RLS 미적용 테이블·search_path 미고정 DEFINER 함수·pgmq 노출 시 실패) 통과
- [ ] 테스트: `consume_quota` 동시 N요청에서 차감 총량이 한도를 넘지 않음, 취소 시 복원
- [ ] `sql2erd supabase/migrations -o docs/diagrams/erd.mmd` 생성, `mmd-check` 통과
