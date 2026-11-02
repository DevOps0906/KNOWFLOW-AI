# 03. 데이터 모델 (ERD)

기준: 개발 기준 문서 v1.0 15~16장. v1.1 제안으로 추가·변경한 항목은 2장 표에 따로 정리했다.

## 1. ERD

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "1명 1프로필"
  PROFILES ||--o{ PROJECTS : "소유"
  PROJECTS ||--o{ SOURCES : "포함"
  SOURCES ||--o{ SOURCE_CHUNKS : "분할"
  SOURCES ||--o{ PROCESSING_JOBS : "처리 이력"
  PROJECTS ||--o{ CONVERSATIONS : "대화"
  CONVERSATIONS ||--o{ MESSAGES : "메시지"
  PROJECTS ||--o{ REPORTS : "리포트"
  REPORTS ||--o{ REPORT_CITATIONS : "근거"
  REPORTS ||--o{ PROCESSING_JOBS : "생성 작업"
  SOURCE_CHUNKS ||--o{ REPORT_CITATIONS : "인용됨"
  PROFILES ||--o{ USAGE_EVENTS : "사용량"
  PLANS ||--o{ USER_QUOTAS : "한도 정의"
  PROFILES ||--o| USER_QUOTAS : "적용"

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
    timestamptz created_at
    timestamptz updated_at
    timestamptz archived_at
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
    jsonb citation_metadata
    text idempotency_key "v1.1 user 범위 유니크"
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
    uuid chunk_id FK
    int position "본문 내 위치"
  }

  PROCESSING_JOBS {
    uuid id PK
    uuid source_id FK "nullable, source_id 또는 report_id 필수"
    uuid report_id FK "v1.1 nullable"
    text job_type "report_generate 포함"
    text status
    text current_step "validate, extract_text 등"
    int progress "0~100"
    int attempt_count
    int max_attempts "기본 3"
    text idempotency_key "재시도마다 새 키"
    text error_code
    timestamptz started_at
    timestamptz finished_at
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
    int max_sources
    int monthly_questions
  }

  USER_QUOTAS {
    uuid user_id PK "v1.1 신규"
    text plan_code FK
    timestamptz period_start
    int used_questions
    int used_sources
  }
```

## 2. v1.0 대비 변경 (v1.1 제안)

| 구분 | 대상 | 변경 | 이유 |
|---|---|---|---|
| 신규 테이블 | report_citations | 리포트와 청크를 정규화해 연결 | v1.0은 출처를 content 안 메타데이터로만 저장해 끊어진 출처를 검사하기 어렵다 |
| 신규 테이블 | plans, user_quotas | 사용자별 한도 | 비용 통제, 무료 한도 초과 시 안내 화면 |
| 컬럼 추가 | sources.content_hash | 같은 자료 중복 업로드 방지 | 중복 비용 방지 |
| 컬럼 추가 | source_chunks.embedding_model | 모델 교체 시 재색인 대상 식별 | 임베딩 모델 미정 |
| 컬럼 추가 | source_chunks.content_tsv | 전문검색 색인 | 하이브리드 검색 |
| 컬럼 변경 | sources.source_type, source_chunks.locator | source_type MVP 값을 pdf·url로 한정(나머지는 예약). page_number·location_metadata를 jsonb locator 하나로 합침 | 매체 확장 대비, 위치 키는 source_type이 정함 (05 3장) |
| 컬럼 추가 | processing_jobs | current_step·progress·max_attempts·idempotency_key 추가 | 단계 표시, 재시도 상한, 중복 실행 방지 (05 1장·JOBS.md) |
| 정책 확정 필요 | 삭제 | soft delete 여부, 벡터·Storage 연쇄 삭제 순서 | 사용자 데이터 삭제 정책 (19장) |

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
