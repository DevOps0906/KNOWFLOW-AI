# task-028 WY 공용 청킹 연결(전사 구간 → task-011 파이프라인)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-027, task-011 |
| 위험도·보안 영향 | 높음 · 민감 데이터 (비신뢰 전사 텍스트) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/youtube-mvp-review.md#5`, `docs/05_DATA_MODEL.md#4`, `docs/05_DATA_MODEL.md#5`, `tasks/task-011.md` |
| 쓰기 허용 | `apps/worker/src/pipeline/**`, `apps/worker/tests/**` |
| 할 것 | task-027의 전사 구간을 task-011의 청킹·임베딩·색인 경로에 입력으로 연결, 청크 `locator`에 `t_start/t_end` 기록, 월 자료 처리 한도는 등록 시 `enqueue_job` 차감 확인, Worker 추가 차감 금지 |
| 하지 않을 것 | 유튜브 전용 청커 복제, 골든셋·모델 확정(task-013), 요약(task-029), 청크 본문 로그 |
| 완료 조건 | [ ] 테스트: 전사 입력이 `t_start/t_end`가 있는 청크로 저장 [ ] 테스트: 같은 영상 재처리 시 청크 중복 없음 [ ] 기존 PDF 경로 테스트 회귀 없음 [ ] `pnpm --filter worker test` 통과 |
