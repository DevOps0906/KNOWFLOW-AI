# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-11
- 현재 작업: task-025 진행. 측정 도구(`scripts/phase0-youtube`, 테스트 50건) 완료, 실측 대기(키를 `apps/web/.env.local`의 `GEMINI_API_KEY`에, 권리 있는 영상 10편·라벨, 판정 기준 승인은 `docs/youtube-phase0-result.md` 1장). API 키 설정 탭은 task-027 착수 때 결정으로 보류. 브랜치 `wip/task-004`(분리·푸시는 사용자 결정)
- 마지막으로 한 일: task-032 `sources.unavailable_at`, 공유 패키지 `citations`(`verifyCitations`, 빌드 없는 ESM+d.ts). task-010 Worker 컨테이너·이그레스 프록시·A-05.
- 검증: worker 83건, web 129건, citations 21건, `pnpm test:db` 93건, typecheck·lint 통과. Worker 이미지 안 import와 임시 import `next build` 1회 확인.
- 미검증: 실제 Supabase 전반(Storage, `grant service_role to knowflow_worker`), 운영(Fly) 격리 방식(배포 전 결정), Codex 리뷰(사용 한도로 reviewer로 대체).
- 사용자 할 일: 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT` 이름 추가(도구로 쓰기 불가), Gemini 키·권리 있는 영상 10편·정답 라벨(task-025), 법무 확인(task-026), 개발 Supabase 프로젝트, 사전예약 폼 서비스.
- 다음 한 걸음: task-011 PDF 추출·청킹·색인 구현 착수(challenger 완료, 결정은 `tasks/task-011.md`의 "구현 결정" 절, 마이그레이션 번호 20261111000400). 코드 변경은 아직 없음. task-025 실측은 사람 입력 대기. 권장 순서 `tasks/README.md`.
- 기획: 유튜브 요약·장면 카드 최우선(`docs/adr/0006-*`, `docs/youtube-mvp-review.md`). 전사·프레임 저장 법무 확인 전 task-027 착수 금지. 세부 미정 5건은 검토 문서 8장.
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback `TEST_DATABASE_URL`에서만. 원격 DB 변경 금지. 적용된 마이그레이션 수정 금지. `sql2erd`는 `ADD COLUMN`을 읽지 않아 ERD에 추가 컬럼이 안 나온다. 기존 `knowflow-ai-worker-1`·`knowflow-ai-web-1` 컨테이너는 이번 작업과 무관.
- SDLC 단계: 06 구현 (W2·WY)
