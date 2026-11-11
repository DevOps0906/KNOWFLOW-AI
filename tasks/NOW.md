# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-06
- 현재 작업: task-008 PDF 업로드·Storage(S-09, A-04) 구현 완료. 브랜치 `wip/task-004` 위(분리·푸시는 사용자 결정)
- 마지막으로 한 일: `register_pdf_source` RPC(객체 크기·MIME 재확인, 같은 내용 409, 멱등 키), A-04 POST(step=upload_url·register, 경로는 무작위 이름, 매직 바이트 서버 검사), 업로드 흐름·S-09 폼·다이얼로그, `/projects/[id]/sources/new` 임시 진입 화면.
- 검증: `pnpm test:db` 58건, `pnpm --filter web test` 102건, typecheck·lint(기존 경고 1)·build 통과
- 미검증: 실제 Supabase Storage(서명 업로드 URL·`uploadToSignedUrl`·Range 읽기·`storage.objects.metadata` 키 size/mimetype), 화면 3구간 캡처. 앞선 task-005·007의 미검증 사항도 그대로. challenger·reviewer 절차는 안 돌렸다.
- 다음 한 걸음: task-008 커밋 → task-010 작업 큐·Worker 골격(선행 task-004·008 완료)
- 열린 결정(사용자): 사전예약 폼 서비스, GitHub 보안 설정, Supabase·Vercel MCP 차단 여부, 개발 Supabase 프로젝트 생성 시점(통합 검증이 모두 이것에 막혀 있다), `.env.local`의 `AUTH_RATE_LIMIT_SECRET`·`NEXT_PUBLIC_SITE_URL`
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback `TEST_DATABASE_URL`에서만(`DB_TESTS_ALLOW_RESET=1`). 원격 DB 변경 금지. 기존 마이그레이션 수정 금지. `apps/worker/`는 untracked(로그·캐시뿐)라 커밋하지 않는다.
- SDLC 단계: 06 구현 (W2)
- 다음 작업: task-010 작업 큐·Worker 골격
- 기획 변경(2026-11-11, 미커밋): 유튜브 요약·중요 장면 캡처 최우선. `docs/adr/0006-*`(채택)·`docs/youtube-mvp-review.md`·task-025~032 신설, 03·04·05·다이어그램 반영. 권장 순서 010 → 032 → 025 Phase 0 → 026 법무 게이트 → 027 수집. 세부 미정은 검토 문서 8장. 전사·프레임 저장 법무 확인 전 유튜브 수집 구현 금지
