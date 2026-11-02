# Auth·RBAC — 데이터 모델 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

사용자·세션·로그인 수단·MFA 요소는 Supabase Auth가 `auth` 스키마(users·identities·sessions·mfa_factors)에서 관리한다 — 아래 표에 넣지 않고, 앱 쪽 `profiles.user_id`가 `auth.users.id`를 가리킨다.
`org_id`가 있는 테이블은 조직 단위 RLS를 건다. `org_id`가 없는 테이블(profiles · roles · role_permissions · platform_admins · rate_limit_counters · inbox)은 비고에 이유를 적는다. 개인정보 컬럼은 ★. 공통 컬럼 created_at · updated_at(필요한 표만 deleted_at).
권한 판정은 DB 함수 `has_permission(org, perm)`: **`auth.uid()`로 멤버십 · 정지 상태를 매번 조회**하고(`profiles.계정 상태='active'`, `organizations.status='active'`, `memberships.status='active'`를 모두 확인) JWT 클레임은 믿지 않는다. 정지 직후 거부 테스트 항목은 `api.md` 검증 항목. 활성 조직은 요청 파라미터 · 쿠키로 받고 RLS는 멤버십으로 판정한다. 플랫폼 운영자는 `is_platform_admin()`으로만 판정한다.

| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
