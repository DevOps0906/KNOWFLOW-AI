# 05 데이터 모델 — KNOWFLOW-AI

> **조건부**: `00_LEAN.md` 린 검증과 ADR-0002에 따라 병행한다(린 통과 전 마이그레이션 금지 문구는 폐기).
> 테이블 정본 구조: [`diagrams/03-data-model-erd.md`](diagrams/03-data-model-erd.md)(v1.1 제안). 코드가 생기면 `sql2erd supabase/migrations -o docs/diagrams/erd.mmd`로 ERD를 다시 생성한다(손으로 그리지 않음). 여기서는 그림의 사실을 복사하지 않고 컬럼 결정·RLS만 쓴다.
> 채택 패턴: 작업 계약 [`blueprints/contracts/JOBS.md`](blueprints/contracts/JOBS.md), 서비스 키 [`blueprints/contracts/ACCESS.md`](blueprints/contracts/ACCESS.md), 출처 비복사 원칙 [`blueprints/rag-chat/data.md`](blueprints/rag-chat/data.md). **조직·역할·다중 테넌트는 MVP 제외** — 소유 단위는 `user_id` 한 사람이다.
> 표기: ★ 개인정보 가능 컬럼. 공통 컬럼 `created_at`·`updated_at`은 표에서 생략(ERD 참조).

## 1. 테이블
| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
| profiles | 앱 프로필(S-02·03·13) | id(PK = `auth.users.id`), display_name★ | 본인 행만 읽기·수정. 생성은 가입 트리거 | 로그인·세션은 Supabase Auth 관리(표에 넣지 않음). 계정 삭제 요청 시 하위 데이터 연쇄 삭제(순서 미정, 5장) |
| projects | 자료·대화·리포트의 묶음(S-05~08) | id, user_id★→profiles, name, description, archived_at, deleted_at, summary, suggested_questions(jsonb) | `user_id = auth.uid()` 행만 SELECT. 쓰기는 RPC | 클라이언트가 준 user_id는 무시하고 서버가 채운다. summary·suggested_questions는 자료 completed 시 Worker가 생성·저장. 삭제 정책은 5장 |
| sources | 자료 1건(S-08·09·10) | id, project_id, user_id, source_type, title★, original_url, storage_path, content_hash, video_id, channel_title, duration_seconds, metadata_checked_at, unavailable_at, status, error_code, error_message_safe, deleted_at | `user_id = auth.uid()` AND 소속 프로젝트 소유 일치. 상태 쓰기는 서버만 | source_type: MVP `pdf`·`youtube`·`url`, 예약 `audio`·`video`·`docx`·`pptx`·`image`·`text`(3장). status는 `queued`·`processing`·`completed`·`failed`. unique (project_id, content_hash), (project_id, video_id). 유튜브 컬럼 규칙은 8장 |
| source_chunks | 검색 단위 조각(S-08 질의, S-10 뷰어) | id, source_id, project_id, chunk_index, content★, locator(jsonb), embedding(vector), embedding_model, content_tsv | 사용자 직접 SELECT 없음. 서버·검색 함수가 `project_id`+`user_id` 강제 후 반환(소속 자료가 본인 것일 때만) | 인용 위치는 `locator` jsonb(3장). embedding vector 차원 컬럼은 골든셋 확정 후 별도 마이그레이션으로 추가(5장). unique (source_id, chunk_index). 모델이 다른 청크를 섞지 않는다 |
| source_moments | 유튜브 장면 카드 L0(S-10) | id, source_id, project_id, user_id, moment_index, locator(jsonb: t_start·t_end), title★, description★ | `user_id = auth.uid()` AND 소속 자료 미삭제·미비활성. 쓰기는 서비스 키 Worker만 | 시각 검증을 통과한 구간만 저장. 청크 FK 없이 `locator` 구간 겹침으로 연결(8장). unique (source_id, moment_index) |
| processing_jobs | 자료 처리 작업·이력(S-06·08·09) | id, user_id, source_id(nullable), report_id(nullable)→reports, job_type(`source_ingest`·`report_generate`·`source_recheck`), status, current_step, progress(0~100), attempt_count, max_attempts(기본 3), locked_until, heartbeat_at, error_code, retryable(boolean, 기본 true), started_at, finished_at | 소속 자료·리포트 소유자 읽기만. 쓰기는 서비스 키 서버·Worker만 | 상태값은 JOBS.md(`queued`·`running`·`succeeded`·`failed`·`cancelled`). `retryable`은 `fail_job`이 최종 실패 때 저장하고, 재시도 자격은 error_code 목록이 아니라 이 값으로 판단한다(7장). 사용자 재시도 = 새 작업(새 멱등 키), 종료 작업은 되살리지 않음. 같은 자료에 진행 중 작업 1개(부분 유니크). `source_id`·`report_id` 중 하나는 필수(CHECK). 멱등 키는 `idempotency_keys`에 둔다. Worker는 heartbeat_at을 갱신하고, locked_until이 지난 running 작업은 회수(재큐잉)한다. 작업 행 생성과 pgmq 전송은 한 트랜잭션 RPC `enqueue_job`. 사용자 화면 배지(`sources.status`)와의 매핑은 6장 |
| conversations | 프로젝트 안 대화(S-08) | id, project_id, user_id★, title | 본인 행만 | 삭제 시 하위 messages 연쇄 삭제 |
| messages | 질문·답변(S-08) | id, conversation_id, role, content★, citation_metadata(jsonb: chunk_id 목록·점수만) | 소속 대화 소유자만(conversations 조인). 쓰기는 서버만 | 인용은 서버가 검색 결과로 검증한 chunk_id만([02-rag-and-job-flow §4](diagrams/02-rag-and-job-flow.md)). 청크 텍스트 사본을 넣지 않는다. 응답의 source_id·title·locator는 chunk 조인으로 생성한다. 질문 중복 방지는 `idempotency_keys`. 원문은 로그에 남기지 않는다 |
| reports | 생성된 리포트(S-11·12) | id, project_id, user_id★, title, content★, format(`markdown`), status(`generating`·`ready`·`failed`) | `user_id = auth.uid()` 행만. 쓰기는 서버만 | 본문 내 출처 위치는 report_citations가 정본 |
| report_citations | 리포트 문장 ↔ 근거 청크 정규화(S-12) | id, report_id, chunk_id(삭제 시 null), position | 소속 리포트 소유자만(reports 조인). 쓰기는 서버만 | 끊어진 출처(chunk_id null)는 화면에서 "원문 삭제됨" 표시. 위치는 chunk의 locator를 조회 시 읽는다(사본 없음) |
| usage_events | AI 호출 사용량 기록(S-13) | id, user_id★, project_id, event_type, provider, model, input_tokens, output_tokens, estimated_cost | 본인 행 조회만. 쓰기는 서버만 | 토큰·비용은 공급자가 주는 범위에서만(nullable). 불완전하면 확정값처럼 표시하지 않음 |
| plans | 요금제별 한도 정의(S-13) | code(PK, MVP는 `beta` 1종), max_projects, max_sources_per_project, monthly_questions, monthly_reports, monthly_source_jobs, max_video_seconds, monthly_video_seconds | 로그인 사용자 읽기 전용(시드 데이터) | 한도 5종(프로젝트·자료·질문·리포트·자료 처리) + 영상 시간 2종(영상당·월, 제안값 [검토 5장](youtube-mvp-review.md#5-처리-설계)). 수치는 [PRD 8-1](01_PRD.md#8-1-베타-초기값-2026-11-02-확정-조정-가능) 시드. 결제 연동은 MVP 제외 |
| user_quotas | 사용자별 월 사용 누적(S-13) | user_id(PK), plan_code→plans, period_start(KST 월 시작), used_questions, used_reports, used_source_jobs, used_video_seconds(각 CHECK ≥ 0) — 프로젝트 수·프로젝트당 자료 수는 카운터 없이 생성 RPC가 부모 행을 잠그고 셈 | 본인 행 조회만. 갱신은 RPC만 | 원자 차감 RPC `consume_quota(kind, n)`: 조건부 UPDATE … RETURNING으로 한도 확인·증가를 한 문장에서 처리(경쟁 조건 방지). 기간 초기화는 5장 |
| idempotency_keys | 중복 요청 방지(A-04·05·06·08) | user_id, key, request_hash, resource_type, resource_id, created_at | 직접 접근 없음. RPC 안에서만 | unique (user_id, key). 같은 키+다른 request_hash는 409. 업로드는 파일마다 키 |

## 2. 공통 RLS 원칙
| 원칙 | 규칙 |
|---|---|
| 기본 | 모든 테이블 RLS 켠다. 소유자는 `auth.uid()`로만 판정하고 JWT 클레임·요청 본문의 user_id는 믿지 않는다 |
| 쓰기 | `authenticated` 롤은 모든 테이블 INSERT·UPDATE·DELETE 권한을 회수한다. 쓰기는 SECURITY DEFINER RPC(`auth.uid()` 검사·한도 검사 포함)로만. Worker만 service_role. 서비스 키는 클라이언트·로그에 노출 금지([ACCESS.md](blueprints/contracts/ACCESS.md), 키 사용 표 [02#2](02_ARCHITECTURE.md)) |
| 검색 함수 | 웹 `match_chunks(project_id, …)`는 사용자 권한, Worker `match_chunks_for_job(job_id)`는 작업 행의 user_id·project_id로 범위 강제. 둘 다 `deleted_at` 있는 프로젝트·자료와 `unavailable_at` 있는 자료 제외 |
| Storage | 경로 첫 폴더 = `user_id`, 읽기는 서명 URL만(자세한 경로 규칙은 `02_ARCHITECTURE.md#2`) |
| 검증 | RLS 위반 테스트(타인 행 접근 실패)를 CI 필수 게이트로 둔다(제안) |

## 3. 매체 확장 대비 (결정)
| 항목 | MVP | 이후(예약) | 규칙 |
|---|---|---|---|
| sources.source_type | `pdf`, `url`, `youtube`(CHECK 추가는 법무 확인 후, 8장) | `audio`, `video`, `docx`, `pptx`, `image`, `text` | MVP는 CHECK에 MVP 값만 허용하고, 새 매체는 마이그레이션으로 값을 추가한다 |
| 장면 캡처 | L0 장면 카드(이미지 없음, `source_moments`) | L1 사용자 승인 탭 캡처(법무 확인 후) · L2 업로드 영상 키프레임(이후) | 등급 정의는 [검토 4장](youtube-mvp-review.md#4-중요-장면-캡처). 저장은 8장 |
| source_chunks.locator | `{"page": n, "char_start": a, "char_end": b}` (page는 확보된 경우만), 시각 `{"t_start": s, "t_end": s}`(youtube) | 슬라이드 `{"slide": n}`, 영역 `{"page": n, "bbox": [x,y,w,h]}` | 키 집합은 source_type이 정한다. 없는 위치는 비우고 임의 생성 금지. 기존 ERD의 `page_number`·`location_metadata`를 이 컬럼 하나로 합친다(ERD 갱신 요청, 보고 참조) |
| 처리 단계 | 4장 pdf·url | 4장 나머지 | 단계 이름은 `processing_jobs.current_step`에 기록. 매체가 늘어도 테이블은 늘지 않는다 |

## 4. 매체별 파이프라인 단계
공통 후행 단계: 정규화 → 청킹 → 임베딩(`embedding_model` 기록) → 벡터·전문검색 색인 → 요약. 흐름 그림은 [`02-rag-and-job-flow §1`](diagrams/02-rag-and-job-flow.md).
| 매체 | 선행 단계(`current_step`) | 상태 | locator 키 |
|---|---|---|---|
| pdf | validate → extract_text | MVP. 스캔 PDF(OCR 필요)는 미지원 안내(제안) | page, char_start, char_end |
| url | validate(SSRF·리디렉션 검사) → fetch → extract_text | MVP. 가져온 텍스트는 신뢰하지 않는 데이터로 취급 | char_start, char_end |
| image·스캔 PDF | validate → ocr | 이후. 참조: [`blueprints/ocr-docs`](blueprints/ocr-docs/data.md) | page, bbox |
| youtube | analyze_video → verify_timestamps → save_moments | MVP(법무 확인 후 착수). URL 검증·`videos.list`는 A-04가 동기 처리. Gemini는 전사 구간·장면 후보만 출력하고, 공통 요약 단계가 저장된 청크로 별도 생성·인용 검증. 재시도·분할 규칙은 [검토 5장](youtube-mvp-review.md#5-처리-설계) | t_start, t_end |
| audio·video | validate → (추출) → transcribe | 이후. 참조: [`blueprints/stt-voice`](blueprints/stt-voice/data.md) | t_start, t_end |
| docx·pptx·text | validate → extract_text | 이후 | char_start, char_end, slide |

## 5. 결정 사항 (ADR-0002)
| 항목 | 상태 |
|---|---|
| embedding 차원·모델 | 잠정 bge-m3 1024차원, 골든셋·라이선스 확인 후 확정([ADR-0002](adr/0002-mvp-tech-decisions.md)). vector 차원 컬럼은 확정 후 별도 마이그레이션(ADR-0004) |
| 삭제 정책 | 결정: 소프트 삭제(deleted_at) → 30일 뒤 영구 삭제, 순서 청크·벡터 → Storage 원본 → 행 |
| status 매핑 | 확정 — 아래 6장 |
| 한국어 키워드 검색 | 결정: pg_trgm으로 시작, 골든셋 미달 시 재검토 |
| 쿼터 기간 초기화 | 결정: 월 단위, 요청 시 지연 계산 |
| plans 한도 수치 | 베타 초기값 [PRD 8-1](01_PRD.md#8-1-베타-초기값-2026-11-02-확정-조정-가능) |
| 유튜브 전사 저장·재제공 | **미확인**(법무 확인 필요, [검토 2장](youtube-mvp-review.md#2-안-a-gemini-url-입력의-약관-판단)). 불가 판정 시 전사 청크·임베딩 파기 |
| 영상 요약 저장 위치 | **팀장 결정 필요**. 시각 인용이 붙는 영상 단위 요약(PRD S6)을 담을 곳이 없다. `projects.summary`는 프로젝트 단위 |

## 6. 상태 매핑 (확정)
| processing_jobs.status | sources.status |
|---|---|
| queued | queued |
| running | processing |
| succeeded | completed |
| failed · cancelled | failed |

`job_type = source_recheck`는 이 매핑에서 제외한다(`sources.status` 불변, 8장).

## 7. 쓰기 RPC 규칙 (task-004 challenger 반영, 확정)
| 규칙 | 내용 |
|---|---|
| 권한 | `REVOKE ALL ON ALL TABLES/SEQUENCES/FUNCTIONS ... FROM PUBLIC, anon, authenticated` + DEFAULT PRIVILEGES 회수 후 필요한 SELECT만 GRANT. `idempotency_keys`·`source_chunks`는 SELECT도 없음 |
| 함수 | SECURITY DEFINER, `SET search_path = ''`, 첫 줄 `auth.uid()` null이면 예외, 모든 id·경로의 소유자 검증. anon EXECUTE 0개, authenticated EXECUTE는 허용 목록과 일치(게이트 테스트) |
| 쿼터 | `consume_quota`는 내부 함수(authenticated EXECUTE 없음). 자원 생성 RPC 안에서 같은 트랜잭션으로 차감. 환불은 service_role만. 월 경계는 Asia/Seoul. 행이 없으면 예외(가입 트리거가 생성) |
| 멱등 키 | 생성 RPC 안에서 `INSERT ... ON CONFLICT DO NOTHING` 후 재조회, 키·자원·차감이 한 트랜잭션 |
| 소프트 삭제 | SELECT 정책에 `deleted_at is null`과 부모 프로젝트 미삭제 조건 |
| 작성 주체 | 기반(테이블·권한·게이트·consume_quota·멱등 키·enqueue_job·가입 트리거·프로필 수정)은 task-004, 기능 쓰기 RPC는 각 기능 작업이 새 마이그레이션 + `packages/db-tests` 음성 테스트(타인 id·타인 경로·anon 거부)로 추가 |
| `retry_source`(A-05) | 자격: 자료가 `failed`이고 진행 중 작업 없음(KF409), completed는 22023, 가장 최근 작업이 `retryable=false`면 KF422. 같은 멱등 키 재요청은 자격 검사 없이 기존 작업 반환. 한도(KF429, message로 구분): `retry_limit_exceeded` 자료당 작업 6개(최초 1 + 재시도 5) · `retry_rate_limited` 사용자 분당 한도([PRD 8-1](01_PRD.md#8-1-베타-초기값-2026-11-02-확정-조정-가능), 카운터 `auth_rate_limits` scope `source_retry`, 같은 트랜잭션이라 거부되어 롤백된 요청은 세지 않음) · `quota_exceeded` 월 쿼터. 뒤 둘은 DETAIL에 대기 초 |
| `list_project_jobs`(A-05, 읽기) | SECURITY INVOKER(RLS로 본인 행만), authenticated만 EXECUTE. 프로젝트의 자료·리포트 작업을 `(created_at desc, id desc)` 커서로 반환. `p_limit` 1~101, 다음 쪽 판단은 호출자가 limit + 1로 한다. 프로젝트가 보이지 않으면 빈 목록이 아니라 P0002 |

## 8. 유튜브 자료 규칙 ([ADR-0006](adr/0006-youtube-summary-and-capture-mvp.md))
처리·판정 규칙의 정본은 [검토 5장](youtube-mvp-review.md#5-처리-설계). 여기는 스키마 결정만 쓴다.
| 항목 | 규칙 |
|---|---|
| 착수 게이트 | 법무 확인 전에는 `sources` CHECK·등록 RPC의 `youtube` 분기를 넣지 않는다. 넣을 때는 새 마이그레이션 파일로 한다 |
| 컬럼 | `source_type='youtube'`이면 `original_url`·`video_id` 필수, `storage_path`·`content_hash`는 null(CHECK). `title`·`channel_title`·`duration_seconds`는 `videos.list` 값. 다른 유형은 유튜브 컬럼 null |
| 중복 | (project_id, video_id) 부분 유니크(`video_id` not null, `deleted_at` null) |
| 재확인 | Worker 일일 스윕이 `metadata_checked_at`이 30일 지난 영상마다 `source_recheck` 작업 1건을 만든다(`source_id` 필수 CHECK 유지). 사용자 쿼터 미차감 |
| 비활성 | `unavailable_at`은 `sources.status`·`deleted_at`과 별개다. 설정 즉시 검색·인용 제외. 소프트 삭제 30일 유예와 합치지 않는다. `title` NOT NULL과 API 데이터 30일 내 파기의 충돌 처리는 **팀장 결정 필요** |
| 장면 카드 인용 | `source_moments`와 구간이 겹치는 청크가 있어야 리포트에 넣는다. `report_citations.chunk_id`에는 그 청크를 쓰고 카드 사본은 넣지 않는다 |
| 캡처 저장 | L0는 이미지를 저장하지 않는다. L1은 법무 확인 후 새 마이그레이션으로 `source_moments`에 Storage 경로를 추가한다(경로·서명 URL 규칙은 2장, 초기값은 [검토 4장](youtube-mvp-review.md#4-중요-장면-캡처)). L2는 이후 |
