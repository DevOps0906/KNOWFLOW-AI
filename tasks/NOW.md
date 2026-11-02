# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-02 (사용자 요청으로 중단)
- 현재 작업: task-004 재개(wip/task-004 브랜치, builder 마무리 중) — 사용자 "작업 마무리" 요청
- 마지막으로 한 일: task-021 완료·푸시. task-004 착수 전 challenger 반영(05#7 쓰기 RPC 규칙, ADR-0005, supabase-verify.md, 후속 작업 쓰기 범위). builder가 마이그레이션 6개(확장·기본 권한, 핵심 테이블, RLS·권한, 가입·프로필 RPC, 쿼터·멱등·enqueue RPC, storage 버킷)와 db-tests 일부(bootstrap.sql, gate.test.ts, global-setup)까지 작성 후 중단
- 다음 한 걸음: `git switch wip/task-004` → 남은 테스트(RLS 위반·anon INSERT 거부·consume_quota 동시성·refund 권한·소프트 삭제·멱등 키 동시·가입 트리거), 루트 scripts(test는 db-tests 제외, test:db 추가), CI db job, ERD → `pnpm test:db` 통과 → reviewer(code·security) → master 병합
- 열린 결정(사용자): 사전예약 폼 서비스, GitHub 보안 설정 켜기, Supabase·Vercel MCP 차단 여부, 개발 Supabase 프로젝트 생성 시점(task-005 전 supabase-verify.md 확인용)
- 주의: wip 브랜치는 루트 test 스크립트가 아직 db-tests를 포함할 수 있어 CI가 실패할 수 있음. 모바일 캡처는 `node scripts/dev/mshot.mjs <url> <out> 375`. .env 읽기 차단. 의존성 추가는 한 작업만
- SDLC 단계: 06 구현 (W1)
- 담당 모델/역할: 팀장 + challenger · builder · reviewer
- 테스트 상태(master): install·lint·typecheck·test(16건)·build 통과
- 남은 작업: tasks/README.md 19개(+ task-004 마무리)
