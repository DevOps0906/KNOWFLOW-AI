// 허용 목록. 기능 작업이 새 RPC/테이블을 추가할 때 이 파일을 함께 고치고 리뷰를 받는다(게이트의 요점).

/** authenticated가 EXECUTE 할 수 있는 public 함수 */
export const AUTHENTICATED_EXECUTE = ["update_profile"];

/** service_role(Worker)이 EXECUTE 할 수 있는 public 함수 */
export const SERVICE_ROLE_EXECUTE = ["refund_quota"];

/** authenticated가 SELECT 할 수 있는 public 테이블 (source_chunks·idempotency_keys는 없음) */
export const AUTHENTICATED_SELECT = [
  "conversations",
  "messages",
  "plans",
  "processing_jobs",
  "profiles",
  "projects",
  "report_citations",
  "reports",
  "sources",
  "usage_events",
  "user_quotas",
];

export const ALL_TABLES = [
  "conversations",
  "idempotency_keys",
  "messages",
  "plans",
  "processing_jobs",
  "profiles",
  "projects",
  "report_citations",
  "reports",
  "source_chunks",
  "sources",
  "usage_events",
  "user_quotas",
];
