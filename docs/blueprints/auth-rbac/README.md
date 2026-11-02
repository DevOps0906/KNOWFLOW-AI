# Auth·RBAC 모듈 — 인증·조직·권한 청사진

**누가 들어오고 → 어느 조직에서 → 무엇을 할 수 있는지**를 한곳에서 정하는 기반 모듈입니다. 다른 모듈은 이 모듈의 `has_permission(org, perm)`과 `org_id` 테넌시를 그대로 씁니다.
이 폴더는 기획 표(`screens.md` · `api.md` · `data.md`)라서 `plan2spec`이 바로 구조도 · 와이어프레임 · 필수 구조 검사를 만듭니다. 스택 선택 근거는 `adr.md`입니다.

```bash
nomad-os module add auth-rbac <프로젝트 경로>   # → <프로젝트>/docs/blueprints/auth-rbac/ 로 가져오기 (커밋 고정, 기존 수정 보존)
plan2spec                                       # 화면 12개 · 흐름 5개 와이어프레임 + 구조도 생성
```
쓰지 않을 화면 · API · 테이블은 **행을 지우면** 됩니다. ID 접두사 `AUTH-`는 다른 모듈과 겹치지 않게 하기 위한 것입니다.
필요 모듈: contracts ([../contracts/](../contracts/README.md))

---

## 1. 업무 영역 — 무엇을 재고, 어떤 구조가 반드시 있어야 하나

| 영역 | 목표 | 핵심 지표(제안) | 반드시 있어야 하는 구조 | 화면 |
|---|---|---|---|---|
| **가입·로그인** | 쉽게 들어오되 계정은 지킨다 | 가입 완료율 · 로그인 실패율 | 이메일+비밀번호, 매직 링크, 카카오·네이버·Google, **이메일 열거 방지(같은 응답)**, 레이트 리밋, 재설정 토큰 1회용 | AUTH-S01 · S02 · S03 |
| **계정 보안** | 탈취를 막고 끊을 수 있게 한다 | MFA 사용 비율 | MFA(TOTP), 세션 목록·기기 로그아웃, 계정 삭제 요청 | AUTH-S05 · S06 · S07 |
| **조직** | 한 사용자가 여러 조직에서 일한다 | 조직당 구성원 수 | 조직 생성·전환, 활성 조직은 파라미터·쿠키 + RLS는 멤버십 판정 | AUTH-S08 |
| **구성원·초대** | 사람을 안전하게 들이고 내보낸다 | 초대 수락률 | 이메일 토큰 초대(7일·1회용), 이메일 일치 수락, 정지·제거, **마지막 owner 보호** | AUTH-S04 · S09 · S10 · S11 |
| **역할·권한** | 한 곳에서 판정한다 | — | 역할 4종, `resource:action` 권한, `has_permission`, 플랫폼 운영자 분리 | AUTH-S12 |

## 2. 역할 · 상태 · 권한

```
초대:   대기 → 수락 | 취소 | 만료(7일 경과)
구성원: 활성 ↔ 정지 → 제거(멤버십 삭제)       정지하면 해당 사용자 세션 폐기
계정:   활성 ↔ 정지(플랫폼 운영자)              조직: 활성 ↔ 정지(플랫폼 운영자)
```
| 권한 (제안값 — 권한 문자열 6종과 이 매트릭스는 제안) | owner | admin | member | viewer |
|---|---|---|---|---|
| `member:read` · `role:read` | O | O | O | O |
| `invitation:manage` · `member:role_change` · `member:suspend` · `member:remove` | O | O | — | — |

- 부여 규칙: **자기 등급 이하만** 부여·변경·**정지·제거**. owner 지정·해제·정지·제거는 owner만. 등급 순서 owner > admin > member > viewer.
- 판정 함수(`has_permission`)·owner 수 ≥ 1·플랫폼 운영자·서비스 키 일반 규칙: [ACCESS.md](../contracts/ACCESS.md). 정지 직후 거부 테스트는 `api.md` 검증 항목.
- 역할은 MVP에서 **코드 정의 4종만**. 다른 모듈은 자기 권한 문자열을 `role_permissions` 시드로 추가한다. 커스텀 역할 편집은 이후.
- 플랫폼 운영 작업은 `AUTH-A14~A16`만(서비스 키로 우회 금지).
- 원형 참고: platform-docs `CORE_SPEC.md#2.1~2.4`(멤버 함수 invite_member·accept_invite·change_member_role·remove_member·transfer_ownership), erp `core_lite.sql`의 권한 헬퍼·멤버 함수(복사 전 현행 확인).

## 3. 로그인 수단 · 초대 규칙
| 항목 | MVP | 이후 |
|---|---|---|
| 로그인 수단 | 이메일+비밀번호, 매직 링크, 카카오·네이버·Google (네이버 커스텀 OIDC는 **지원 확인 필요**, `adr.md`) | 본인인증(PASS 등 — 확장 지점만) |
| MFA | 사용자 선택 TOTP. 분실 시 복구 절차는 **확인 필요**(Supabase 기능 범위) | 조직 정책으로 강제(aal 확인 방식) |
| 초대 | 이메일 토큰, 만료 7일, 1회용. 수락 시 인증된 이메일 = 초대 이메일 필수 | 도메인 자동 가입 |
| 세션 | 목록·기기 로그아웃, 정지·비밀번호 재설정 시 폐기 | — |
| 나이 | 생년월일에서 만 14세 미만 파생(LMS 규칙과 동일). MVP는 가입 차단 + 안내 | 법정대리인 동의 |

## 4. 다른 모듈과의 경계
- 역할 변경·정지·계정 관리 콘솔은 admin-audit(ADM)이 맡고, **실제 변경은 이 모듈의 API를 호출**한다: 조직 멤버십은 `AUTH-A10`, 플랫폼 운영자 전용(`is_platform_admin()`)은 계정 정지·복구 `AUTH-A14`(정지 시 모든 세션 폐기), 조직 멤버십 역할 변경 `AUTH-A15`, 조직 정지·복구 `AUTH-A16`(`organizations.status`).
- 초대·인증 메일은 notify가 설치돼 있으면 notify로, 없으면 Supabase 메일로 보낸다(결정).
- 개인정보 열람·정정·삭제 요청의 접수·기한 추적은 ADM 몫이다. `AUTH-A06` 삭제 요청은 `auth.account.deletion_requested`로 발행되어 ADM이 **자동 접수**한다.
- 이벤트는 같은 트랜잭션으로 `outbox_events`에 기록하고 워커가 admin-audit에 전달한다(공통 봉투·전달 규칙: [../contracts/EVENTS.md](../contracts/EVENTS.md)).
- **이벤트 이름 정본은 아래 표**다(ADM·notify 등 구독 모듈은 이 표의 type을 그대로 쓴다). org_id가 null인 이벤트(없는 계정 로그인 실패)는 서버 간 호출에서 키의 org 대조 대신 **플랫폼 서비스 키로만** 전달한다.

| 이벤트 type | 집계(aggregate) | 시점 | payload 핵심 |
|---|---|---|---|
| `auth.login.succeeded` | user | 로그인 성공 | 방식, aal, ip 해시, user_agent |
| `auth.login.failed` | user (없는 계정은 이메일 해시) | 로그인 실패 | 방식, 사유 코드, ip 해시 (org_id 없을 수 있음) |
| `auth.member.role_changed` | membership | 역할 변경 | 이전·이후 역할, 행위자 |
| `auth.invitation.created` | invitation | 초대 발송 | 역할, 초대 이메일 해시, 행위자 |
| `auth.invitation.accepted` | invitation | 초대 수락 | 수락 사용자 |
| `auth.member.suspended` | membership | 정지 | 행위자, 사유 |
| `auth.member.restored` · `auth.member.removed` | membership | 정지 복구·제거 (제안값) | 행위자 |
| `auth.account.suspended` · `auth.account.restored` | user | 계정 단위 정지·복구 (제안값) | 운영자, 사유 |
| `auth.org.suspended` · `auth.org.restored` | organization | 조직 정지·복구 (제안값) | 운영자, 사유 |
| `auth.account.deletion_requested` | user | 계정 삭제 요청 접수 | request_id, 요청 시각 (ADM 자동 접수) |
| `auth.account.deletion_blocked` · `auth.account.deletion_completed` | user | 삭제 처리 보류·완료 (제안값) | request_id, 보류 사유 코드 / 처리 범위 |

### 4-1. 계정 삭제 처리 흐름 (ADM → AUTH)
1. `AUTH-A06` DELETE → 프로필에 삭제 요청 시각 기록 + `auth.account.deletion_requested` → ADM이 개인정보 요청으로 자동 접수·기한 추적.
2. ADM이 처리 상태를 바꾸면 `privacy_request.status_changed`를 보낸다. AUTH는 `inbox(event_id 유니크)`에 기록하고 **삭제 승인 상태일 때만** 처리한다(ADM payload 정본 확인 필요).
3. 예외 검사: 사용자가 **마지막 활성 owner**인 조직이 있으면 처리하지 않고 `auth.account.deletion_blocked`(사유: 소유권 이전 필요)를 회신한다. **결제 5년 보존** 대상 참조(PAY·거래 기록)가 있으면 레코드는 지우지 않고 식별 정보만 지워 분리 보관한다 *(확인 필요 — 법정 보존 범위)*.
4. 예외가 없으면 세션 폐기 → 멤버십 제거 → 프로필 이름·생년월일 삭제 → `auth.users` 삭제 → `auth.account.deletion_completed`.

## 5. 법 · 개인정보 (한국 기준 — **2026-10 기준, 시행 전 원문 재확인, 법률 자문 아님**)
| 항목 | 구조로 반영할 것 |
|---|---|
| 만 14세 미만 | 가입 시 생년월일 확인, 법정대리인 동의는 확장 지점 *(개인정보보호법 조문 확인 필요)* |
| 열람·정정·삭제 요구 | 계정 삭제 요청 접수(`AUTH-A06`), 처리 기한(접수 후 10일)·추적은 ADM *(확인 필요)* |
| 접속기록 | 로그인 성공·실패·권한 변경 이벤트를 ADM이 보관(1년 이상, 설정값) *(확인 필요)* |
| 본인인증 | PASS 등은 확장 지점. 도입 시 CI/DI 해시 중심, **주민번호 저장 금지** *(확인 필요)* |
| 국외 이전 | 인증 서비스 리전·수탁 고지는 PRD에서 정함 *(미확인 — 근거 필요)* |

## 6. 보안 (security-baseline 연결)
- 노출 면: 공개 엔드포인트 `AUTH-A01·A02·A03`·`A12(GET)` — 레이트 리밋, 이메일 열거 방지(가입·로그인·재설정·초대 조회는 같은 응답·같은 지연), 초대·재설정 토큰은 해시만 저장 · 1회용.
- 키: 서비스 키는 워커·웹훅 전용, 클라이언트·로그에 노출 금지, 콘솔 우회 금지. 소셜 공급자 클라이언트 시크릿은 환경 비밀로만.
- 정지 시 세션 폐기, 비밀번호 재설정 시 다른 세션 폐기. `platform_admins` 직접 읽기·쓰기 금지.
- 개인정보(★): 이름·생년월일·이메일. 이벤트 payload에는 이메일·IP 원문을 넣지 않고 해시만 쓴다.
- 소비 제품의 PRD `8. 보안·공급망` 레벨은 팀장이 정한다(인증 모듈은 높음 위험 작업).

## 7. MVP 범위 제안
| 포함 (W1~W3) | 이후 |
|---|---|
| 이메일·매직 링크·소셜 로그인 · MFA(TOTP) · 세션 관리 · 조직 전환 · 초대·역할 4종 · `has_permission` · 이벤트 outbox | 본인인증(PASS) · 조직 MFA 강제 · 도메인 자동 가입 · 커스텀 역할 · SAML/SCIM · 패스키 · 법정대리인 동의 |

## 8. 벤치마킹 메모 (모두 확인 필요 — 공식 문서로 재확인 전에는 사실로 쓰지 않는다)
| 제품 | 차별점 |
|---|---|
| Supabase Auth | Postgres RLS와 직결, 자체 UI 없음 |
| Clerk | 임베드 UI와 조직 기능 내장 |
| Auth0 | 엔터프라이즈 연동 폭 |
| WorkOS | SSO·SCIM 등 B2B 기능을 연결 단위로 제공 |
| Keycloak | 완전 셀프호스트, SAML·OIDC |

**구조만 참고하고 코드는 가져오지 않는다.** 세부 기능 비교는 `docs/benchmark.md` 형식(ux-patterns 3절)으로 근거 URL과 함께 적는다.
