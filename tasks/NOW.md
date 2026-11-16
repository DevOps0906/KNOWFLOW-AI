# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-16
- 다음 작업: **task-030** 사용자 승인 탭 캡처(L1). 높음 → 착수 전 challenger. 활성화는 026 법무 뒤(플래그 꺼짐 유지). 브랜치 master.
- 우선순위(사용자 결정): 029(완료) → 030 → W3(013 → 014 → 015 …) · 009. 유튜브 플래그 `YOUTUBE_ENABLED` 기본 꺼짐, 활성화는 task-025 통과·task-026 판정 뒤. 설치형 앱(WA, task-033~035)은 task-024 뒤.
- 최근 커밋: task-029 완료(029b·000600), f5dc95c(029a·029c), 03344ad(README), 4c3687e(task-012).
- 검증(2026-11-16): web 299, worker 197(+1 skip), citations 27, db 181, `pnpm -r typecheck`·`lint`.
- 환경(이 PC): pnpm은 PATH에 없음 → `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm …`. 설치는 `--config.strict-dep-builds=false`(embedded-postgres 윈도 빌드 스크립트 미실행, 저장소 설정 무변경). 호스트 Node 24.16 → worker PDF 파서 테스트 실패, 스크래치 Node 26.13.0을 PATH 앞에 두고 실행(세션 스크래치라 사라질 수 있음).
- Codex 인증 실패(401) → codex-reviewer 대신 reviewer(code·security)로 검증 중.
- shot: 500px 미만은 iframe 래핑이라 앱 CSP(frame-ancestors)에 막힘 → 모바일 구간은 520px로 캡처.
- 유튜브 활성화 전 남음: 사용자별 videos.list 호출 제한(웹), 서비스 일일 비용 상한, task-025 실측(clipTimeBase 확정), task-026 법무, Gemini 실호출 스모크(사용자 확인), Worker 키 API 제한(배포), takedown된 video_id 재등록 차단(rights_takedowns 조회).
- 결정 정본: `tasks/task-029.md`·`tasks/task-027.md`·`tasks/task-012.md` "구현 결정", ADR-0006·0007.
- 미검증: 실제 Supabase(Storage 어댑터), S-10 등 로그인 화면의 실제 세션 3구간 캡처(task-022), 운영 로캘 trigram, `secscan license`, `.env.example` 내용(권한상 읽기 불가), 웹 DB 타입 파일 `apps/web/src/types/db.ts` 없음(요약은 비타입 쿼리).
- 사용자 할 일: 호스트 Node 26.13.0, Codex 재로그인, `.env.example`에 `RIGHTS_CONTACT_EMAIL`·`KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT`·`YOUTUBE_METADATA_PROVIDER`·`YOUTUBE_WORKER_API_KEY` 이름 추가, `design/` 자동 재생성분(spec.json·와이어프레임 19개, 미커밋) 커밋 여부, 권리 있는 영상 10편·라벨(025), 법무(026), 개발 Supabase 프로젝트, 앱 서명·계정(ADR-0007). 보류: 권리자 신고 이메일·약관 공개 여부(MVP 완성 단계).
- 주의: 적용된(커밋된) 마이그레이션 수정 금지 — 최신 20261112000600. 재정의 함수 최신본: save_source_summary 000600, replace_source_chunks 000400, replace_source_moments 000500, 큐 함수 000200(20261112), register·refund 000100. DB 테스트는 임베디드/loopback만. 로컬 Supabase(ContentFlow)는 다른 프로젝트.
- SDLC 단계: 06 구현 (WY 진행)
