# task-029 WY 영상 요약·장면 카드(L0)·S-10 플레이어
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-028, task-012, task-032 |
| 위험도·보안 영향 | 높음 · 노출 면·키·권한 (임베드 플레이어, AI 공급자 키, 비신뢰 전사) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/youtube-mvp-review.md#4`, `docs/youtube-mvp-review.md#5`, `docs/youtube-mvp-review.md#1`(임베드 의무), `spec S-10`, `docs/diagrams/02-rag-and-job-flow.md#4` |
| 쓰기 허용 | `apps/worker/src/summary/**`, `apps/web/src/app/(app)/sources/[sourceId]/**`(S-10은 task-012 소유, 플레이어·장면 카드 연결만), `apps/web/src/app/api/sources/[sourceId]/moments/**`(A-07), `apps/web/src/components/youtube/**`, `apps/web/src/app/(marketing)/terms/**`, `apps/web/src/app/(marketing)/privacy/**`, S-16·S-17 링크만: `apps/web/src/app/(marketing)/page.tsx`(S-01)·`apps/web/src/app/(auth)/login/page.tsx`(S-02)·`apps/web/src/app/(auth)/signup/page.tsx`(S-03), `supabase/migrations/**`(새 번호만). `packages/citations/**`는 task-032 소유(import만) |
| 할 것 | 저장된 청크만 입력한 별도 LLM 요약, 실제 `chunk_id` 인용과 코드 검증, S-10 임베드 플레이어·L0 장면 카드(해당 시각 재생), "AI 전사"·"AI가 본 장면, 전사 근거 아님" 표시, 채널명·원본 링크, 권리자 삭제 요청 창구, 약관·개인정보처리방침 화면, A-07 `/moments` 라우트, S-01·S-02·S-03에 S-16·S-17 링크, 장면 카드 겹침 판정 함수 |
| 하지 않을 것 | 썸네일 서버 프록시·`next/image`, 긴 원문 인용, 겹치는 청크 없는 카드의 리포트 인용, L1 캡처(task-030) |
| 완료 조건 | [ ] 테스트: 검색되지 않은 `chunk_id` 인용 거부 [ ] 테스트: 카드 클릭 시 해당 시각 재생 인자 전달 [ ] 단위 테스트: 겹침 판정 함수(겹치는 청크 없으면 인용 불가, 리포트 통합 테스트는 task-017) [ ] `unavailable_at` 자료 제외 [ ] 3구간 화면 캡처 [ ] `pnpm test` · `pnpm --filter worker test` 통과 |
| 공유 | 인용 검증은 task-032의 `packages/citations` 순수 함수를 재사용한다(task-015와 공용, 이 작업에서 새로 만들지 않음) |
