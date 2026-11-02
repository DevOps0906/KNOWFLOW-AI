# task-007 W2 프로젝트 S-05~S-07·A-02·A-03(PATCH·DELETE)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-004, task-005, task-006 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 (본인 소유권 검증, 쿼터) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-05`, `spec S-06`, `spec S-07`, `docs/04_API.md#A-02`, `docs/04_API.md#A-03` |
| 쓰기 허용 | `apps/web/src/app/(app)/onboarding/**`, `apps/web/src/app/(app)/dashboard/**`, `apps/web/src/app/(app)/projects/page.tsx`, `apps/web/src/app/api/projects/route.ts`, `apps/web/src/app/api/projects/[projectId]/route.ts`(PATCH·DELETE만), `apps/web/src/lib/projects/**`, `supabase/migrations/**`(새 번호만, 기능 쓰기 RPC), `packages/db-tests/**`(RPC 음성 테스트) |

## 할 것
- 프로젝트 목록(검색·상태·정렬·커서)·생성(A-02)·이름/설명 수정·보관(A-03 PATCH)·삭제(A-03 DELETE, 소프트 삭제)
- A-03 GET과 S-08 `[projectId]/page.tsx`는 task-012 소유 — 여기서 만들지 않는다. 상세 진입은 S-08 링크까지
- 서버가 user_id를 채움(클라이언트 값 무시), 타인·없는 프로젝트 404
- 프로젝트 20개 한도 초과 429, 이름 길이 422, 첫 프로젝트 온보딩 안내
- 소프트 삭제(30일 뒤 영구 삭제는 별도), 처리 중 작업 있으면 409

- 404·오류 화면(not-found·error·global-error)의 임시 "/" 링크를 `/dashboard`로 교체(task-021 주석 참조)

## 하지 않을 것
- 자료 업로드·질의, 영구 삭제 배치, 공유·팀 기능, A-03 GET

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm typecheck` · `pnpm test` 통과
- [ ] 테스트: 사용자 A가 사용자 B의 프로젝트 수정·삭제 시 404
- [ ] 테스트: 21번째 프로젝트 생성 429, 요청 본문의 user_id 무시
- [ ] 화면 3구간 렌더 확인(S-05~S-07)
