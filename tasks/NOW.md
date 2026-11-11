# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-12
- 현재 작업: 없음(task-011 완료·커밋). 다음은 task-012 자료 목록·원문 뷰어 S-08·S-10·A-03·A-07(위험 높음 → 착수 전 challenger). task-025는 실측 대기(사람 입력). 브랜치 `wip/task-004`(분리·푸시는 사용자 결정)
- 마지막으로 한 일: task-011 PDF 추출·청킹·색인. 파서 unpdf 2.1.0을 Node `--permission` 격리 하위 프로세스에서 실행(`apps/worker/src/pdf/`), ingest 핸들러(`apps/worker/src/ingest/`), 펜싱 RPC `replace_source_chunks`(20261111000400), compose 고정 파일 어댑터·스텁 요약.
- 검증: worker 127(+1 Windows 건너뜀), db 105, typecheck·lint, Docker `verify-ingest`·`verify-parser-sandbox`·`verify-egress` 통과. 리뷰: codex-reviewer(security·code)·reviewer(security/contract) 🔴 없음, 🟡 9건 반영.
- 미검증: 실제 Supabase(Storage 어댑터 미구현 → 운영 PDF는 재시도 후 실패), 운영 로캘의 한글 trigram, 운영(Fly) 격리 방식, `secscan license`(lockfile 라이선스 정보 없음, unpdf는 팀장 수동 MIT 확인).
- 사용자 할 일: 호스트 Node 26.13.0 설치(24에서는 PDF 테스트 17건 fail-closed), 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT` 이름 추가, Gemini 키·권리 있는 영상 10편·라벨(task-025), 법무 확인(task-026), 개발 Supabase 프로젝트, 사전예약 폼 서비스.
- task-012로 넘길 것: 새 error_code(`INGEST_ERROR_CODES`·`PDF_ERROR_CODES`)를 화면 문구로 매핑. 로컬 모드 가드 강화는 task-024.
- 주의: DB 테스트는 임베디드 Postgres 또는 loopback `TEST_DATABASE_URL`에서만(db-tests 로캘을 UTF-8로 변경함). 원격 DB 변경 금지. 적용된 마이그레이션 수정 금지. `sql2erd`는 `ADD COLUMN`을 읽지 않는다. 입력 상한 50MB가 `PARSER_LIMITS`·`SOURCE_MAX_BYTES` 두 곳에 있다.
- SDLC 단계: 06 구현 (W2·WY)
