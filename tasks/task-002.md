# task-002 W1 저장소 골격

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | 없음 |
| 위험도 | 높음 |
| 보안 영향 | 의존성 (새 패키지 일괄 도입, lockfile) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `AGENTS.md#2`, `AGENTS.md#4`, `DESIGN.md#2`, `docs/adr/0002-mvp-tech-decisions.md` |
| 쓰기 허용 | `apps/web/**`(tokens.css 값 변경 금지), 루트 `package.json`·`pnpm-workspace.yaml`·`pnpm-lock.yaml`·`.npmrc`·`.gitignore`(추가만), `.github/workflows/**` (ADR-0003은 팀장 작성 완료) |

## 할 것
- 최신 stable 확인 후 버전 고정: Next.js(App Router)·React·TypeScript·Tailwind CSS v4·shadcn/ui, pnpm
- `tokens.css`(DESIGN.md#2 토큰)를 Tailwind v4 테마에 연결, 라이트 기본·다크 2차
- `pnpm lint`·`typecheck`·`test`(Vitest) 스크립트 구성, lockfile 커밋
- `.env.example`에 키 이름만 기재
- 웹 경로는 `apps/web/src/app/...` 기준으로 골격을 만든다
- ADR-0003(호스팅·업로드 경로, 25줄 이내) 작성: 웹 호스팅, Worker 컨테이너 호스팅, 신뢰할 IP 헤더, 본문 한도. 비용은 `미확인`이면 근거 필요 표시

## 착수 전 challenger 반영 (필수)
- 패키지 이름 `web`(이후 `worker`). 루트 스크립트는 `pnpm -r`. turbo·공유 설정 패키지 만들지 않음. lockfile·workspace 파일은 루트에 하나만, 앱 생성은 임시 폴더에서 하고 옮긴다(src/에 tokens.css가 이미 있음).
- `globals.css`는 `@import "tailwindcss"` + tokens.css import + `@custom-variant dark (&:where(.dark, .dark *))`만. shadcn init이 넣는 `:root`·`.dark`·`@theme inline` 블록은 지운다. components.json cssVariables 경로는 globals.css. shadcn 컴포넌트 추가 시 globals.css diff 검토.
- 공급망: CLI는 정확한 버전으로 실행(예: `pnpm dlx shadcn@4.23.0`), 루트 `packageManager: pnpm@12.16.1`, 설치 스크립트 허용 목록만(필요한 것만), `.npmrc`에 최소 공개 경과 기간 설정(pnpm 지원 옵션 확인).
- CI: 최상위 `permissions: contents: read`, `push`·`pull_request` 트리거만(`pull_request_target` 금지), action은 커밋 SHA 고정, `persist-credentials: false`, `pnpm install --frozen-lockfile`.
- `.env.example`은 `apps/web/.env.example`에 웹 키 이름만(service_role 없음). `NEXT_PUBLIC_`은 공개 가능한 키에만.
- TypeScript는 최신(7.x)이 Next.js 16.4와 typecheck·build 호환되면 쓰고, 아니면 호환되는 최신 버전으로 고정하고 이유 보고.

## 하지 않을 것
- 화면·기능 구현, Supabase 연결, 토큰 값 임의 변경(hex·px 직접 사용 금지)
- 미들웨어(proxy) 파일 생성(task-005 단독 소유)

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm install --frozen-lockfile` 후 `pnpm dev` 기동
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm test` 통과
- [ ] `~/.claude/nomad/bin/secscan license` GPL·AGPL 없음
- [ ] `pnpm build` 통과, 빌드된 페이지에서 토큰 색(`--color-primary` 청록)이 적용됨
- [ ] 고정한 버전을 `AGENTS.md#2`에 반영할 목록으로 보고
