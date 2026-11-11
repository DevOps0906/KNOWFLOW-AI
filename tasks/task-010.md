# task-010 W2 작업 큐(테이블 폴링)·Worker 컨테이너 골격·A-05 재시도

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-004, task-008 |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 (Worker 전용 서비스 키, 네트워크 격리) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/adr/0002-mvp-tech-decisions.md`, `docs/04_API.md#A-05`, `docs/05_DATA_MODEL.md#6`, `docs/01_PRD.md#8-1` |
| 쓰기 허용 | `apps/worker/**`, `supabase/migrations/**`(새 번호만), `apps/web/src/app/api/projects/[projectId]/jobs/**`, `apps/web/src/app/api/sources/[sourceId]/retry/**`, `apps/web/src/lib/jobs/**`, `packages/db-tests/**`, 루트 `compose.yaml`·`.dockerignore` |

## 할 것
- processing_jobs 테이블 폴링(`FOR UPDATE SKIP LOCKED` + `locked_until` 임대, ADR-0005). 처리량 측정 기록
- Worker 상시 컨테이너 1개: 작업 수신·상태 전이(queued→running→succeeded/failed)·attempt_count·재시도 한도, 서비스 키는 Worker 전용 환경 변수
- lease/heartbeat: 시작 시 `locked_until` 설정, 주기적으로 `heartbeat_at` 갱신, 만료된 running 작업은 회수해 재큐잉(attempt_count 증가)
- 임대 만료로 같은 작업을 다시 가져가도 두 번 실행·중복 결과를 내지 않도록 상태 전이로 막음
- 컨테이너 외부 연결 허용 목록(DB·임베딩 서버·AI 공급자만 허용, 그 밖 사설·메타데이터 주소 차단)과 검증 스크립트
- A-05: 작업 목록 조회, 재시도=새 작업(새 멱등 키), 진행 중 409, 한도 초과 429

## 하지 않을 것
- 추출·임베딩 로직(task-011), URL 수집(task-009), 운영 배포, 서버리스 Worker

## 완료 조건 (실행 가능한 확인)
- [ ] `docker compose up worker` 기동, 더미 작업이 succeeded로 전이
- [ ] 컨테이너 안에서 169.254.169.254·허용 목록 밖 사설 IP 연결 실패, 허용 대상(DB·임베딩·AI)은 성공하는 스크립트 통과
- [ ] 테스트: Worker 강제 종료 후 `locked_until` 만료 작업이 회수·재실행됨
- [ ] 테스트: 임대 만료 후 재수령 시 결과 중복 없음
- [ ] 테스트: 실패 작업 재시도 시 새 작업 생성, 진행 중 재시도 409
- [ ] 서비스 키가 웹 번들·로그에 없음(`secscan`)
