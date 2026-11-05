# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-06
- 현재 작업: task-007 프로젝트(S-05~S-07, A-02, A-03 PATCH·DELETE) 구현 완료. 브랜치 `wip/task-004` 위(분리는 사용자 결정, 푸시 안 함)
- 마지막으로 한 일: 마이그레이션 `20261103000200`(create/update/delete_project RPC, 소유자는 auth.uid()만, 20개 한도 KF429, 처리 중 작업 KF409), A-02·A-03 라우트와 핸들러, 대시보드·프로젝트 목록·온보딩 화면, 404·오류 화면 링크를 /dashboard로 교체.
- 검증: `pnpm test:db` 47건, `pnpm --filter web test` 75건, typecheck·lint(기존 경고 1)·build 통과
- 미검증: 실제 Supabase(PostgREST `sources(count)` 임베드 필터, RPC 오류 코드 전달), 화면 3구간 캡처(로그인 세션 필요). 인증(task-005)의 Supabase 연동 미검증 사항도 그대로. 착수 전 challenger·완료 후 reviewer 절차는 안 돌렸다.
- 다음 한 걸음: task-007 커밋 → task-008 PDF 업로드·Storage(S-09, A-04)
- 열린 결정(사용자): 사전예약 폼 서비스, GitHub 보안 설정, Supabase·Vercel MCP 차단 여부, 개발 Supabase 프로젝트 생성 시점, `.env.local`의 `AUTH_RATE_LIMIT_SECRET`·`NEXT_PUBLIC_SITE_URL` 값
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback `TEST_DATABASE_URL`에서만(`DB_TESTS_ALLOW_RESET=1`). 가끔 종료 시 임시 폴더 EBUSY 메시지가 나오지만 테스트 결과와 무관. 원격 DB 변경 금지. 기존 마이그레이션 수정 금지. `apps/worker/`는 untracked(로그·캐시뿐)라 커밋하지 않는다.
- SDLC 단계: 06 구현 (W2)
- 다음 작업: task-008 PDF 업로드
