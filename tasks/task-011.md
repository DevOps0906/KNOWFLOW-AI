# task-011 W2 추출·청킹·임베딩·색인

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-010 (유튜브 전사는 task-028이 연결. task-009가 유튜브 뒤로 이동해 URL 본문 추출은 task-009 완료 뒤 연결) |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 · 키·권한 (악성 PDF, AI 공급자 키, 비신뢰 텍스트) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/05_DATA_MODEL.md#4`, `docs/05_DATA_MODEL.md#5`, `docs/adr/0002-mvp-tech-decisions.md`, `docs/diagrams/02-rag-and-job-flow.md` |
| 쓰기 허용 | `apps/worker/**`(egress 허용 목록 제외), `compose.yaml`(핸들러 모드·mem_limit만), `apps/worker/package.json`·`pnpm-lock.yaml`(파서만), `supabase/migrations/**`(새 번호, 펜싱된 청크 교체 RPC), `packages/db-tests/**` |
| 확정(2026-11-11) | 파싱 하위 프로세스는 Node 권한 모델로 fs·네트워크 차단, 바이트는 stdin. 원본 읽기는 인터페이스 뒤(로컬 고정 파일 어댑터, Storage 어댑터는 실제 Supabase 준비 후). 요약은 후행 단계·공급자 인터페이스, 로컬은 스텁(실제 공급자는 키 준비 후). `embedding_model`은 벡터 저장 때만 기록 |

## 할 것
- PDF 텍스트 추출(쪽 번호 locator.page 보존), URL 본문 추출(task-009 결과 사용)
- 파싱은 비밀·네트워크 없는 하위 프로세스에서 실행(서비스 키·공급자 키 환경 변수 미전달, 시간·메모리 제한)
- 500쪽 초과·스캔 PDF는 sources.status=failed + error_code로 처리(판정은 Worker)
- 청크 크기/겹침, 임베딩 모델명·차원은 설정 파일로 외부화(잠정값 bge-m3·1024, task-013이 값만 변경). 임베딩은 인터페이스 뒤에 두고 embedding_model 기록
- 벡터 컬럼은 task-013 마이그레이션 전에는 없음: 이 작업은 청크·content_tsv 색인까지 구현하고 벡터 저장은 인터페이스·목으로 검증(실제 저장 연결은 task-013)
- 색인: content_tsv, pg_trgm 키워드 검색; 완료 시 sources.status=completed
- 프로젝트 첫 자료 완료 시 `projects.summary`·`suggested_questions` 생성(자료 본문은 데이터로만 취급)
- 단계(current_step)·progress 갱신, 사용 기록(usage_events), 월 자료 처리 100건은 등록 시 `enqueue_job`이 차감(Worker 추가 차감 금지)

## 하지 않을 것
- 질의응답·인용 생성, 골든셋 평가·모델 확정(task-013), 공급자 키를 코드에 직접 기재, 청크 본문 로그

## 완료 조건 (실행 가능한 확인)
- [x] `pnpm --filter worker test` 통과(샘플 PDF 2종, 스캔 PDF·500쪽 초과 failed+error_code 케이스 포함)
- [x] 테스트: 파싱 하위 프로세스 환경에 비밀 키 없음, 네트워크 시도 실패
- [x] 테스트: 같은 source 재처리 시 청크 중복 없음, 다른 임베딩 모델 청크 혼합 거부
- [x] 테스트: 하위 프로세스가 `/proc/1/environ` 읽기, db·프록시 접속에 실패
- [x] compose에서 고정 파일 어댑터로 queued→completed 종단 확인, 청크 locator.page 존재, projects.summary·suggested_questions 채워짐(스텁 공급자)

## 구현 결정 (2026-11-11 challenger 반영, 팀장 확정)
쓰기 범위: `apps/worker/**`(egress-proxy 허용 목록 제외), `compose.yaml`(worker 핸들러 모드 변수화·mem_limit만), `apps/worker/package.json`·`pnpm-lock.yaml`(파서 의존성만), `supabase/migrations/20261111000400_*`(새 파일 1개), `packages/db-tests/**`.
금지: `.env*` 접근, 공급자 실호출, 질의응답·인용, 벡터 컬럼(task-013), commit·push, 실행 못 한 검증을 통과로 보고. 새 의존성은 `secscan license` 확인(GPL·AGPL 거부).

1. 연결: `HandlerContext`에 필요한 DB 접근과 원본 읽기 어댑터를 넣고 `handlers.ts`·`main.ts`에 `ingest_source` 실제 핸들러를 등록. compose의 `WORKER_DUMMY_HANDLERS`는 변수화(기본 0). `vitest.config.ts` include에 `tests/**` 추가 또는 테스트를 `src/` 옆에 둔다.
2. 파서: `unpdf`(MIT) 또는 `pdfjs-dist`(Apache-2.0) 중 하나, `isEvalSupported: false`. poppler·MuPDF·Ghostscript 금지.
3. 격리(필수): 하위 프로세스는 Node `--permission`으로 실행하고 fs 읽기는 파서 스크립트·의존성 경로만 허용, 자식 프로세스·워커·네트워크 금지. 환경 변수는 빈 객체로 전달. 바이트는 stdin, 결과는 stdout(JSON). 사용 중인 Node 버전에서 네트워크가 실제로 막히는지 테스트로 확인하고, 막히지 않으면 구현을 멈추고 보고(다른 격리 방식은 팀장 결정).
   테스트는 실제로 시도해 실패를 확인: `/proc/1/environ`·`/proc/self/environ` 읽기, db:5432·egress-proxy:8888 TCP 접속, 외부 DNS. Docker 안에서 실행하는 검증 스크립트(`scripts/verify-parser-sandbox.mjs`)를 추가.
4. 자원: 시간 제한, `--max-old-space-size`, stdout 크기 상한, compose worker `mem_limit`. 하위 프로세스의 시간 초과·OOM·비정상 종료·출력 초과는 `PermanentError`(고정 error_code)로 분류해 독성 작업이 3회 재회수되지 않게 한다.
5. 입력 검증: `%PDF-` 매직 바이트, SHA-256 재계산해 `sources.content_hash`와 다르면 `content_hash_mismatch` 영구 실패. 암호화 PDF `encrypted_pdf`, 500쪽 초과 `too_many_pages`.
6. 스캔 판정: 쪽당 유효 문자(한글·라틴·숫자) 수와 비율 임계값을 설정 파일로. 유효 텍스트 쪽이 비율 미만이면 `scanned_pdf` 실패, 일부 쪽만 스캔이면 텍스트 쪽만 색인하고 건너뛴 쪽 수 기록. PUA 문자 비율이 높으면 깨진 텍스트로 보고 같은 규칙 적용. error_code 목록은 상수로 고정.
7. 텍스트: NFC 정규화, `\u0000`·제어문자 제거. `content_tsv`는 생성 컬럼이므로 쓰지 않는다. compose DB에서 `show_trgm('한국어')`가 비어 있지 않은지 DB 테스트.
8. 청크·펜싱: 새 마이그레이션에 `replace_source_chunks(job_id, attempt, chunks jsonb)` service_role 전용 RPC. `processing_jobs`를 `(id, attempt_count, status='running')` 조건 FOR UPDATE로 잠근 한 트랜잭션에서 기존 청크 삭제·삽입. 가능하면 complete와 같은 트랜잭션. 펜싱 실패는 stale 처리. `embedding_model`은 벡터 저장 때만 채우므로 이 작업에서는 NULL. 다른 임베딩 모델 혼합 거부는 임베딩 인터페이스 단위 테스트로.
9. 임베딩: 인터페이스와 목만. 실제 호출·벡터 저장 없음.
10. 원본 읽기: `SourceReader` 인터페이스. 로컬은 고정 파일 어댑터(마운트된 픽스처 폴더에서 storage_path로 읽기, 경로 탈출 차단). Supabase Storage 어댑터는 인터페이스만 두고 미구현 표시.
11. 요약: 청크 완료와 분리한 후행 단계. 공급자 인터페이스 뒤에 두고 로컬은 스텁 공급자. "첫 자료" 판정은 `projects.summary IS NULL` 조건부 갱신으로 경합 처리. `suggested_questions` 개수·길이는 코드로 검증. 요약 실패는 자료를 실패시키지 않는다. 자료 본문은 데이터로만 취급(프롬프트 분리).
12. 사용 기록·단계: `current_step`·`progress` 갱신, `usage_events` 기록. 월 처리 차감은 하지 않는다. 청크 본문 로그 금지.

완료 확인(실제 실행, q 사용): `pnpm --filter worker test`(샘플 PDF 2종·스캔·500쪽 초과·암호화·해시 불일치), `pnpm test:db`, `pnpm typecheck`, `secscan license`, Docker 안 `verify-parser-sandbox.mjs`, compose에서 고정 파일 어댑터로 queued→completed 종단 확인(청크 locator.page, projects.summary·suggested_questions 채워짐), 기존 `verify-egress.mjs` 회귀.

### 1단계 결과·팀장 결정 (2026-11-12)
- 파서 unpdf 2.1.0(MIT, 의존성 0). 공개 API `parsePdf(bytes, expectedHash, opts)` · `sha256Hex` (`apps/worker/src/pdf/`).
- `isEvalSupported` 옵션은 unpdf 타입에 없어 빼고, V8 `--disallow-code-generation-from-strings`로 대체(승인: 더 아래 계층에서 막음, 테스트·Docker에서 EvalError 확인).
- 스캔 임계값: 쪽당 유효 문자 10자·유효 비율 0.5·PUA 0.2, 텍스트 쪽 비율 0.3 미만이면 scanned. 한도 120초·512MB·출력 64MB. 소유자 암호만 있는 PDF는 정상 처리.
- 호스트 Node가 24이면 `--allow-net`이 없어 fail-closed로 PDF 테스트가 실패한다 → 호스트 Node 26 필요(사용자 할 일).
- `secscan license`는 lockfile 라이선스 정보가 없어 판정 불가. 팀장이 설치본 `node_modules/unpdf/package.json`(license MIT, dependencies 없음)과 LICENSE 파일(MIT)을 직접 확인해 승인(2026-11-12). secscan 도구 개선은 별도 과제.
- 1단계 보안 리뷰 🟡(2단계 뒤 반영): 실행 전 입력 바이트 상한, `text.ts` 문자 계산을 배열 없는 순회로, 종료 signal 보존·OOM 판정 명확화, 심볼릭 링크 탈출 테스트.
- 완료(2026-11-12): 리뷰 🟡 9건 반영. 팀장 재실행으로 worker 127(+1 Windows 건너뜀, 같은 확인은 Docker에서), db 105, typecheck·lint, verify-ingest·verify-parser-sandbox·verify-egress 통과. 남은 것: Storage 어댑터(실제 Supabase 준비 후), 로컬 모드 가드 강화(task-024), error_code 화면 문구 매핑(task-012), 입력 상한 50MB 상수 2곳(PARSER_LIMITS·SOURCE_MAX_BYTES) 유지.
