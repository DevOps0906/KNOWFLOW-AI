# task-019 계정 설정·삭제·소프트 삭제 정리 작업 S-13·A-10

| 항목 | 내용 |
|---|---|
| 웨이브 | W4 |
| 선행 | task-012, task-018 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 (계정·전 데이터 삭제, Storage 파일) |
| 담당 | builder (+ tester), 착수 전 challenger |
| 근거 | `spec S-13`, `docs/04_API.md#A-10`, `docs/05_DATA_MODEL.md`, `docs/01_PRD.md#8` |
| 쓰기 허용 | `apps/web/src/app/(app)/settings/**`, `apps/web/src/app/api/me/**`, `apps/worker/src/cleanup/**`, `supabase/migrations/**`(새 번호만) |

## 할 것
- S-13: 이름 수정, 사용량 요약 자리, 계정 삭제(확인 문구 입력)
- A-10: GET/PATCH `/api/me`, DELETE 시 확인 문구 검증, 처리 중 작업 있으면 409
- 계정 삭제: 프로젝트·자료·청크·리포트·대화·Storage 원본 전부 삭제. `usage_events`는 익명화(user_id 해제, 본문·이메일 없음)하여 보관
- 삭제는 단계별(Storage → DB 행 → auth 사용자)로 수행하고, 실패한 단계는 재시도 가능하게 멱등으로 만든다(횟수·간격 한도, 최종 실패는 본문 없는 경고 로그). auth 사용자 삭제는 Supabase 관리 API(서버 전용 키)로만
- 소프트 삭제된 항목을 보존 기간 후 영구 삭제하는 정리 작업(Worker 주기 실행, 기간은 `01_PRD.md#8-1` 값, 없으면 `미확인`)

## 하지 않을 것
- 사용량 집계·요청 한도(task-020), 결제·플랜 변경
- 삭제 로그에 자료 본문·이메일 기록

## 완료 조건 (실행 가능한 확인)
- [ ] 계정 삭제 후 해당 user_id의 모든 테이블 행·Storage 객체 0건(usage_events 제외, 익명화 행만 잔존)을 테스트로 확인
- [ ] 테스트: 삭제 중간 단계 실패 후 재실행 시 남은 단계만 완료되고 타 사용자 데이터 불변
- [ ] 확인 문구 불일치 422, 처리 중 작업 409 테스트 통과
- [ ] 정리 작업이 보존 기간 경과 항목만 삭제하고 타 사용자 데이터는 유지
- [ ] `pnpm typecheck` · `pnpm test` 통과
