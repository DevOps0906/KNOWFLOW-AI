# 03. 데이터 모델 (ERD)

기준: 개발 기준 문서 v1.0 15~16장. v1.1 제안으로 추가·변경한 항목은 2장 표에 따로 정리했다.

## 1. ERD

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "1명 1프로필"
  PROFILES ||--o{ PROJECTS : "소유"
  PROFILES ||--o{ PROCESSING_JOBS : "작업 소유"
  PROFILES ||--o{ IDEMPOTENCY_KEYS : "멱등 키"
  PROFILES ||--o{ USAGE_EVENTS : "사용량"
  PROFILES ||--o| USER_QUOTAS : "적용"
  PLANS ||--o{ USER_QUOTAS : "한도 정의"
  PROJECTS ||--o{ SOURCES : "포함"
  SOURCES ||--o{ SOURCE_CHUNKS : "분할"
  SOURCES ||--o{ PROCESSING_JOBS : "처리 이력"
  PROJECTS ||--o{ CONVERSATIONS : "대화"
  CONVERSATIONS ||--o{ MESSAGES : "메시지"
  PROJECTS ||--o{ REPORTS : "리포트"
  REPORTS ||--o{ REPORT_CITATIONS : "근거"
  REPORTS ||--o{ PROCESSING_JOBS : "생성 작업"
  SOURCE_CHUNKS ||--o{ REPORT_CITATIONS : "인용됨"

  PROFILES {
    uuid id PK "Auth 사용자 ID"
    text display_name
    timestamptz created_at
    timestamptz updated_at
  }

  PROJECTS {
    uuid id PK
    uuid user_id FK
    text name
    text description
    text summary "자료 completed 시 Worker 생성"
    jsonb suggested_questions "자료 completed 시 Worker 생성"
    timestamptz created_at
    timestamptz updated_at
    timestamptz archived_at
    timestamptz deleted_at "소프트 삭제"
  }

  SOURCES {
    uuid id PK
    uuid project_id FK
    uuid user_id FK
    text source_type "MVP pdf url (예약 값은 05 3장)"
    text title
    text original_url
    text storage_path
    text content_hash "v1.1 중복 방지"
    text status "queued processing completed failed"
    text error_code
    text error_message_safe
    timestamptz deleted_at "소프트 삭제"
    timestamptz created_at
    timestamptz updated_at
  }

  SOURCE_CHUNKS {
    uuid id PK
    uuid source_id FK
    uuid project_id FK
    int chunk_index
    text content
    jsonb locator "page char_start char_end 등 source_type별 키, 확보된 경우만"
    vector embedding "차원은 모델 확정 후"
    text embedding_model "v1.1 모델 교체 대비"
    tsvector content_tsv "v1.1 전문검색"
    timestamptz created_at
  }

  CONVERSATIONS {
    uuid id PK
    uuid project_id FK
    uuid user_id FK
    text title
    timestamptz created_at
    timestamptz updated_at
  }

  MESSAGES {
    uuid id PK
    uuid conversation_id FK
    text role
    text content
    jsonb citation_metadata "chunk_id 목록·점수만"
    timestamptz created_at
  }

  REPORTS {
    uuid id PK
    uuid project_id FK
    uuid user_id FK
    text title
    text content
    text format "markdown"
    text status "v1.1 generating ready failed"
    timestamptz created_at
    timestamptz updated_at
  }

  REPORT_CITATIONS {
    uuid id PK "v1.1 신규"
    uuid report_id FK
    uuid chunk_id FK "청크 삭제 시 null"
    int position "본문 내 위치"
  }

  PROCESSING_JOBS {
    uuid id PK
    uuid user_id FK "v1.1 소유자 범위"
    uuid source_id FK "nullable, source_id 또는 report_id 필수"
    uuid report_id FK "v1.1 nullable"
    text job_type "report_generate 포함"
    text status "queued running succeeded failed cancelled"
    text current_step "validate, extract_text 등"
    int progress "0~100"
    int attempt_count
    int max_attempts "기본 3"
    timestamptz locked_until "v1.1 회수 기준"
    timestamptz heartbeat_at "v1.1 Worker 생존 신호"
    text error_code
    timestamptz started_at
    timestamptz finished_at
    timestamptz created_at
  }

  IDEMPOTENCY_KEYS {
    uuid user_id FK "user_id + key 유니크"
    text key "Idempotency-Key 헤더 값"
    text request_hash "같은 키 다른 입력은 409"
    text resource_type "v1.1 신규"
    uuid resource_id "생성된 자원 id"
    timestamptz created_at
  }

  USAGE_EVENTS {
    uuid id PK
    uuid user_id FK
    uuid project_id FK
    text event_type
    text provider
    text model
    int input_tokens "nullable"
    int output_tokens "nullable"
    numeric estimated_cost "nullable"
    timestamptz created_at
  }

  PLANS {
    text code PK "v1.1 신규 free pro"
    int max_projects
    int max_sources_per_project
    int monthly_questions
    int monthly_reports
    int monthly_source_jobs
  }

  USER_QUOTAS {
    uuid user_id PK "v1.1 신규"
    text plan_code FK
    timestamptz period_start
    int used_projects
    int used_sources
    int used_questions
    int used_reports
    int used_source_jobs
  }
```

## 2. v1.0 대비 변경 (v1.1 제안)

| 구분 | 대상 | 변경 | 이유 |
|---|---|---|---|
| 신규 테이블 | report_citations | 리포트와 청크를 정규화해 연결 | v1.0은 출처를 content 안 메타데이터로만 저장해 끊어진 출처를 검사하기 어렵다 |
| 신규 테이블 | plans, user_quotas | 사용자별 한도 5종(max_projects, max_sources_per_project, monthly_questions, monthly_reports, monthly_source_jobs)과 사용량 5종(used_projects, used_sources, used_questions, used_reports, used_source_jobs) | 비용 통제, 무료 한도 초과 시 안내 화면 (05 1장) |
| 신규 테이블 | idempotency_keys | user_id + key 유니크, request_hash 비교. 멱등 키를 이 한곳에 둔다 | 중복 요청 방지 (04 공통 규칙, 05 1장) |
| 컬럼 추가 | projects | summary, suggested_questions(jsonb), deleted_at | 요약·추천 질문 표시(A-03), 소프트 삭제 (05 1·5장) |
| 컬럼 추가 | sources.deleted_at | 소프트 삭제 후 30일 뒤 영구 삭제 | 삭제 정책 (05 5장) |
| 컬럼 추가 | sources.content_hash | 같은 자료 중복 업로드 방지 | 중복 비용 방지 |
| 컬럼 추가 | source_chunks.embedding_model | 모델 교체 시 재색인 대상 식별 | 임베딩 모델 미정 |
| 컬럼 추가 | source_chunks.content_tsv | 전문검색 색인 | 하이브리드 검색 |
| 컬럼 변경 | sources.source_type, source_chunks.locator | source_type MVP 값을 pdf·url로 한정(나머지는 예약). page_number·location_metadata를 jsonb locator 하나로 합침 | 매체 확장 대비, 위치 키는 source_type이 정함 (05 3장) |
| 컬럼 추가 | processing_jobs | user_id, current_step, progress, max_attempts, locked_until, heartbeat_at 추가 | 소유자 범위, 단계 표시, 재시도 상한, Worker 생존 확인과 작업 회수 (05 1장·JOBS.md) |
| 컬럼 제거 | processing_jobs.idempotency_key, messages.idempotency_key | 멱등 키는 idempotency_keys로 일원화 | 04 공통 규칙, 05 1장 |
| 정책 확정 | 삭제 | 소프트 삭제(deleted_at) 후 30일 뒤 영구 삭제, 순서는 청크·벡터 → Storage 원본 → 행 | 사용자 데이터 삭제 정책 (05 5장) |

## 3. RLS 원칙

| 대상 | 규칙 |
|---|---|
| 모든 업무 테이블 | user_id가 현재 사용자인 행만 접근. 클라이언트가 준 user_id는 신뢰하지 않는다 |
| source_chunks | 소속 자료가 현재 사용자의 자료일 때만 조회 |
| 벡터 검색 함수 | project_id와 user_id를 함수 안에서 강제 (제안) |
| Storage 경로 | 사용자·프로젝트 단위 경로 정책 |
| usage_events, user_quotas | 사용자는 본인 행 조회만. 쓰기는 서버 |
| RLS 위반 테스트 | CI 필수 게이트 (제안) |

## 4. 미정

| 항목 | 상태 |
|---|---|
| embedding 차원 | 임베딩 모델 확정 후 마이그레이션에 반영 |
| tsvector 언어 설정 | 한국어 형태소 처리 여부는 검색 품질 실험 후 결정 (미확인) |
| usage 비용 필드 | 공급자가 제공하는 범위에서만 채운다. 불완전하면 확정값처럼 표시하지 않는다 |
