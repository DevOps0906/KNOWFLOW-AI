# task-005 W1 인증 S-02~S-04

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-004, task-006 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 · 민감 데이터 (가입·로그인·재설정 메일) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-02`, `spec S-03`, `spec S-04`, `docs/04_API.md#A-01`, `docs/01_PRD.md#8-1`, `docs/adr/0003-*.md` |
| 쓰기 허용 | `apps/web/src/app/(auth)/**`, `apps/web/src/app/api/auth/**`, `apps/web/src/lib/auth/**`, `apps/web/src/proxy.ts`(미들웨어, 단독 소유), `supabase/config.toml`(auth 레이트 리밋 항목만), `supabase/migrations/**`(새 번호만, 한도 상태용) |

## 할 것
- 가입·로그인·로그아웃·비밀번호 재설정·변경(Supabase Auth, 세션 쿠키), 미로그인 접근 시 리디렉션
- 미들웨어(proxy)는 이 작업만 수정한다(Next.js 버전별 파일명은 task-002 확정값 따름)
- 재설정은 가입 여부와 무관하게 동일 응답, 약한 비밀번호 422
- 레이트 리밋: Supabase Auth 자체 한도 설정 + 앱 한도(로그인 분당 5회(IP), 재설정 메일 시간당 3회(계정)) → 429 + `Retry-After`. 앱 한도 상태는 Postgres에 저장(메모리 금지), 신뢰할 IP 헤더는 ADR-0003 따름
- 인증 이벤트 로그(비밀번호·토큰 제외), 한국어 안전 오류 메시지

## 하지 않을 것
- 소셜 로그인, 계정 설정 화면(S-13), 관리자 화면

## 완료 조건 (실행 가능한 확인)
- [x] `pnpm typecheck` · `pnpm test` 통과
- [x] 테스트: 존재하지 않는 이메일도 재설정 응답 동일, 6번째 로그인 시도 429
- [x] 테스트: 신뢰하지 않는 위치의 IP 헤더(`X-Forwarded-For` 위조)로 한도를 우회할 수 없음
- [x] 테스트: 미로그인 상태에서 보호 경로 접근 시 로그인으로 이동
- [x] 로그 출력에 비밀번호·토큰이 없음을 테스트로 확인
