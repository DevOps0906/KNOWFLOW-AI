# STT Voice — 데이터 모델 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

공통 규칙: 모든 테이블 `org_id` + 조직 RLS. 개인정보·음성 유래 컬럼은 ★. 공통 컬럼 created_at · updated_at. 작업·단계·크레딧 공통 컬럼의 정본은 [../contracts/JOBS.md](../contracts/JOBS.md).
읽기: 작성자 본인, 조직 공유(`visibility=org`)면 `stt:use` 구성원. **음성 관리자는 타인 비공개 녹음의 메타데이터(길이·상태·용량)만 읽고 전사 본문 테이블(transcripts·segments·speakers·summaries)은 읽지 못한다(확정).** 쓰기: 작업·단계·전사·요약·이벤트는 서비스 키 경유(`guard_privileged_write`), 구간·화자·제목은 서버 함수 경유, 조직 구성원의 직접 쓰기 없음.
입력 음성은 files-storage `file_id`로만 참조(음성 바이트는 이 모듈이 저장하지 않음). 이벤트 계약은 `api.md` 외부 계약, 봉투는 [../contracts/EVENTS.md](../contracts/EVENTS.md).

| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
