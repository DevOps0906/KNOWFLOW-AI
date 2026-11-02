# task-003 W1 /secure setup (L1)

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-002 |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 (비밀 차단, 에이전트 범위, CI 게이트) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/01_PRD.md#8`, `docs/01_PRD.md#8-1`, `AGENTS.md#4` |
| 쓰기 허용 | `.github/**`, `.gitignore`(추가만), `scripts/secure/**`, `SECURITY.md`, `docs/security/**` (`.claude/settings.json`은 팀장이 수정 완료) |

## 할 것
- `/secure setup`을 보안 레벨 L1로 실행(비밀 스캔·의존성 점검·라이선스 점검을 CI에 연결)
- `.gitignore`에 `.env*`(예외 `.env.example`) 보장, 커밋 전 비밀 스캔 훅
- AI 코딩 에이전트 범위를 로컬·개발 Supabase 키만으로 제한(8-1), 운영 키 접근 금지 설정
- L2 상향(베타 전) 체크리스트를 파일로 남김

## 착수 전 challenger 반영 (팀장 결정)
- 저장소는 공개·개인 계정(2026-11-02 확인). 비밀 스캔은 gitleaks CLI 바이너리(MIT) + 체크섬 검증, 정확한 버전 고정. action 라이선스 키·PR 쓰기 권한 불필요. 스캔 단계는 `fetch-depth: 0`, push는 이전 커밋 이후, PR은 base..head 범위.
- `pnpm audit --prod --audit-level=high`는 L1에서 보고만(continue-on-error), 차단은 L2 체크리스트로. 라이선스 CI도 L2로.
- Dependabot·SECURITY.md는 `~/.claude/nomad/bin/secscan setup .`으로 생성(손으로 쓰지 않음), 결과 검토 후 필요한 줄만 조정.
- 커밋 전 훅 `scripts/secure/pre-commit`: 로컬 gitleaks가 있으면 staged 스캔, 없으면 경고만. 진짜 관문은 CI라고 문서에 명시. 설치 안내는 `git config core.hooksPath scripts/secure`.
- `.claude/settings.json`의 `.env` 읽기 차단을 모든 깊이(`./**/.env`, `./**/.env.*`)로 넓힘(팀장 완료).
- Supabase·Vercel MCP 차단 여부는 사용자 결정(미적용). 1차 통제는 "운영 키를 개발 기기에 두지 않는다" — `docs/security/L2-checklist.md`에 기록하고 GitHub push protection 켜기(사용자 작업)도 포함.

## 하지 않을 것
- 운영 환경 구성, 앱 기능 코드 수정

## 완료 조건 (실행 가능한 확인)
- [ ] 로컬 gitleaks(임시 다운로드, 체크섬 확인)로 저장소 전체 스캔 통과, 가짜 비밀을 임시 파일에 넣으면 실패하는지 확인 후 제거(커밋하지 않음)
- [ ] CI 워크플로가 push·PR에서 gitleaks·lint·typecheck·test·build를 실행(yaml 문법 검증), audit은 보고만
- [ ] `git ls-files | grep -E '(^|/)\.env' | grep -v '\.env\.example$'` 결과 없음
