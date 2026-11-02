# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-02
- 현재 작업: task-001·003·006 완료 → 다음 task-004(Supabase 마이그레이션 12테이블 + RLS, 위험도 높음 → 착수 전 challenger)
- 마지막으로 한 일: 랜딩 S-01(외부 폼 CTA 검증 분기, 폼 URL 미정이라 비활성), 보안 L1(gitleaks v8.30.1 체크섬 CI·audit 보고·Dependabot·SECURITY.md·pre-commit·.env 읽기 차단 확대), 앱 셸·공통 컴포넌트(radix-ui·sonner·next-themes 등 정확 버전)
- 다음 한 걸음: /next → task-004. Supabase 로컬 개발 환경(CLI·Docker) 필요 여부 먼저 확인
- 열린 결정(사용자): 사전예약 폼 서비스(preorder.ts의 URL·허용 호스트 두 줄, 현재 tally.so 가정), GitHub 보안 설정 켜기, Supabase·Vercel MCP 차단 여부
- 주의: 렌더 테스트는 Vitest jsdom. shot 도구는 URL에 ':'가 있으면 Windows에서 0바이트 → headless chrome 직접 호출로 캡처. 병렬 builder가 같은 .next를 빌드하면 일시 실패 가능. 의존성 추가는 한 작업만. 이미 staged된 파일은 다른 작업 커밋에 섞일 수 있음(커밋 전 git status 확인)
- SDLC 단계: 06 구현 (W1)
- 담당 모델/역할: 팀장 + challenger · builder · reviewer(code·security·design)
- 테스트 상태: install·lint·typecheck·test(14건)·build 통과
- 남은 작업: tasks/README.md 20개
