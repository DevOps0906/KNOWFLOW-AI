# RAG Chat — 화면 · 상태 · 흐름 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **구성원** = `rag:use` 보유자(자기 대화만 본다). **지식 관리자** = 조직의 `rag:manage` 보유자 또는 owner. 지식 관리자도 **문서 접근 범위(ACL)를 넘어 내용을 볼 수 없다**(이름·상태 같은 관리 정보만, 내용은 ACL 통과 시). 판정은 auth-rbac `has_permission`(미설치 시 core `is_org_member`·`has_org_role`). 관리자 화면 `/admin/rag/*`는 조직 단위이며 플랫폼 운영자 화면이 아니다.

## 화면
| ID | 화면 | 유형 | 경로 | 주된 일 | 구성 | 데이터 | API | 권한 | 다음 |
|---|---|---|---|---|---|---|---|---|---|

## 상태
| ID | 빈 | 로딩 | 오류 | 성공 |
|---|---|---|---|---|

## 흐름
| ID | 흐름 | 단계 |
|---|---|---|
