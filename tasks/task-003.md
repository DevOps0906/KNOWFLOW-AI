# task-003 W1 /secure setup (L1)

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-002 |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 (비밀 차단, 에이전트 범위, CI 게이트) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/01_PRD.md#8`, `docs/01_PRD.md#8-1`, `AGENTS.md#4` |
| 쓰기 허용 | `.github/**`, `.gitignore`, `.claude/settings*.json`, `scripts/secure/**` |

## 할 것
- `/secure setup`을 보안 레벨 L1로 실행(비밀 스캔·의존성 점검·라이선스 점검을 CI에 연결)
- `.gitignore`에 `.env*`(예외 `.env.example`) 보장, 커밋 전 비밀 스캔 훅
- AI 코딩 에이전트 범위를 로컬·개발 Supabase 키만으로 제한(8-1), 운영 키 접근 금지 설정
- L2 상향(베타 전) 체크리스트를 파일로 남김

## 하지 않을 것
- 운영 환경 구성, 앱 기능 코드 수정

## 완료 조건 (실행 가능한 확인)
- [ ] `~/.claude/nomad/bin/secscan` 통과(가짜 비밀 문자열을 넣으면 실패하는지도 확인 후 제거)
- [ ] CI 워크플로가 PR에서 secscan·lint·typecheck·test를 실행
- [ ] `git ls-files | grep -E "\.env$"` 결과 없음
