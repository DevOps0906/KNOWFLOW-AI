# task-017 리포트 생성 작업 A-08 (인용 검증)

| 항목 | 내용 |
|---|---|
| 웨이브 | W4 |
| 선행 | task-015 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 (인터넷 API, 외부 LLM 호출, 비용) |
| 담당 | builder (+ tester), 착수 전 challenger |
| 근거 | `docs/04_API.md#A-08`, `docs/diagrams/seq-report.mmd`, `docs/diagrams/02-rag-and-job-flow.md#5` |
| 쓰기 허용 | `apps/web/src/app/api/**/reports/**`, `apps/worker/src/report/**`, `apps/web/src/services/reports/**`, `supabase/migrations/**`(새 번호만) |

## 할 것
- POST: 멱등 키(`idempotency_keys`), `consume_quota`로 리포트 쿼터 차감, completed 자료 없음 422, `enqueue_job`으로 작업 생성, 리포트 id·작업 id 202 반환
- Worker: 대상 자료 검색(`match_chunks_for_job`) → 섹션별 생성 → 인용 검증 → `report_citations`(chunk_id·position) 저장
- 인용 검증 실패 문장은 1회 재생성 후 제거 또는 표시, 작업 상태 갱신, 실패 시 쿼터 차감 취소
- GET 목록(프로젝트 필터·검색어·커서)

## 하지 않을 것
- 리포트 화면·내보내기(task-018), 쿼터 수치 변경
- 검증되지 않은 인용을 저장하는 경로

## 완료 조건 (실행 가능한 확인)
- [ ] 멱등 재요청·409·422·429·502 테스트 통과
- [ ] 저장된 모든 `report_citations`가 대상 프로젝트 chunk를 가리킴을 RLS 포함 테스트로 확인
- [ ] 골든셋 리포트 샘플의 인용 정확도 수치 출력(`pnpm eval`)
- [ ] `pnpm typecheck` · `pnpm test` 통과
