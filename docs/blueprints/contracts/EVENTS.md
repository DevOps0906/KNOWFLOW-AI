# EVENTS — 이벤트 봉투·전달 계약 (정본)

모든 모듈이 발행·구독하는 이벤트의 봉투와 전달 규칙. 봉투·payload에 **연락처 원문(이메일·전화)을 넣지 않는다** — 필요하면 해시 + 조회 키(user id 등)만.

## 봉투 (모든 이벤트 공통, 필드 고정)
| 필드 | 형식 | 설명 |
|---|---|---|
| event_id | uuid | 이벤트 고유 id. 받는 쪽 멱등 키(`inbox.event_id` unique) |
| type | text | `domain.object.verb` |
| version | int | 봉투·payload 버전(현재 1) |
| occurred_at | timestamptz | 발생 시각(ISO 8601, UTC) |
| org_id | uuid | 조직(예: 구매 조직) |
| actor_id | text | 행위자 id(사용자 id·서비스 키 id). system이면 null 허용 |
| actor_type | text | `user` · `system` · `service` |
| result | text | `성공` · `실패` — 이벤트를 일으킨 행위의 결과 |
| aggregate_type | text | 집계 종류(예: `payment_order` · `subscription`) |
| aggregate_id | text | 집계 id |
| sequence | bigint | **집계별 단조 증가**. 같은 집계의 이벤트는 이 값으로 정렬 |
| payload | JSON | type별 내용(각 모듈 api.md) |

## 전달·순서·멱등
| 항목 | 규칙 |
|---|---|
| 기록 | 상태 변경과 같은 트랜잭션에서 `<모듈>_outbox_events`에 INSERT(멱등 키 unique). 워커가 구독자별 `<모듈>_outbox_deliveries(event_id, subscriber, status, attempts, last_error)`를 만들어 전달 |
| 같은 DB | 구독 모듈이 outbox를 읽거나 워커가 직접 호출. 전달 실패는 재시도(지수 간격), 한도 초과 시 dead + 운영 알림 |
| 다른 서비스 | HTTP POST + HMAC-SHA256 서명 헤더 `X-Nomad-Signature`(타임스탬프 포함, **5분 허용**). 형식 제안: `t=<unix초>,v1=<hex(HMAC(secret, t + "." + 원문 본문))>`. 구독자별 비밀키는 비밀 저장소 |
| 받는 쪽 의무 | `inbox(event_id unique)`로 중복 제거 · 응답 2xx면 전달 완료 · 집계별 **sequence를 저장·비교**해 더 낮은 sequence는 무시 · 이벤트가 자기 레코드보다 먼저 도착해 레코드가 없으면 처리하지 말고 정본 API로 **재조회**해 맞춘다 |
| 모르는 type | 받는 쪽은 구독 등록한 type만 처리한다. 모르는 type은 `inbox`에 기록만 하고 무시(2xx 응답) |
| 순서 | 집계 간 순서는 보장하지 않는다. 같은 집계 내 순서만 sequence로 판정 |
| 서명 불일치 | 401 (LMS-A16 기준) |

## 이벤트 이름
`domain.object.verb` 형식. 이름 정본은 발행 모듈 문서(예: payments api.md · auth-rbac README). 구독 모듈은 그 type을 그대로 쓴다.

이관 원문: payments/api.md "외부 계약" 장(2026-10 이관 — 이제 이 문서가 정본). 모듈별 이벤트 이름·payload는 각 모듈 문서.
