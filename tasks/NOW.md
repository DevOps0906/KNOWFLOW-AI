# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-11
- 현재 작업: task-032 유튜브 게이트 무관 기반(`sources.unavailable_at`·`packages/citations`). 브랜치 `wip/task-004`(분리·푸시는 사용자 결정)
- 마지막으로 한 일: task-010 완료. Worker 컨테이너·CONNECT 이그레스 프록시 격리, 비슈퍼유저 Worker DB 역할, A-05 목록·재시도와 retryable·분당 한도 RPC.
- 검증: worker 82건, web 128건, `pnpm test:db` 91건, typecheck·lint 통과. `verify-dummy-job`·`verify-egress`(197건)·`verify-secrets` 통과(`apps/worker/scripts`, GNU tar 전제).
- 미검증: 실제 Supabase 전반(Storage, `grant service_role to knowflow_worker`), 운영(Fly) 격리 방식(배포 전 결정), Codex 리뷰(사용 한도로 reviewer로 대체).
- 사용자 할 일: 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT` 이름 추가(도구로 쓰기 불가), Gemini 키·권리 있는 영상 10편·정답 라벨(task-025), 법무 확인(task-026), 개발 Supabase 프로젝트, 사전예약 폼 서비스.
- 다음 한 걸음: task-032 구현 → task-025(사람 입력 필요) 또는 task-011 PDF 추출(법무와 무관). 권장 순서 `tasks/README.md`.
- 기획: 유튜브 요약·장면 카드 최우선(`docs/adr/0006-*`, `docs/youtube-mvp-review.md`). 전사·프레임 저장 법무 확인 전 task-027 착수 금지. 세부 미정 5건은 검토 문서 8장.
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback `TEST_DATABASE_URL`에서만. 원격 DB 변경 금지. 적용된 마이그레이션 수정 금지. 기존 `knowflow-ai-worker-1`·`knowflow-ai-web-1` 컨테이너는 이번 작업과 무관.
- SDLC 단계: 06 구현 (W2·WY)
