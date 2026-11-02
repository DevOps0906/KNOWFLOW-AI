# task-020 요청 한도·사용량 표시 (쿼터 차감은 task-004)

| 항목 | 내용 |
|---|---|
| 웨이브 | W4 |
| 선행 | task-004, task-005, task-015, task-017, task-019 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 (남용·비용 폭주 방어, 요청 한도) |
| 담당 | builder (+ tester), 착수 전 challenger |
| 근거 | `docs/01_PRD.md#8-1`, `docs/04_API.md#A-10`, `docs/05_DATA_MODEL.md` |
| 쓰기 허용 | `apps/web/src/lib/rate-limit/**`, `apps/web/src/app/api/me/usage/**`, `apps/web/src/components/usage/**`, `apps/web/src/app/(app)/settings/**`(사용량 영역 연결만), `apps/web/src/app/api/**`(기존 라우트에 한도 호출 한 줄 추가만), `supabase/migrations/**`(새 번호만) |

## 할 것
- 쿼터 차감·취소는 task-004의 `consume_quota`를 그대로 사용(여기서 재구현하지 않음)
- 요청 한도(rate limit): 질문·자료 추가(분당 10)·URL 수집·리포트 POST(분당 2) 등 사용자별 적용, 429 + `Retry-After`. 수치는 `01_PRD.md#8-1` 값을 설정 파일로 분리, 상태는 Postgres(task-005 방식 재사용)
- GET `/api/me/usage`: `usage_events` 집계와 `plans`·`user_quotas` 한도 반환
- S-13 사용량 영역·채팅에 사용량 표시 컴포넌트, 한도 초과 안내 상태

## 하지 않을 것
- 쿼터 차감 로직, 미들웨어(proxy) 수정(task-005 소유), 결제·유료 플랜, 수치 임의 변경
- IP 기반 차단 외 계정 정지 기능

## 완료 조건 (실행 가능한 확인)
- [ ] 테스트: 분당 한도 초과 요청이 429+`Retry-After`, 창이 지나면 다시 허용
- [ ] 테스트: 사용자 A의 한도 소진이 사용자 B에 영향 없음
- [ ] `/api/me/usage` 집계가 `consume_quota` 차감 결과와 일치
- [ ] 한도 초과 시 UI에 안내 상태 표시 컴포넌트 테스트 통과
- [ ] `pnpm typecheck` · `pnpm test` 통과
