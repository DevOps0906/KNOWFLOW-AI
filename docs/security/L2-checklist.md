# L2 상향 체크리스트 (베타 전)

현재 L1. 베타 공개 전에 아래를 모두 끝내고 PRD 8장 레벨을 L2로 올린다.

## 사용자 작업 (GitHub 설정)
- [ ] Settings -> Code security: Dependency graph, Dependabot alerts, Secret scanning + **Push protection**, Private vulnerability reporting 켜기
- [ ] 기본 브랜치 보호: PR 필수, `ci` 워크플로(secrets, check) 통과 필수
- [ ] 로컬 훅 설치: `git config core.hooksPath scripts/secure` (+ 로컬 gitleaks 설치)

## 에이전트 범위 (PRD 8-1)
- [ ] 1차 통제: **운영 키를 개발 기기에 두지 않는다** (.env는 로컬·개발 Supabase 키만)
- [ ] 알려진 한계 인지: `.claude/settings.json`의 `.env` Read 차단은 도구 단위라 셸 명령 우회가 가능하다. 그래서 위 1차 통제가 실제 방어선이다
- [ ] Supabase·Vercel MCP 차단 여부 결정 (사용자 결정, 현재 미적용)
- [ ] 운영 배포·마이그레이션은 CI 또는 사람이 수행, 에이전트 제외

## CI 강화
- [ ] `pnpm audit --prod --audit-level=high`를 차단으로 전환 (현재 `continue-on-error` 보고만)
- [ ] 라이선스 점검 CI 추가
- [ ] gitleaks 버전 갱신 시 `ci.yml`의 `GITLEAKS_SHA256`도 공식 checksums 파일로 확인해 함께 갱신
- [ ] Dependabot PR 처리 주기 정하기
