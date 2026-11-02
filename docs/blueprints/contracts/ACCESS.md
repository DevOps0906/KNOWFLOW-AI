# ACCESS — 접근 제어 계약 (정본)

## 권한 판정
| 항목 | 규칙 |
|---|---|
| 판정 함수 | `has_permission(org, perm)` 하나(권한 문자열 `resource:action`). API와 RLS가 같은 함수를 쓴다 |
| 확인 대상 | `auth.uid()`로 멤버십·**계정 상태(`profiles`)·조직 상태(`organizations.status`)**를 매번 조회. 계정 `active`·조직 `active`도 매번 확인 |
| JWT | 클레임은 믿지 않는다 |
| 플랫폼 운영자 | 조직 역할이 아니라 `platform_admins` + `is_platform_admin()`으로 분리. `platform_admins` 직접 읽기·쓰기 금지 |
| 역할 등급 | owner > admin > member > viewer. 자기 등급 이하만 부여·변경·정지·제거. owner 지정·해제·정지·제거는 owner만 |
| owner 수 | **활성 owner 수 ≥ 1**을 DB 트리거 + 행 잠금으로 보장(정지된 owner는 세지 않음). 마지막 활성 owner의 강등·정지·제거·계정 삭제 금지(409) |

## 서비스 키
| 항목 | 규칙 |
|---|---|
| 용도 | **워커·웹훅 전용**. 콘솔을 우회하는 데 쓰지 않는다(플랫폼 운영 작업은 `is_platform_admin()`을 거치는 엔드포인트로만) |
| 노출 | 클라이언트·로그에 노출 금지 |
| 쓰기 | 특권 쓰기·상태 전이는 서비스 키 경유(`guard_privileged_write`), 클라이언트 직접 쓰기 불가 |

## 서버 간 인증과 파일별 접근 (owner_module)
FILE은 저장·검사·서명 URL 발급만 맡고, 모듈 고유의 "누가 이 파일을 볼 수 있나"는 소유 모듈이 판정한다.
| 구분 | `owner_module` | `visibility` | 읽기 경로 |
|---|---|---|---|
| 파일함 일반 파일 | null | org | 조직 구성원이 파일함(A03)·다운로드(A05) |
| 모듈 소유 파일 | `stt` · `rag` · `ocr` 등 | module(또는 private) | 파일함 목록·사용자 다운로드·공유에서 제외. 소유 모듈이 자기 규칙을 판정한 뒤 **서버 간 호출**(키 org·ref_module = 파일 org·owner_module, 불일치 404)로 FILE-A05 서명 URL을 요청 |

이관 원문(2026-10, 이제 이 문서가 정본): auth-rbac/README.md(권한·owner·서비스 키) · auth-rbac/api.md(has_permission 상태 확인·서비스 키) · files-storage/README.md "파일별 접근 제어 (owner_module · visibility)".
