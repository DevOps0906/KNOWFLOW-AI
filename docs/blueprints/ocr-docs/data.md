# OCR Docs — 데이터 모델 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

공통 규칙: 개인정보·식별 컬럼은 ★. 공통 컬럼 created_at · updated_at. 모든 테이블에 `org_id` + 조직 RLS. 상태·필드·이벤트 쓰기는 서비스 키 경유(`guard_privileged_write`)만. 입력 파일은 files-storage `file_id`로만 참조(이미지·PDF 본문은 이 모듈 테이블에 저장하지 않음). **주민등록번호 원문 저장 금지**(패턴 13자리 검출 시 저장 전 뒷자리 마스킹, 일반 규칙 [CONVENTIONS.md](../contracts/CONVENTIONS.md)). 운전면허·여권번호도 고유식별정보로 보고 MVP 문서 종류에서 제외.
읽기 기준: 문서·필드는 업로드한 본인 + 검토자(`ocr:review`), 설정·전달 기록은 OCR 관리자(`ocr:manage`). 설정은 core org 설정의 `ocr` 키(새 테이블 없음).

| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|

연결: `ocr_documents.file_id` → files-storage `file_id`(미설치 시 Storage 경로) · 확정 이벤트 구독 측(ERP `partners`·CRM `crm_companies`의 사업자번호)과는 이벤트로만 연결하며 FK 없음.
