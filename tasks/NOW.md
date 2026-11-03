# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-03
- 현재 작업: task-004 Supabase 마이그레이션·RLS·기반 RPC 완료, `wip/task-004`
- 마지막으로 한 일: 13개 테이블·RLS·쓰기 RPC·비공개 Storage 버킷과 PostgreSQL 테스트 하네스 구현. 권한 경계·소프트 삭제·가입 트리거·쿼터 동시성·환불·멱등성 테스트 및 DB CI job 추가.
- 검증: `pnpm test:db` 28건, `pnpm test` 16건, DB·웹 타입검사, lint, build, sql2erd·mmd-check 통과
- 다음 한 걸음: task-004 변경을 커밋해 `wip/task-004`에 푸시. 이어서 task-005 인증 진행
- 열린 결정(사용자): 사전예약 폼 서비스, GitHub 보안 설정 켜기, Supabase·Vercel MCP 차단 여부, 개발 Supabase 프로젝트 생성 시점(task-005 전 supabase-verify.md 확인용)
- 주의: DB 테스트는 전용 loopback PostgreSQL에서만, `DB_TESTS_ALLOW_RESET=1`과 함께 실행(테스트 스키마 전체 삭제). 원격 DB 변경 금지. 기존 마이그레이션 수정 금지.
- SDLC 단계: 06 구현 (W1)
- 다음 작업: task-005 인증
