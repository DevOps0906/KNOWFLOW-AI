# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-12
- 현재 작업: task-029 영상 요약·장면 카드(L0)·S-10 플레이어 착수 전(challenger). 착수 전 결정: 영상 단위 요약 저장 위치(05 :64), 권리자 삭제 요청 창구(youtube-mvp-review #8-3). 브랜치 `wip/task-004`
- 우선순위(사용자 결정): W2·WY 계속 → 029 → 030 → W3. 유튜브 플래그 `YOUTUBE_ENABLED` 기본 꺼짐, 활성화는 task-025 통과·task-026 판정 뒤. 설치형 앱(WA, task-033~035)은 task-024 뒤.
- 최근 커밋: 4c3687e(task-012 완료·027d), 41e4893(설치형 앱 기획 ADR-0007), 43d2f72(027a~c·028), 0cfb2c8(011).
- 검증: web 276, worker 183(+1), db 165, typecheck·lint, Docker verify-youtube·ingest·egress·parser-sandbox(Node 26.13.0, 스크래치 Node).
- 유튜브 활성화 전 남음: 사용자별 videos.list 호출 제한(웹), 서비스 일일 비용 상한, task-025 실측(clipTimeBase 확정), task-026 법무, Gemini 실호출 스모크(사용자 확인), Worker 키 API 제한(배포).
- 결정 정본: `tasks/task-027.md`·`tasks/task-012.md` "구현 결정", ADR-0006·0007.
- 미검증: 실제 Supabase(Storage 어댑터), 3구간 실제 세션 캡처(정적 렌더만, task-022), 운영 로캘 trigram, `secscan license`(lockfile 정보 없음), `apps/web/.env.example` 내용(권한상 읽기 불가).
- 사용자 할 일: 호스트 Node 26.13.0, 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT`·`YOUTUBE_METADATA_PROVIDER`·`YOUTUBE_WORKER_API_KEY` 이름 추가, 권리 있는 영상 10편·라벨(025), 법무(026), 개발 Supabase 프로젝트, 앱 서명·계정(ADR-0007 열린 결정).
- 주의: 적용된(커밋된) 마이그레이션 수정 금지 — 최신 20261112000300. 재정의 함수의 최신본은 000200(큐 함수)·000100(register·refund). DB 테스트는 임베디드/loopback만. 로컬 Supabase(ContentFlow)는 다른 프로젝트.
- SDLC 단계: 06 구현 (W2 완료 근접·WY)
