# task-011 W2 추출·청킹·임베딩·색인

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-010 (유튜브 전사는 task-028이 연결. task-009가 유튜브 뒤로 이동해 URL 본문 추출은 task-009 완료 뒤 연결) |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 · 키·권한 (악성 PDF, AI 공급자 키, 비신뢰 텍스트) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md#4`, `docs/05_DATA_MODEL.md#5`, `docs/adr/0002-mvp-tech-decisions.md`, `docs/diagrams/02-rag-and-job-flow.md` |
| 쓰기 허용 | `apps/worker/src/pipeline/**`, `apps/worker/src/config/**`(청킹·임베딩 설정 파일), `apps/worker/tests/**` |

## 할 것
- PDF 텍스트 추출(쪽 번호 locator.page 보존), URL 본문 추출(task-009 결과 사용)
- 파싱은 비밀·네트워크 없는 하위 프로세스에서 실행(서비스 키·공급자 키 환경 변수 미전달, 시간·메모리 제한)
- 500쪽 초과·스캔 PDF는 sources.status=failed + error_code로 처리(판정은 Worker)
- 청크 크기/겹침, 임베딩 모델명·차원은 설정 파일로 외부화(잠정값 bge-m3·1024, task-013이 값만 변경). 임베딩은 인터페이스 뒤에 두고 embedding_model 기록
- 벡터 컬럼은 task-013 마이그레이션 전에는 없음: 이 작업은 청크·content_tsv 색인까지 구현하고 벡터 저장은 인터페이스·목으로 검증(실제 저장 연결은 task-013)
- 색인: content_tsv, pg_trgm 키워드 검색; 완료 시 sources.status=completed
- 프로젝트 첫 자료 완료 시 `projects.summary`·`suggested_questions` 생성(자료 본문은 데이터로만 취급)
- 단계(current_step)·progress 갱신, 사용 기록(usage_events), 월 자료 처리 100건은 등록 시 `enqueue_job`이 차감(Worker 추가 차감 금지)

## 하지 않을 것
- 질의응답·인용 생성, 골든셋 평가·모델 확정(task-013), 공급자 키를 코드에 직접 기재, 청크 본문 로그

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm --filter worker test` 통과(샘플 PDF 2종, 스캔 PDF·500쪽 초과 failed+error_code 케이스 포함)
- [ ] 테스트: 파싱 하위 프로세스 환경에 비밀 키 없음, 네트워크 시도 실패
- [ ] 테스트: 같은 source 재처리 시 청크 중복 없음, 다른 임베딩 모델 청크 혼합 거부
- [ ] 로컬에서 업로드→queued→completed 종단 확인, 청크 locator.page 존재, projects.summary·suggested_questions 채워짐
