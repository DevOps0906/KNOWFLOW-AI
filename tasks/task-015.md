# task-015 질의응답 A-06 (쿼터·멱등·생성·인용 검증)

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-014, task-032 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 (인터넷 API, 외부 LLM 호출, 비용) |
| 담당 | builder (+ tester), 착수 전 challenger |
| 근거 | `docs/04_API.md#A-06`, `docs/diagrams/seq-ask.mmd`, `docs/01_PRD.md#8-1` |
| 쓰기 허용 | `apps/web/src/app/api/**/conversations/**`, `apps/web/src/ai/**`, `apps/web/src/services/qa/**`, `supabase/migrations/**`(새 번호만, 기능 쓰기 RPC), `packages/db-tests/**`(RPC 음성 테스트) |

## 할 것
- 흐름: 인증·소유권 → 멱등 키(`idempotency_keys`) → `consume_quota`로 월 질문 쿼터 차감 → 질문 임베딩 → `match_chunks` 검색 → 생성 → 인용 검증
- 질문 임베딩: 웹 → 임베딩 서버 호출(내부 토큰, 서버 전용 환경 변수, 클라이언트 번들·로그 제외)
- 인용 검증: 답변 인용이 검색된 chunk에 실재하는지 서버가 확인(`packages/citations`의 검증 함수 재사용), 통과분만 출처 칩으로 반환(유튜브는 locator에 `t_start`·`t_end` 포함)
- 근거 없음: 검색 결과 부족·검증 실패 시 no_answer 응답, 인용 검증 실패는 1회 재생성
- 오류: 409 진행 중, 422 길이·미완료·비활성 자료, 429 쿼터, 502 생성 실패(쿼터 차감 취소)
- 사용량 기록(`usage_events`), 프롬프트 인젝션 방어(자료 본문은 데이터로만 취급)

## 하지 않을 것
- UI(task-016), 쿼터 수치 변경(`01_PRD.md#8-1` 값 사용), 쿼터 차감 구현(task-004의 `consume_quota` 호출만)
- 클라이언트에서 인용·출처 생성

## 완료 조건 (실행 가능한 확인)
- [ ] 같은 멱등 키 재요청 시 중복 차감·중복 생성 없음, 다른 입력은 409 테스트 통과
- [ ] 쿼터 초과 429, 생성 실패 502+차감 취소 테스트 통과
- [ ] 테스트: 임베딩 서버 토큰이 응답·로그에 없음
- [ ] 테스트: 범위에 비활성 자료가 있으면 422, 유튜브 출처 칩 locator에 `t_start` 포함
- [ ] `pnpm eval` 인용 정확도·no_answer 정확도가 `01_PRD.md#5` 목표 이상 (미달 시 수치 보고)
- [ ] `pnpm typecheck` · `pnpm test` 통과
