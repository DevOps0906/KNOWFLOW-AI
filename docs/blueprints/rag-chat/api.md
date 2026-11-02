# RAG Chat — API (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **구성원** = `rag:use` 보유자(같은 조직, 본인 대화만). **지식 관리자** = `rag:manage` 보유자 또는 owner(같은 조직). **서버 간(서명 토큰)** = Next.js가 발급한 EdDSA 토큰(scope=`rag`, 비용·쓰기 요청은 `jti` 1회 사용)을 FastAPI가 검증한 호출 — 토큰의 `org`·`app`·**`sub`(user_id, 필수)**만 쓰고 **요청 본문의 org·user·역할 값은 사용하지 않는다**. 사용자의 역할·ACL은 FastAPI가 `sub`로 DB에서 직접 조회한다(`_platform-core/AI_ARCHITECTURE.md#2.1`). 사용자 API는 Next.js가 로그인·권한을 확인한 뒤 FastAPI를 부른다.
**모든 읽기·검색은 요청자 권한(문서 접근 범위, ACL)으로 필터한다.** 권한 밖 문서는 답변·출처·목록·오류 메시지 어디에도 나오지 않으며, 접근 못 하는 문서는 존재 여부도 숨기려고 **404**로 답한다. 크레딧 선차감은 선택 기능(CORE_SPEC#4, `CR001`).

| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|

## 서버 내부 규칙 (API가 아닌 워커 · DB 함수)
| 대상 | 규칙 |
|---|---|

## 외부 계약 — 다른 모듈이 받는 이벤트
공통 봉투·전달 규칙: [../contracts/EVENTS.md](../contracts/EVENTS.md). 이 모듈의 값: `aggregate_type = document`, outbox 테이블 `rag_outbox_events`·`rag_outbox_deliveries`. 문서 본문·질문 원문은 payload에 넣지 않고 id만 담는다.
| type | 발행 시점 | payload | 구독자(예시) |
|---|---|---|---|
- 문서 id가 먼저 도착해 레코드가 없으면 RAG-A04 GET으로 재조회한다.
- **받는 이벤트**(files-storage): `file.object.deleted`·`file.object.quarantined` → 해당 `file_id` 문서를 검색에서 즉시 제외 · `file.object.ready`(version_no 변경) → 새 버전 내용 해시와 문서 `content_hash`를 비교해 **다르면 재색인**(새 작업), 같으면 무시 · `file.object.purged` → 해당 문서의 청크·임베딩 삭제(문서는 삭제됨 처리). 미설치 시 문서 삭제·재색인 API로 수동.
