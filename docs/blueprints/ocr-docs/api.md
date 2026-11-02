# OCR Docs — API (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **OCR 사용자** = `ocr:write` · **검토자** = `ocr:review` · **OCR 관리자** = `ocr:manage` 또는 owner(모두 같은 조직만). 판정은 auth-rbac `has_permission`(미설치 시 core `is_org_member`·`has_org_role`). **서버 간 인증** = 서비스 키(워커·구독 모듈 서버), 키의 org와 경로 문서 org 불일치는 **404**. 입력 파일은 files-storage의 `file_id`로만 받는다(미설치 시 Supabase Storage 경로 규칙 CORE_SPEC#10).
추출 값은 개인정보일 수 있다 — 주민등록번호·카드번호 마스킹은 [../contracts/CONVENTIONS.md](../contracts/CONVENTIONS.md), 주민번호 원문은 어떤 요청·응답·로그에도 없다(법 서술·확인 필요 표기는 [../contracts/CONVENTIONS.md](../contracts/CONVENTIONS.md) — 주민번호 처리 근거 제24조의2 확인 필요).

| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|

## 서버 내부 규칙 (API가 아닌 워커)
| 대상 | 규칙 |
|---|---|

## 외부 계약 — 다른 모듈이 받는 이벤트

공통 봉투·전달 규칙: [../contracts/EVENTS.md](../contracts/EVENTS.md). 이 모듈의 값: `aggregate_type = ocr_document`, `aggregate_id` = 문서 id, outbox 테이블 `ocr_outbox_events`·`ocr_outbox_deliveries`. **본문 원문·필드 값은 payload에 넣지 않는다(id만).**

### 이벤트와 payload
| type | 발행 시점 | payload |
|---|---|---|

### 구독
| 항목 | 규칙 |
|---|---|
