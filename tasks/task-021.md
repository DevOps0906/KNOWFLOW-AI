# task-021 오류·404·빈 상태 S-14·S-15

| 항목 | 내용 |
|---|---|
| 웨이브 | W5 |
| 선행 | task-006 |
| 위험도 | 낮음 |
| 보안 영향 | 없음 |
| 담당 | builder (+ tester) |
| 근거 | `spec S-14`, `spec S-15`, `docs/03_SCREENS_UX.md` |
| 쓰기 허용 | `apps/web/src/app/error.tsx`, `apps/web/src/app/not-found.tsx`, `apps/web/src/app/global-error.tsx`, `apps/web/src/components/states/**` |

## 할 것
- S-14 오류 화면(재시도·홈 이동)과 S-15 404 화면을 디자인 토큰으로 구현
- 빈 상태 공용 컴포넌트(프로젝트·자료·리포트·대화)로 통일하고 기존 화면에 적용
- 오류 화면에 스택·내부 경로·키 등 내부 정보 미노출
- 반응형 3구간

## 하지 않을 것
- 오류 로깅 서비스 도입(새 의존성)
- 화면별 비즈니스 로직 변경

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm typecheck` · `pnpm test` 통과
- [ ] 존재하지 않는 경로 접속 시 S-15, 강제 예외 시 S-14가 렌더되는 테스트 통과
- [ ] `shot`으로 S-14·S-15 3개 구간 스크린샷 확인
