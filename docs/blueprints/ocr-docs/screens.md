# OCR Docs — 화면 · 상태 · 흐름 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **OCR 사용자** = `ocr:write` 보유자(업로드·자기 문서 조회). **검토자** = `ocr:review` 보유자(필드 수정·확정·반려, 조직 전체 문서). **OCR 관리자** = `ocr:manage` 보유자 또는 owner(문서 종류·엔진·보관 설정, 이벤트 전달 현황). 모두 같은 조직만. 판정은 auth-rbac `has_permission`(미설치 시 core `is_org_member`·`has_org_role`).

## 화면
| ID | 화면 | 유형 | 경로 | 주된 일 | 구성 | 데이터 | API | 권한 | 다음 |
|---|---|---|---|---|---|---|---|---|---|

## 상태
| ID | 빈 | 로딩 | 오류 | 성공 |
|---|---|---|---|---|

## 흐름
| ID | 흐름 | 단계 |
|---|---|---|
