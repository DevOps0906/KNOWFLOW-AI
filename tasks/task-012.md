# task-012 W2 워크스페이스 자료 목록·원문 뷰어 S-08·S-10·A-03 GET·A-04 DELETE·A-07

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-007, task-011 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 (사용자 원문 청크 조회, 소유권) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-08`, `spec S-10`, `docs/04_API.md#A-03`, `docs/04_API.md#A-04`, `docs/04_API.md#A-07`, `docs/adr/0002-mvp-tech-decisions.md` |
| 쓰기 허용 | `apps/web/src/app/(app)/projects/[projectId]/page.tsx`·`layout.tsx`(S-08 단독 소유), `apps/web/src/app/(app)/sources/[sourceId]/**`(S-10), `apps/web/src/app/api/projects/[projectId]/route.ts`(GET 핸들러 추가만), `apps/web/src/app/api/projects/[projectId]/sources/route.ts`(DELETE 핸들러 추가만), `apps/web/src/app/api/sources/[sourceId]/route.ts`·`chunks/**`, `apps/web/src/components/workspace/**`, `apps/web/src/app/(app)/dashboard/**`(처리 중 자료 목록 연결만), `apps/web/src/components/chat/ChatPanel.tsx`(자리표시 스텁만, task-016이 구현) |

## 할 것
- 워크스페이스 레이아웃: 데스크톱 3단, 태블릿 2단(원문+채팅, 자료는 시트), 모바일 탭. 채팅 영역은 `ChatPanel` 자리표시를 import
- A-03 GET(프로젝트+자료 목록+요약·추천 질문), 자료 목록(유형·처리 상태 배지·오류 코드·재시도 버튼), 상태 폴링
- A-04 DELETE(자료 소프트 삭제)와 S-08 선택 삭제 버튼; 삭제된 프로젝트·자료는 목록·조회에서 제외
- S-06 대시보드의 처리 중 자료 목록을 A-05 데이터에 연결
- 원문 뷰어 S-10: A-07 청크 조회(chunk_index·content·locator), `?chunk=<chunk_id>`로 이동·강조
- 미완료 자료는 409 안내, 타인·없는 자료 404, 비신뢰 텍스트는 이스케이프 렌더(HTML 삽입 금지)

## 하지 않을 것
- 채팅 질의응답·리포트 UI(W3), 자료 영구 삭제

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm test` 통과
- [ ] 테스트: 타인 자료 청크 요청 404, processing 자료 청크 요청 409
- [ ] 테스트: 삭제(소프트)된 프로젝트·자료가 목록·A-03 GET·A-07에서 제외됨(404 또는 미표시)
- [ ] 테스트: `<script>` 포함 청크가 텍스트로 렌더됨
- [ ] 3구간 렌더 확인(S-08·S-10), 상태별(빈·처리 중·실패) 화면 확인
