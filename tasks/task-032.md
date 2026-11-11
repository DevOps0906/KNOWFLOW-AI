# task-032 WY 유튜브 게이트 무관 기반(`sources.unavailable_at`·`packages/citations`)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-010 |
| 위험도·보안 영향 | 높음 · 민감 데이터 (마이그레이션, 인용 무결성) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md#8`(비활성), `docs/diagrams/02-rag-and-job-flow.md#4`(인용 검증), `AGENTS.md#4` |
| 쓰기 허용 | `supabase/migrations/**`(새 번호만), `packages/citations/**`, `packages/db-tests/**`, `apps/web/package.json`·`apps/worker/package.json`(`packages/citations` 워크스페이스 의존 추가만), `pnpm-lock.yaml`(같은 변경만) |
| 할 것 | `sources.unavailable_at` 컬럼 마이그레이션(새 번호), 인용 검증 순수 함수를 공유 패키지 `packages/citations`에 작성(답변 인용 `chunk_id`가 검색된 청크에 실재하는지 판정, DB·네트워크 접근 없음). Phase 0·법무 결과와 무관하게 유지 |
| 하지 않을 것 | `youtube` CHECK·등록 RPC 분기(`docs/05_DATA_MODEL.md#8` 착수 게이트), 검색 함수(task-014), 재확인 스윕(task-027), 기존 마이그레이션 수정 |
| 완료 조건 | [ ] 테스트: 검색되지 않은 `chunk_id` 인용 거부 [ ] DB 테스트: 컬럼 추가 후 기존 RLS 테스트 회귀 없음 [ ] `pnpm --filter ./packages/citations test` · `pnpm test:db` · `pnpm typecheck` 통과 |
