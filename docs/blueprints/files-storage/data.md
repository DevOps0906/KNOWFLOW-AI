# Files Storage — 데이터 모델 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

공통 규칙: 크기는 정수 **바이트**(`_bytes`). 개인정보가 담길 수 있는 컬럼은 ★. 공통 컬럼 created_at · updated_at. 모든 테이블에 `org_id` + 조직 RLS(권한 판정은 auth-rbac `has_permission`, 미설치 시 core 헬퍼 `is_org_member`·`has_org_role`).
Storage 경로 규칙(CORE_SPEC#10): `org_id/app/entity/uuid.ext`, 첫 폴더 = org_id, 폴더 판정은 `storage_org_id(p_name)`(core_lite). 기본 버킷: `org-files`(50MB, 비공개) · `exports`(서명 URL 7일) · `public-assets`(이미지 10MB). 값은 `file_settings`로 조직별 조정.
파일 상태는 `files.status`: uploading → scanning → ready | quarantined → deleted → purged(영구 삭제). `owner_module`이 있는 파일은 소유 모듈이 접근 규칙을 판정하고, Storage 버킷은 클라이언트 직접 SELECT를 RLS로 막아 서명 URL로만 읽는다. 업로드·상태 전이 쓰기는 서비스 키 경유 서버 함수만, 조직 구성원은 읽기만.

| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
