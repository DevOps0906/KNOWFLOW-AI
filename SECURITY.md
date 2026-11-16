# 보안 정책 (Security Policy)

## 취약점 신고
- 공개 이슈로 올리지 말고 **GitHub 비공개 취약점 신고**(Security 탭 → Report a vulnerability)를 사용해 주세요.
- 재현 방법 · 영향 범위 · 확인한 버전을 함께 알려 주시면 빠르게 확인합니다.

## 대응
- 접수 후 3영업일 안에 확인 회신합니다.
- 실제 악용 중(KEV)이거나 인터넷에 노출된 경로에서 도달 가능한 취약점을 먼저 처리합니다.

## 지원 버전
- 최신 `main` 브랜치와 최신 릴리스만 보안 수정을 제공합니다.

## 수용한 위험
- Worker의 service_role 키 보유(캡처 이미지 정리): 근거·최소 권한 대안·egress allowlist 추가·키 회전 절차는 [docs/security/worker-service-role.md](docs/security/worker-service-role.md).
