# Files Storage — 화면 · 상태 · 흐름 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **파일 구성원** = 조직 active 구성원(owner·admin·member는 읽기·쓰기, viewer는 읽기만·업로드 불가). **업로더** = `files.uploaded_by`. **파일 관리자** = `files:manage` 보유자 또는 owner·admin(같은 조직만). **공개(토큰)** = 로그인 없이 공유 링크 토큰(+비밀번호)으로만 접근. 검사(scanning)가 끝나기 전·격리된 파일은 다운로드·공유 불가.

## 화면
| ID | 화면 | 유형 | 경로 | 주된 일 | 구성 | 데이터 | API | 권한 | 다음 |
|---|---|---|---|---|---|---|---|---|---|

## 상태
| ID | 빈 | 로딩 | 오류 | 성공 |
|---|---|---|---|---|

## 흐름
| ID | 흐름 | 단계 |
|---|---|---|
