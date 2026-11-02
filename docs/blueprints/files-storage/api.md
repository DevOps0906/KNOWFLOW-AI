# Files Storage — API (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **파일 구성원** · **업로더** · **파일 관리자**는 `screens.md` 상단과 같다. **서버 간 인증** = 서비스 키(워커·참조 모듈 서버, 규칙은 [../contracts/ACCESS.md](../contracts/ACCESS.md)), 키의 조직과 대상 파일의 `org_id` 일치 필수. 서비스 키는 `ref_module` 범위를 가지며 불일치는 **404**. **공개(토큰)** = 로그인 없이 공유 토큰(+비밀번호)으로 검증.
크기는 정수 바이트. 저장 경로는 **서버가 만든다**(`org_id/app/entity/uuid.ext`, CORE_SPEC#10) — 클라이언트가 보낸 경로·파일명은 쓰지 않고 표시용 이름만 정규화해 저장한다. 업로드 본문은 이 API를 거치지 않고 Supabase Storage(6MB 초과는 tus 재개)로 직접 올라가며, API는 세션 발급과 완료 검증을 맡는다.

| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|

## 서버 내부 규칙 (API가 아닌 워커 · DB 함수)
| 대상 | 규칙 |
|---|---|

## 외부 계약 — 다른 모듈이 받는 이벤트
공통 봉투·전달 규칙: [../contracts/EVENTS.md](../contracts/EVENTS.md). 이 모듈의 값: `aggregate_type = file`, `aggregate_id` = file_id, outbox 테이블 `file_outbox_events`·`file_outbox_deliveries`, 레코드보다 먼저 도착한 이벤트는 FILE-A04 GET으로 재조회. 파일 이름·본문 원문은 payload에 넣지 않고 id만 담는다.

### 이벤트와 payload
| type | 발행 시점 | payload |
|---|---|---|
- `file.object.ready`는 `version_no`를 포함한다. 받는 쪽은 **같은 file_id의 version_no가 바뀌면 재처리**(색인·전사 등)한다.
- 참조 모듈(STT·RAG·OCR 등)은 `ready`를 받은 뒤에만 `file_id`를 처리하고, 이벤트 전에 도착한 참조는 FILE-A04 GET으로 재조회한다. `deleted`를 받으면 자기 참조를 정리한다.
