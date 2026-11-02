# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-02
- 현재 작업: task-002 완료 → 다음 task-001(랜딩 사전예약)·task-003(보안 설정)·task-006(앱 셸) 병행 가능
- 마지막으로 한 일: pnpm 작업 공간(루트 + apps/web 패키지 `web`), Next.js 16.4.3·React 19.3.1·TS 6.0.3·Tailwind 4.3.3·Vitest 5.0.5·ESLint 10.14, globals.css는 tokens.css만 사용, CI(contents:read·SHA 고정·frozen-lockfile·timeout 15분), 보안 헤더, ADR-0003(Vercel 서울·Supabase 서울·Fly Worker·x-real-ip·서명 업로드)
- 다음 한 걸음: /next → task-001(선행 002 완료). 001은 위험도 높음 → 착수 전 challenger
- 열린 결정: 없음
- 주의: TS 7.x는 typescript-eslint 미지원(7.1+ 재검토). pnpm 설치 스크립트는 기본 차단·허용 0개, minimumReleaseAge 1440은 pnpm-workspace.yaml. `.env*` 읽기는 설정으로 차단됨. shadcn CLI는 `pnpm dlx shadcn@4.23.0`, globals.css diff 검토. Next agentRules:false(앱 폴더 AGENTS.md 자동 생성 방지)
- SDLC 단계: 06 구현 (W1)
- 담당 모델/역할: 팀장 + challenger · builder · reviewer(code·security)
- 테스트 상태: install·lint·typecheck·test·build 통과, 라이선스 GPL·AGPL 0(sharp LGPL 예외 기록)
- 남은 작업: tasks/README.md 23개
