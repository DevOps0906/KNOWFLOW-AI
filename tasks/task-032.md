# task-032 WY 유튜브 게이트 무관 기반(`sources.unavailable_at`·`packages/citations`)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-010 |
| 위험도·보안 영향 | 높음 · 민감 데이터 (마이그레이션, 인용 무결성) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md#8`(비활성), `docs/diagrams/02-rag-and-job-flow.md#4`(인용 검증), `AGENTS.md#4` |
| 쓰기 허용 | `supabase/migrations/**`(새 번호만), `packages/citations/**`, `packages/db-tests/**`, `apps/web/package.json`·`apps/worker/package.json`(`packages/citations` 워크스페이스 의존 추가만), `pnpm-lock.yaml`(같은 변경만), `apps/worker/Dockerfile`(패키지 복사만), 루트 `package.json` test 스크립트·`.github/workflows/ci.yml`(citations 테스트 추가만), `docs/diagrams/erd.mmd`(`sql2erd` 재생성만) |
| 할 것 | `sources.unavailable_at` 컬럼 마이그레이션(새 번호), 공유 패키지 `packages/citations`를 빌드 단계 없는 ESM `.js` + `.d.ts`로 작성. `verifyCitations({ cited, allowedChunks })`는 DB·네트워크 없이 `{ verified, rejected, status: 'ok'|'partial'|'none' }`를 반환한다. `cited`는 모델 출력(비신뢰)이고 소문자 UUID 문자열만 인정(정규화 없음), `allowedChunks`는 `match_chunks` 결과(project_id 강제) 또는 저장된 청크. `verified`는 `allowedChunks`의 레코드를 반환해 위치를 모델에서 받지 않는다. 빈 인용은 `none`, 순서·중복 보존(칩 중복 제거는 호출자). Phase 0·법무 결과와 무관하게 유지 |
| 하지 않을 것 | `youtube` CHECK·등록 RPC 분기(`docs/05_DATA_MODEL.md#8` 착수 게이트), 검색 함수(task-014), 재확인 스윕(task-027), 겹침 판정(task-029), locator 검증, LLM 출력 파싱, 재생성 정책(task-015·017), 기존 마이그레이션 수정 |
| 완료 조건 | [ ] 테스트: 검색되지 않은 `chunk_id` 거부, 빈 인용 `none`, 일부 유효 `partial`, 중복·순서 보존, 대문자·비UUID·비문자열 거부, 모델이 준 위치 미사용 [ ] 실제 소비 증명: web·worker 테스트의 import, Worker 이미지 안 `import`, 임시 import로 `next build` 확인 [ ] 루트 `pnpm test`·CI에 citations 포함 [ ] DB 테스트: 컬럼 추가 후 기존 RLS 테스트 회귀 없음 [ ] `pnpm --filter ./packages/citations test` · `pnpm test:db` · `pnpm typecheck` 통과 |
