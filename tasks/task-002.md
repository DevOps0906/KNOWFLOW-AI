# task-002 W1 저장소 골격

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | 없음 |
| 위험도 | 높음 |
| 보안 영향 | 의존성 (새 패키지 일괄 도입, lockfile) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `AGENTS.md#2`, `AGENTS.md#4`, `DESIGN.md#2`, `docs/adr/0002-mvp-tech-decisions.md` |
| 쓰기 허용 | `apps/web/**`, `package.json`, `pnpm-workspace.yaml`, `.env.example`, `.github/**`, `docs/adr/0003-*.md` |

## 할 것
- 최신 stable 확인 후 버전 고정: Next.js(App Router)·React·TypeScript·Tailwind CSS v4·shadcn/ui, pnpm
- `tokens.css`(DESIGN.md#2 토큰)를 Tailwind v4 테마에 연결, 라이트 기본·다크 2차
- `pnpm lint`·`typecheck`·`test`(Vitest) 스크립트 구성, lockfile 커밋
- `.env.example`에 키 이름만 기재
- 웹 경로는 `apps/web/src/app/...` 기준으로 골격을 만든다
- ADR-0003(호스팅·업로드 경로, 25줄 이내) 작성: 웹 호스팅, Worker 컨테이너 호스팅, 신뢰할 IP 헤더, 본문 한도. 비용은 `미확인`이면 근거 필요 표시

## 하지 않을 것
- 화면·기능 구현, Supabase 연결, 토큰 값 임의 변경(hex·px 직접 사용 금지)
- 미들웨어(proxy) 파일 생성(task-005 단독 소유)

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm install --frozen-lockfile` 후 `pnpm dev` 기동
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm test` 통과
- [ ] `~/.claude/nomad/bin/secscan license` GPL·AGPL 없음
- [ ] `docs/adr/0003-*.md`에 4개 결정(웹 호스팅·Worker 호스팅·신뢰할 IP 헤더·본문 한도)이 선택·대안·결과로 기록됨
- [ ] 고정한 버전을 `AGENTS.md#2`에 반영할 목록으로 보고
