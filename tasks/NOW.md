# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-06
- 현재 작업: task-005 인증(S-02~S-04, A-01) 구현 완료, `wip/task-004` 위에서 진행(브랜치 분리는 사용자 결정)
- 마지막으로 한 일: 인증 앱 한도 마이그레이션(`auth_rate_limits` + `consume_auth_rate_limit`, 한도는 함수에 고정), A-01 라우트 5개 + 콜백, proxy(세션 갱신·보호 경로), 로그인·가입·재설정 화면, 단위 테스트.
- 검증: `pnpm test:db` 34건, `pnpm --filter web test` 54건, typecheck·lint·build 통과, `next start` 스모크(보호 경로 307·API 401, 환경 변수 없이 로그인 POST는 500 fail-closed)
- 미검증: 실제 Supabase(가입 메일·PKCE 재설정 링크·`identities` 빈 배열 판별·config.toml의 auth.rate_limit 키). 개발 Supabase 프로젝트와 CLI 필요. 착수 전 challenger·완료 후 reviewer 절차는 아직 안 돌렸다.
- 다음 한 걸음: task-005 변경 커밋·푸시 → task-007 프로젝트(S-05~S-07, A-02)
- 열린 결정(사용자): 사전예약 폼 서비스, GitHub 보안 설정, Supabase·Vercel MCP 차단 여부, 개발 Supabase 프로젝트 생성 시점, `.env.local`의 `AUTH_RATE_LIMIT_SECRET`·`NEXT_PUBLIC_SITE_URL` 값
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback `TEST_DATABASE_URL`에서만(`DB_TESTS_ALLOW_RESET=1`). 원격 DB 변경 금지. 기존 마이그레이션 수정 금지. `apps/worker/`는 untracked(로그·캐시만 있음)라 커밋하지 않는다. `/dashboard` 등 로그인 후 화면은 아직 없다(404).
- SDLC 단계: 06 구현 (W1)
- 다음 작업: task-007 프로젝트
