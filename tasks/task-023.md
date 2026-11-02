# task-023 보안 L2 상향 점검

| 항목 | 내용 |
|---|---|
| 웨이브 | W5 |
| 선행 | task-020, task-022 |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 (전 노출 면·RLS·키·공급망 점검) |
| 담당 | builder (+ tester), 착수 전 challenger, 변경 후 codex-reviewer(security) |
| 근거 | `docs/01_PRD.md#8`, `docs/04_API.md#위협 메모`, `AGENTS.md#4` |
| 쓰기 허용 | `docs/07_SECURITY_CHECK.md`, `apps/**`(발견 결함 수정만), `supabase/migrations/**`, `.github/workflows/**` |

## 할 것
- `security-baseline` L2 체크리스트로 항목별 통과/미통과 표 작성
- RLS: 모든 테이블 정책 존재·타 사용자 접근 차단 테스트, service role 키의 서버 전용 사용 확인
- 노출 면: 업로드(파일 형식·크기)·URL 수집(SSRF)·질문(프롬프트 인젝션)·리포트 API 점검
- 공급망: lockfile 커밋, `secscan`, 의존성 취약점 점검, 비밀 커밋·로그 노출 검사
- 미통과는 수정하거나 사유·대응 기한과 함께 `팀장 결정 필요`로 보고

## 하지 않을 것
- 새 기능 추가, 보안 레벨 자체 변경(L2 유지 판단은 팀장)

## 완료 조건 (실행 가능한 확인)
- [ ] `secscan` 실행 결과 치명·높음 0건
- [ ] RLS 교차 접근 테스트 전부 통과(`pnpm test`)
- [ ] 점검표의 모든 항목이 통과 또는 사유 기록
- [ ] `pnpm typecheck` · `pnpm e2e` 회귀 없음
