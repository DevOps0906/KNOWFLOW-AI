# Auth·RBAC — API (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

권한 용어: **공개** = 로그인 전 호출(레이트 리밋 필수). **로그인 · 조직** = 활성 조직의 구성원(정지 아님). **admin 이상** = 역할 admin·owner. **owner** = 소유자. 모든 판정은 `has_permission(org, perm)`(권한 문자열 `resource:action`)을 DB·API가 같이 쓴다.
사용자·세션 원본은 Supabase Auth(`auth` 스키마)이고, 아래는 앱이 노출하는 API다. 로그인·로그아웃 이벤트가 누락되지 않도록 클라이언트는 Supabase Auth를 직접 부르지 않고 이 API를 거친다 *(Auth Hook 대안은 확인 필요)*.

| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|

## 규칙 (API 공통)
- **서비스 키로 콘솔을 우회하지 않는다.** 플랫폼 운영 작업(계정·조직 정지, 운영자 역할 변경)은 `AUTH-A14~A16`처럼 `is_platform_admin()`을 거치는 엔드포인트로만 한다. 서비스 키는 워커·웹훅 전용이다.
- `has_permission`과 RLS는 멤버십 상태뿐 아니라 **`profiles.계정 상태 = 'active'`와 `organizations.status = 'active'`도 매번 확인**한다. JWT 클레임은 믿지 않는다.
- 이벤트 이름 정본은 `README.md` 4절 표다. 변경 API는 도메인 변경과 같은 트랜잭션에서 outbox에 기록한다.

## 검증 항목 (정지 직후 거부 테스트)
| 대상 | 정지 직후 기대 결과 |
|---|---|
