# STT Voice — API (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **구성원** = 조직의 `stt:use` 보유자. **음성 관리자** = `stt:manage` 보유자 또는 owner·admin(같은 조직만). **작성자 본인** = `stt_recordings.owner_id`. **조직 공유** = `visibility=org`인 녹음은 구성원이 전사·요약을 읽기만 가능. 음성 관리자도 남의 비공개 전사·요약 본문은 읽을 수 없고 메타데이터(길이·상태·용량 등)만 본다(확정). **서버 간 인증** = 서비스 키(워커·음성 서버 호출), 사용자 로그인 불가. 권한 판정은 auth-rbac `has_permission`(미설치 시 core `is_org_member`·`has_org_role`).
입력 음성은 files-storage의 `file_id`로만 받는다(미설치 시 Supabase Storage 경로 규칙 CORE_SPEC#10). 시간은 ms 정수. 전사 본문·원본 음성 URL은 어떤 로그·이벤트 payload에도 넣지 않는다.

| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|

## 서버 내부 규칙 (API가 아닌 워커 · DB 함수)
작업 상태·단계·크레딧의 일반 규칙은 [../contracts/JOBS.md](../contracts/JOBS.md)이 정본이다. 여기에는 STT 고유 규칙만 둔다.
| 대상 | 규칙 |
|---|---|

## 외부 계약 — 다른 모듈이 받는 이벤트
공통 봉투·전달 규칙: [../contracts/EVENTS.md](../contracts/EVENTS.md). 전사 본문 원문은 payload에 넣지 않는다(id만). outbox 테이블은 `stt_outbox_events`·`stt_outbox_deliveries`.

이 모듈의 값: `aggregate_type = stt_job`, `aggregate_id` = 작업 id, `actor_type` = `service`(워커), `result` = 성공·실패.
| type | 발행 시점 | payload |
|---|---|---|
- 취소·요약 완료는 이벤트를 발행하지 않는다(MVP).
- 구독자(예시): notify(수신자 = `payload.requested_by` 1명) · admin-audit(`audit_log`, event_id 유니크).
- 전사 본문이 필요한 모듈은 A05 GET으로 읽는다(작성자·공유 범위 권한). 소비 모듈용 서버 간 읽기 계약은 소비 모듈이 생길 때 정한다.
