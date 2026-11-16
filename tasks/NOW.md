# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-17
- 현재 작업: task-029(영상 요약·장면 카드·S-10 플레이어)·task-030(사용자 승인 탭 캡처 L1) 구현 완료·커밋. 둘 다 스위치 꺼짐(`YOUTUBE_ENABLED`·`CAPTURE_ENABLED`). 브랜치 `wip/task-004`
- 다음: 사용자 결정에 따라 task-009(URL 가져오기) 또는 W3(task-013~). 유튜브·캡처 활성화는 task-025 실측(L1 포함)·task-026 법무(전사·프레임 저장) 판정 뒤.
- 우선순위(사용자 결정): W2·WY 계속 → 029 → 030 → W3. 설치형 앱(WA, task-033~035)은 task-024 뒤.
- 검증(2026-11-17, Node 26.13.0 스크래치): web 345, worker 196(+1 skip), db 200(14파일), typecheck·lint. 리뷰: 029·030 각각 codex-reviewer(code)+reviewer(security/contract) 🔴 전부 반영.
- 029·030 남은 확인: S-10 실제 화면 3구간 캡처(task-022에서), 실제 브라우저의 getDisplayMedia·CropTarget 동작(Chromium), 자료 삭제 외 정기 purge 실행(런북 `docs/runbooks/capture-purge.md`), takedown된 자료의 진행 중 작업은 lease 만료까지 재시도 후 종료(기존 동작).
- 029·030 알려진 한계: `tasks/task-030.md#구현 결정` 9번. 권리자 이메일·약관 공개 여부는 MVP 완성 단계에서 결정(사용자).
- 유튜브 활성화 전 남음: 사용자별 videos.list 호출 제한(웹), 서비스 일일 비용 상한, task-025 실측(clipTimeBase 확정), task-026 법무, Gemini 실호출 스모크(사용자 확인), Worker 키 API 제한(배포).
- 결정 정본: `tasks/task-027.md`·`task-012.md`·`task-029.md`·`task-030.md` "구현 결정", ADR-0006·0007.
- 미검증: 실제 Supabase(Storage 어댑터), 3구간 실제 세션 캡처(정적 렌더만, task-022), 운영 로캘 trigram, `secscan license`(lockfile 정보 없음), `apps/web/.env.example` 내용(권한상 읽기 불가).
- 사용자 할 일: 호스트 Node 26.13.0(현재 v24라 worker PDF 테스트 실패), 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT`·`YOUTUBE_METADATA_PROVIDER`·`YOUTUBE_WORKER_API_KEY` 이름 추가, 권리 있는 영상 10편·라벨(025), 법무(026), 개발 Supabase 프로젝트, 앱 서명·계정(ADR-0007 열린 결정).
- 주의: 적용된(커밋된) 마이그레이션 수정 금지 — 최신 20261117000100. 재정의 함수 최신본: replace_source_chunks(000400), replace_source_moments·register_youtube_source(000500), 큐 함수(000200). DB 테스트는 임베디드/loopback만. 로컬 Supabase(ContentFlow)는 다른 프로젝트.
- SDLC 단계: 06 구현 (W2 완료 근접·WY 구현 완료, 활성화 대기)
