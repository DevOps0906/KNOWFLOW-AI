# 05 데이터 모델 — KNOWFLOW-AI

> **조건부**: `00_LEAN.md` 린 검증 통과 전 초안이다. 통과 전에는 마이그레이션·정식 개발을 시작하지 않는다.
> 테이블 정본 구조: [`diagrams/03-data-model-erd.md`](diagrams/03-data-model-erd.md)(v1.1 제안). 코드가 생기면 `sql2erd supabase/migrations -o docs/diagrams/erd.mmd`로 ERD를 다시 생성한다(손으로 그리지 않음). 여기서는 그림의 사실을 복사하지 않고 컬럼 결정·RLS만 쓴다.
> 채택 패턴: 작업 계약 [`blueprints/contracts/JOBS.md`](blueprints/contracts/JOBS.md), 서비스 키 [`blueprints/contracts/ACCESS.md`](blueprints/contracts/ACCESS.md), 출처 비복사 원칙 [`blueprints/rag-chat/data.md`](blueprints/rag-chat/data.md). **조직·역할·다중 테넌트는 MVP 제외** — 소유 단위는 `user_id` 한 사람이다.
> 표기: ★ 개인정보 가능 컬럼. 공통 컬럼 `created_at`·`updated_at`은 표에서 생략(ERD 참조).

## 1. 테이블
| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
| profiles | 앱 프로필(S-02·03·13) | id(PK = `auth.users.id`), display_name★ | 본인 행만 읽기·수정. 생성은 가입 트리거 | 로그인·세션은 Supabase Auth 관리(표에 넣지 않음). 계정 삭제 요청 시 하위 데이터 연쇄 삭제(순서 미정, 5장) |
| projects | 자료·대화·리포트의 묶음(S-05~08) | id, user_id★→profiles, name, description, archived_at | `user_id = auth.uid()` 행만 모든 작업 | 클라이언트가 준 user_id는 무시하고 서버가 채운다. 삭제 정책은 5장 |
| sources | 자료 1건(S-08·09·10) | id, project_id, user_id, source_type, title★, original_url, storage_path, content_hash, status, error_code, error_message_safe | `user_id = auth.uid()` AND 소속 프로젝트 소유 일치. 상태 쓰기는 서버만 | source_type: MVP `pdf`·`url`, 예약 `youtube`·`audio`·`video`·`docx`·`pptx`·`image`·`text`(3장). status는 `queued`·`processing`·`completed`·`failed`. unique (project_id, content_hash) |
| source_chunks | 검색 단위 조각(S-08 질의, S-10 뷰어) | id, source_id, project_id, chunk_index, content★, locator(jsonb), embedding(vector), embedding_model, content_tsv | 사용자 직접 SELECT 없음. 서버·검색 함수가 `project_id`+`user_id` 강제 후 반환(소속 자료가 본인 것일 때만) | 인용 위치는 `locator` jsonb(3장). 임베딩 차원은 모델 확정 후(미확정, 5장). unique (source_id, chunk_index). 모델이 다른 청크를 섞지 않는다 |
| processing_jobs | 자료 처리 작업·이력(S-06·08·09) | id, source_id(nullable), report_id(nullable)→reports, job_type(`report_generate` 포함), status, current_step, progress(0~100), attempt_count, max_attempts(기본 3), idempotency_key, error_code, started_at, finished_at | 소속 자료·리포트 소유자 읽기만. 쓰기는 서비스 키 서버·Worker만 | 상태값은 JOBS.md(`queued`·`running`·`succeeded`·`failed`·`cancelled`). 사용자 재시도 = 새 작업(새 멱등 키), 종료 작업은 되살리지 않음. 같은 자료에 진행 중 작업 1개(부분 유니크). `source_id`·`report_id` 중 하나는 필수(CHECK). 리포트 생성 작업의 멱등 키도 여기 저장. 사용자 화면 배지(`sources.status`)와의 매핑은 6장 |
| conversations | 프로젝트 안 대화(S-08) | id, project_id, user_id★, title | 본인 행만 | 삭제 시 하위 messages 연쇄 삭제 |
| messages | 질문·답변(S-08) | id, conversation_id, role, content★, citation_metadata(jsonb: chunk_id 목록·점수만), idempotency_key | 소속 대화 소유자만(conversations 조인). 쓰기는 서버만 | 인용은 서버가 검색 결과로 검증한 chunk_id만([02-rag-and-job-flow §4](diagrams/02-rag-and-job-flow.md)). 청크 텍스트 사본을 넣지 않는다. 응답의 source_id·title·locator는 chunk 조인으로 생성한다. `idempotency_key`는 user 범위 유니크(질문 중복 방지). 원문은 로그에 남기지 않는다 |
| reports | 생성된 리포트(S-11·12) | id, project_id, user_id★, title, content★, format(`markdown`), status(`generating`·`ready`·`failed`) | `user_id = auth.uid()` 행만. 쓰기는 서버만 | 본문 내 출처 위치는 report_citations가 정본 |
| report_citations | 리포트 문장 ↔ 근거 청크 정규화(S-12) | id, report_id, chunk_id(삭제 시 null), position | 소속 리포트 소유자만(reports 조인). 쓰기는 서버만 | 끊어진 출처(chunk_id null)는 화면에서 "원문 삭제됨" 표시. 위치는 chunk의 locator를 조회 시 읽는다(사본 없음) |
| usage_events | AI 호출 사용량 기록(S-13) | id, user_id★, project_id, event_type, provider, model, input_tokens, output_tokens, estimated_cost | 본인 행 조회만. 쓰기는 서버만 | 토큰·비용은 공급자가 주는 범위에서만(nullable). 불완전하면 확정값처럼 표시하지 않음 |
| plans | 요금제별 한도 정의(S-13) | code(PK `free`·`pro`), max_sources, monthly_questions | 로그인 사용자 읽기 전용(시드 데이터) | 한도 수치는 미확인 — `01_PRD.md`에서 결정 후 시드. 결제 연동은 MVP 제외 |
| user_quotas | 사용자별 사용 한도·누적(S-13) | user_id(PK), plan_code→plans, period_start, used_questions, used_sources | 본인 행 조회만. 갱신은 서버만 | 한도 확인·증가는 한 트랜잭션(경쟁 조건 방지). 기간 초기화 방식은 5장 |

## 2. 공통 RLS 원칙
| 원칙 | 규칙 |
|---|---|
| 기본 | 모든 테이블 RLS 켠다. 소유자는 `auth.uid()`로만 판정하고 JWT 클레임·요청 본문의 user_id는 믿지 않는다 |
| 쓰기 | 상태 전이·검증된 인용·사용량·쿼터는 서비스 키를 쓰는 서버·Worker만. 서비스 키는 클라이언트·로그에 노출 금지([ACCESS.md](blueprints/contracts/ACCESS.md)) |
| 검색 함수 | 벡터·전문검색 함수는 `project_id`와 `user_id`를 함수 안에서 강제한다 |
| Storage | 경로 첫 폴더 = `user_id`, 읽기는 서명 URL만(자세한 경로 규칙은 `02_ARCHITECTURE.md#2`) |
| 검증 | RLS 위반 테스트(타인 행 접근 실패)를 CI 필수 게이트로 둔다(제안) |

## 3. 매체 확장 대비 (결정)
| 항목 | MVP | 이후(예약) | 규칙 |
|---|---|---|---|
| sources.source_type | `pdf`, `url` | `youtube`, `audio`, `video`, `docx`, `pptx`, `image`, `text` | MVP는 CHECK에 MVP 값만 허용하고, 새 매체는 마이그레이션으로 값을 추가한다 |
| source_chunks.locator | `{"page": n, "char_start": a, "char_end": b}` (page는 확보된 경우만) | 시각 `{"t_start": s, "t_end": s}`, 슬라이드 `{"slide": n}`, 영역 `{"page": n, "bbox": [x,y,w,h]}` | 키 집합은 source_type이 정한다. 없는 위치는 비우고 임의 생성 금지. 기존 ERD의 `page_number`·`location_metadata`를 이 컬럼 하나로 합친다(ERD 갱신 요청, 보고 참조) |
| 처리 단계 | 4장 pdf·url | 4장 나머지 | 단계 이름은 `processing_jobs.current_step`에 기록. 매체가 늘어도 테이블은 늘지 않는다 |

## 4. 매체별 파이프라인 단계
공통 후행 단계: 정규화 → 청킹 → 임베딩(`embedding_model` 기록) → 벡터·전문검색 색인 → 요약. 흐름 그림은 [`02-rag-and-job-flow §1`](diagrams/02-rag-and-job-flow.md).
| 매체 | 선행 단계(`current_step`) | 상태 | locator 키 |
|---|---|---|---|
| pdf | validate → extract_text | MVP. 스캔 PDF(OCR 필요)는 미지원 안내(제안) | page, char_start, char_end |
| url | validate(SSRF·리디렉션 검사) → fetch → extract_text | MVP. 가져온 텍스트는 신뢰하지 않는 데이터로 취급 | char_start, char_end |
| image·스캔 PDF | validate → ocr | 이후. 참조: [`blueprints/ocr-docs`](blueprints/ocr-docs/data.md) | page, bbox |
| audio·video·youtube | validate → (추출) → transcribe | 이후. 참조: [`blueprints/stt-voice`](blueprints/stt-voice/data.md) | t_start, t_end |
| docx·pptx·text | validate → extract_text | 이후 | char_start, char_end, slide |

## 5. 미정·팀장 결정 필요
| 항목 | 상태 |
|---|---|
| embedding 차원·모델 | 모델 확정 후 마이그레이션에 반영. 청사진 참고값 1024(bge-m3)는 **미확인**(라이선스·한국어 품질 검증 필요) |
| 삭제 정책 | soft delete 여부, 벡터·Storage 연쇄 삭제 순서: **팀장 결정 필요** |
| status 매핑 | 확정 — 아래 6장 |
| tsvector 언어 설정 | 한국어 형태소 처리 여부는 검색 품질 실험 후 결정(**미확인**) |
| 쿼터 기간 초기화 | 월 단위 리셋 방식(요청 시 지연 계산 vs 예약 작업): 미정 |
| plans 한도 수치 | **미확인** — 근거 필요(비용 계산 후 PRD에서 결정) |

## 6. 상태 매핑 (확정)
| processing_jobs.status | sources.status |
|---|---|
| queued | queued |
| running | processing |
| succeeded | completed |
| failed · cancelled | failed |
