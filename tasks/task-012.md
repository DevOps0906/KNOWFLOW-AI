# task-012 W2 워크스페이스 자료 목록·원문 뷰어 S-08·S-10·A-03 GET·A-04 DELETE·A-07

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-007, task-011, task-032 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 (사용자 원문 청크 조회, 소유권) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-08`, `spec S-10`, `docs/04_API.md#A-03`, `docs/04_API.md#A-04`, `docs/04_API.md#A-07`, `docs/adr/0002-mvp-tech-decisions.md` |
| 쓰기 허용 | `apps/web/src/app/(app)/projects/[projectId]/page.tsx`·`layout.tsx`(S-08 단독 소유), `apps/web/src/app/(app)/sources/[sourceId]/**`(S-10), `apps/web/src/app/api/projects/[projectId]/route.ts`(GET 핸들러 추가만), `apps/web/src/app/api/projects/[projectId]/sources/route.ts`(DELETE 핸들러 추가만), `apps/web/src/app/api/sources/[sourceId]/route.ts`·`chunks/**`, `apps/web/src/components/workspace/**`, `apps/web/src/app/(app)/dashboard/**`(처리 중 자료 목록 연결만), `apps/web/src/components/chat/ChatPanel.tsx`(자리표시 스텁만, task-016이 구현) |

## 할 것
- 워크스페이스 레이아웃: 데스크톱 3단, 태블릿 2단(원문+채팅, 자료는 시트), 모바일 단일 열 + 채팅 하단 시트(DESIGN.md S-08 행이 정본, 2026-11-12 오기 정정). 채팅 영역은 `ChatPanel` 자리표시를 import
- A-03 GET(프로젝트+자료 목록+요약·추천 질문, `unavailable_at`(컬럼은 task-032 산출물) 포함), 자료 목록(유형·처리 상태 배지·오류 코드·비활성 표시·재시도 버튼), 상태 폴링
- 유튜브 mm:ss 칩 컴포넌트(`locator.t_start` 표시, S-10 `?chunk=<chunk_id>`로 이동)
- A-04 DELETE(자료 소프트 삭제)와 S-08 선택 삭제 버튼; 삭제된 프로젝트·자료는 목록·조회에서 제외
- S-06 대시보드의 처리 중 자료 목록을 A-05 데이터에 연결
- 원문 뷰어 S-10: A-07 청크 조회(chunk_index·content·locator), `?chunk=<chunk_id>`로 이동·강조
- 미완료 자료는 409 안내, 타인·없는 자료 404, 비신뢰 텍스트는 이스케이프 렌더(HTML 삽입 금지)

## 하지 않을 것
- 채팅 질의응답·리포트 UI(W3), 자료 영구 삭제

## 완료 조건 (실행 가능한 확인)
- [x] `pnpm lint` · `pnpm typecheck` · `pnpm test` 통과
- [x] 테스트: 타인 자료 청크 요청 404, processing 자료 청크 요청 409
- [x] 테스트: 삭제(소프트)된 프로젝트·자료가 목록·A-03 GET·A-07에서 제외됨(404 또는 미표시)
- [x] 테스트: `<script>` 포함 청크가 텍스트로 렌더됨
- [x] 테스트: A-03 응답에 `unavailable_at` 포함, S-08 비활성 표시·mm:ss 칩 렌더
- [x] 3구간 렌더 확인(S-08·S-10), 상태별(빈·처리 중·실패) 화면 확인

## 구현 결정 (2026-11-12 challenger 반영, 팀장 확정)
분할: **012a** DB RPC + A-03 GET·A-04 DELETE·A-07 API → **012b** S-08 레이아웃·목록·폴링·대시보드 / **012c** S-10 뷰어 (b·c 병렬).
쓰기 범위 추가: `supabase/migrations/20261112000300_*`(새 파일 1개, 012a), `packages/db-tests/**`, `apps/web/src/lib/sources/**`(핸들러·백엔드 주입·문구 표, 기존 `lib/projects`·`lib/storage` 패턴), 해당 `*.test.ts(x)`.
1. 청크 조회: `get_source_chunks(p_source_id, p_after_index, p_limit, p_around_chunk_id)` SECURITY DEFINER·authenticated, 함수 안에서 `auth.uid()` 소유·자료/프로젝트 미삭제 확인(없음·타인 → P0002 → 404), 미완료 → 409, `unavailable_at` 있으면 메타만(청크 0건 + 비활성 표시). 페이지 상한 100, `chunk_index` keyset, `around`는 그 청크 앞뒤 창. chunk_id는 uuid·같은 source 확인, 못 찾으면 처음부터 + 안내(재처리로 id 바뀜).
2. 소프트 삭제: `delete_sources(p_project_id, p_source_ids uuid[])` authenticated, 하나라도 타인·없음이면 전체 404(정보 노출 없음), 본인이 이미 지운 id는 성공(멱등). 진행 중 작업이 있어도 삭제하고 Worker가 `source_deleted` 영구 실패 → 기존 fail_job 환불 경로로 처리 전 자료만 환불. 완료된 자료는 환불 없음. 청크·Storage 객체는 남기고 정리는 task-019.
3. 레이아웃: `[projectId]/layout.tsx`에 3단을 넣지 않는다(`sources/new` 보호). 워크스페이스는 `page.tsx`가 렌더하는 `components/workspace/WorkspaceShell`.
4. 재시도 버튼: A-03 GET이 자료별 최신 작업의 `retryable`을 함께 준다. `retryable=false`면 버튼 숨김.
5. 오류 문구: `apps/web/src/lib/sources/error-messages.ts` 한 표. Worker 상수 3곳(pdf·ingest·youtube)과 DB 코드(`lease_expired`·`no_handler` 등)를 모두 포함하는지 테스트가 Worker 소스 파일을 읽어 확인. 모르는 코드는 일반 문구, 원문 코드는 화면에 노출하지 않는다. `error_message_safe`는 쓰지 않는다.
6. 폴링: 처리 중 자료가 있을 때만, 5초 시작 → 실패·무변화 시 30초까지 늘림, 탭 숨김이면 멈춤. 대시보드는 RLS로 `sources`의 처리 중 행을 한 번에 조회(프로젝트별 A-05 N회 호출 안 함).
7. 유튜브: 플래그가 꺼져도 목록에 보인다(유튜브 배지, `youtube_disabled` 문구 "유튜브 기능 준비 중"). S-10은 task-029용 확장 지점(유튜브 분기 슬롯, `locator.t_start` 전달)만, `/moments`는 029.
8. 비신뢰 텍스트는 React 이스케이프만, `dangerouslySetInnerHTML` 금지(테스트로 검사).
- 012a 결과(2026-11-12): 마이그레이션 `20261112000300_source_read_delete.sql`(`get_source_chunks`·`delete_sources`). API 형태는 builder 보고대로 `apps/web/src/lib/sources/`가 정본. 팀장 승인: 메타 GET `/api/sources/:id`는 상태와 무관하게 200, 409는 `/chunks`에만(04 A-07 문구 갱신 필요), 비활성+미완료는 메타만, around 앞쪽은 `has_before`만(앞쪽은 처음부터 다시 읽음), A-03은 snake_case.
- 012c 결과(2026-11-12): S-10 뷰어(`components/workspace/viewer/**`), 테스트 13건. 캡처는 web용 로컬 Supabase가 없어 jsdom 렌더+Tailwind로 찍음(사이드바 없음) → 실제 세션 캡처는 task-022 E2E에서. "처음부터 보기"는 주소의 ?chunk를 남김(수용).
- 완료(2026-11-12): 012a·b·c. 팀장 재실행 web 276, db 165, worker 183(+1), typecheck·lint, verify-youtube·ingest·egress 통과. 리뷰 reviewer(security/contract)·codex(code·design) 🔴 반영(토큰 임의값). 3구간 캡처는 정적 렌더(실제 세션은 task-022). 비활성 자료는 질의 범위 선택 불가·개별 삭제 가능.
