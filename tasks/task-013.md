# task-013 골든셋 30~50문항 + 평가 스크립트 (임베딩·청킹 확정)

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-011 |
| 위험도 | 보통 |
| 보안 영향 | 없음 |
| 담당 | builder (+ tester: 스크립트 실행) |
| 근거 | `docs/01_PRD.md#5`, `docs/diagrams/02-rag-and-job-flow.md#3`, `docs/adr/0002-mvp-tech-decisions.md` |
| 쓰기 허용 | `evals/**`, `docs/adr/0004-*.md`, `apps/worker/src/config/**`(청킹·임베딩 값만), `supabase/migrations/**`(새 번호만, vector 컬럼·인덱스), `package.json`(scripts `eval` 추가만) |

## 할 것
- 샘플 자료 3~5건 기준 골든셋 30~50문항(질문·정답 근거 chunk·no_answer 여부) JSON으로 작성
- 평가 스크립트: 검색 적중률, 인용 정확도, no_answer 정확도를 수치로 출력
- 임베딩 모델·청크 크기/겹침을 평가 수치로 비교해 확정하고 설정 파일 값만 변경, ADR-0004에 기록(25줄 이내)
- 확정 후 vector 차원 컬럼·인덱스 마이그레이션 추가, task-011의 벡터 저장 연결 활성화

## 하지 않을 것
- 사용자 실제 자료·개인정보를 골든셋에 넣지 않는다(공개/자작 샘플만)
- 검색 함수·질의응답 구현(task-014·015), 설정 외 Worker 코드 변경

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm eval` 실행 시 문항 수 30~50 및 3개 지표 수치 출력
- [ ] ADR-0004에 선택값·대안·평가 수치 기록, 기준 미달 시 `미확인`으로 표시
- [ ] `supabase db reset` 후 vector 컬럼 차원이 ADR-0004 값과 일치
- [ ] 청킹 설정 변경 후 `pnpm typecheck` 통과
