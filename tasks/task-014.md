# task-014 하이브리드 검색 함수 match_chunks · match_chunks_for_job (project_id 강제)

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-013 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 (프로젝트 간 자료 유출 방지) |
| 담당 | builder (+ tester), 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md`, `docs/diagrams/02-rag-and-job-flow.md#4`, `docs/01_PRD.md#8` |
| 쓰기 허용 | `supabase/migrations/**`(새 번호만), `apps/web/src/services/search/**`, `packages/db-tests/**` |

## 할 것
- pgvector 유사도 + pg_trgm/전문검색을 결합한 검색 SQL 함수(결합 방식은 task-013 골든셋 수치로 결정)
- `match_chunks`: 웹이 사용자 세션으로 호출. `project_id` 필수, RLS 소유자 조건 적용, source id 범위 필터 지원
- `match_chunks_for_job`: Worker 전용. 작업의 `processing_jobs.user_id`·project_id를 함수 안에서 검증, authenticated·anon의 EXECUTE 권한 회수
- 두 함수 모두 completed 자료의 청크만, `deleted_at`이 있는 프로젝트·자료 제외; 반환: chunk_id·source_id·locator·점수
- 서비스 계층 래퍼(`match_chunks` 호출)와 단위 테스트

## 하지 않을 것
- 생성/프롬프트 구성(task-015), 웹에서 service role 키로 RLS 우회 호출
- project_id 없는 전역 검색 경로

## 완료 조건 (실행 가능한 확인)
- [ ] 다른 사용자·다른 프로젝트 자료가 두 함수 결과에 0건임을 테스트로 통과
- [ ] 소프트 삭제(deleted_at)된 프로젝트·자료의 청크가 결과에 0건인 테스트 통과
- [ ] project_id 누락 호출이 오류인 테스트, 사용자 롤이 `match_chunks_for_job` 호출 시 거부되는 테스트 통과
- [ ] `pnpm eval` 검색 적중률이 task-013 기준선 이상
- [ ] `pnpm typecheck` · `pnpm test` 통과
