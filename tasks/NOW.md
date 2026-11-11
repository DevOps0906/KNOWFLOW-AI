# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-12
- 현재 작업: 없음. 다음은 task-012 자료 목록·원문 뷰어 S-08·S-10·A-03·A-07(위험 높음 → 착수 전 challenger). S-10은 task-029 영상 플레이어·장면 카드의 바탕. 브랜치 `wip/task-004`(분리·푸시는 사용자 결정)
- 우선순위(2026-11-12 사용자 결정): 유튜브 구현 최우선 027 → 028 → 012 → 029 → 030. 기능 플래그 `YOUTUBE_ENABLED` 기본 꺼짐, 활성화는 task-025 통과·task-026 판정 뒤(ADR-0006 결정 2).
- 마지막으로 한 일: task-027 027a~c + task-028 커밋 43d2f72. task-011 커밋 0cfb2c8. 결정·RPC 계약 정본은 `tasks/task-027.md` "구현 결정".
- 검증: worker 157(+1), web 207, db 131, typecheck·lint, Docker verify-youtube·ingest·parser-sandbox·egress 통과(Node 26.13.0, 호스트는 24라 스크래치 Node 사용).
- 활성화 전 필수(task-027 남음): 027d 재확인 스윕·파기·큐 함수 job_type 분기, 사용자별 videos.list 호출 제한, 서비스 일일 비용 상한, task-025 실측(clipTimeBase 확정), task-026 법무, Gemini 실호출 스모크(사용자 확인 후, 키는 셸 `GEMINI_API_KEY`로 compose에 넘김).
- 키: Gemini 키는 루트 `.env.local`(읽지 않음). 웹 service_role은 `apps/web/src/server/youtube/service.ts` 한 곳만(사용자 결정).
- 미검증: 실제 Supabase(Storage 어댑터 미구현), 운영 로캘 한글 trigram, `secscan license`(lockfile 정보 없음, unpdf·server-only 수동 MIT), `apps/web/.env.example` 내용(권한상 읽기 불가 — 사용자 확인 요청).
- 사용자 할 일: 호스트 Node 26.13.0, 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT` 이름 추가, 권리 있는 영상 10편·라벨(task-025), 법무 확인(task-026), 개발 Supabase 프로젝트, `*.pdf binary` .gitattributes 여부.
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback만. 원격 DB 변경 금지. 적용된 마이그레이션 수정 금지(20261112000100은 이제 커밋됨). `sql2erd`는 ALTER 컬럼을 못 읽는다. 웹 DB 타입 파일 재생성 불가(supabase CLI 없음).
- SDLC 단계: 06 구현 (W2·WY)
