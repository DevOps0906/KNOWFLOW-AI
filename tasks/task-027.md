# task-027 WY 유튜브 수집(URL 검증·Gemini 분석·시각 검증)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-010, task-026, task-032 |
| 위험도·보안 영향 | 높음 · 노출 면·키·권한·민감 데이터 (외부 AI·YouTube API, 비신뢰 전사) |
| 담당 | builder (+ tester). 착수 전 challenger. 완료 후 reviewer(security) |
| 근거 | `docs/youtube-mvp-review.md#5`, `docs/adr/0006-youtube-summary-and-capture-mvp.md`, `docs/04_API.md#A-04`, `spec S-09`, `docs/01_PRD.md#8` |
| 쓰기 허용 | `apps/worker/src/youtube/**`, `apps/web/src/lib/youtube/**`, `apps/web/src/app/api/projects/[projectId]/sources/**`, `apps/web/src/components/sources/**`, `supabase/migrations/**`(새 번호만), `packages/db-tests/**`, `.env.example`(이름만), Worker 외부 연결 허용 목록 설정(task-010 컨테이너 작업 산출물에 Gemini·YouTube Data API 추가만, 근거 `docs/02_ARCHITECTURE.md`의 허용 목록) |
| 할 것 | S-09 유튜브 탭, A-04 `video_id` 추출·`videos.list` 동기 거절, Worker Gemini 분석(전사 구간·장면 후보만, 공급자 인터페이스 뒤, 긴 영상 분할), 시각 검증, 일시 오류만 재시도, `(project_id, video_id)` 중복 판정, 한도 제안값 적용, `source_moments`(RLS) 마이그레이션, 일일 재확인 스윕(`retry_source`의 자료당 한도·최근 작업 조회에서 `source_recheck` 제외, 새 마이그레이션), Worker 외부 연결 허용 목록 추가 |
| 하지 않을 것 | 서버에서 영상·음성·자막 다운로드(yt-dlp·프록시 포함), 청킹(task-028), 요약·장면 카드 화면(task-029), 기존 마이그레이션 수정 |
| 완료 조건 | [ ] 테스트: `#5` 동기 거절 사유별 422 [ ] 테스트: 범위 밖 시각·잘린 출력 처리, 정책 거절 재시도 없음 [ ] 테스트: 프로젝트 내 같은 영상 중복 거절 [ ] DB 테스트: 새 테이블 RLS [ ] 테스트: 재확인이 비공개 전환과 삭제 영상(결과 없음)만 비활성, 장애는 판정 불가 재시도 [ ] `pnpm test` · `pnpm --filter worker test` · `pnpm test:db` · `secscan` 통과 |
| 착수 조건 | task-026 통과, `docs/youtube-mvp-review.md#7`의 02·03·04·05 반영 완료 |
