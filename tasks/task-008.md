# task-008 W2 PDF 업로드·Storage S-09·A-04

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-007 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 · 민감 데이터 (파일 업로드, 사용자 원본) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-09`, `docs/04_API.md#A-04`, `docs/01_PRD.md#8`, `docs/01_PRD.md#8-1`, `docs/adr/0003-*.md` |
| 쓰기 허용 | `apps/web/src/app/(app)/projects/[projectId]/sources/**`, `apps/web/src/app/api/projects/[projectId]/sources/**`, `apps/web/src/components/sources/**`, `apps/web/src/lib/storage/**`, `supabase/migrations/**`(새 번호만, 기능 쓰기 RPC), `packages/db-tests/**`(RPC 음성 테스트) |

## 할 것
- 업로드 흐름: 서명 업로드 URL 발급 → 클라이언트가 Storage에 직접 업로드 → 등록 API 호출(웹 서버는 파일 본문을 받지 않음, 본문 한도는 ADR-0003)
- 등록 시 Storage 객체의 확장자·MIME·크기(1개 50MB)·매직 바이트를 서버가 재검증, 파일명 정규화, 한 번에 10개
- 파일마다 멱등 키(`idempotency_keys`), 자료 수·월 처리 쿼터는 `consume_quota` 사용, content_hash 중복 409
- Storage 경로 `user_id/...`, 읽기는 서명 URL만; 등록은 `enqueue_job`으로 sources(queued)·processing_jobs 생성 후 202
- S-09 다이얼로그 PDF 탭 + URL 탭 UI(URL 수집 로직은 task-009)
- 오류: 413·415·429(자료 50개)·409; 감사 로그(본문 제외)

## 하지 않을 것
- 쪽수(500쪽)·스캔 PDF 판정(Worker가 판정, task-011), 텍스트 추출·임베딩(task-011), URL 수집 로직(task-009), 파일을 웹 서버에서 장시간 처리

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm typecheck` · `pnpm test` 통과
- [ ] 테스트: 확장자만 .pdf인 파일 415, 경로 조작 파일명이 정규화됨, 51MB 413
- [ ] 테스트: 같은 멱등 키+다른 입력 409, 같은 멱등 키 재요청 시 중복 등록 없음, 타인 프로젝트 404
- [ ] 타인 Storage 객체 접근 실패 테스트 통과
- [ ] S-09 PDF·URL 탭 3구간 렌더 확인
