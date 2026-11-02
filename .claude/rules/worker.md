---
paths:
  - "apps/worker/**"
---
# Worker 영역 규칙 (apps/worker/** 작업 때만 로드)
- TypeScript(Node) 상시 컨테이너. 작업 계약은 `docs/blueprints/contracts/JOBS.md` 패턴과 `docs/05_DATA_MODEL.md#6` 상태 매핑을 따른다.
- 서비스 권한 키·AI 키는 Worker 전용 환경 변수에서만 읽는다. 로그에 키·원문 본문을 남기지 않는다.
- 외부 URL은 해석된 IP 기준으로 내부망·메타데이터·루프백을 차단하고, 리디렉션마다 다시 검사한다(`docs/01_PRD.md#8-1` 한도).
- 작업은 멱등이어야 한다. 같은 작업을 두 번 실행해도 청크·인용이 중복되지 않게 한다.
- 임베딩은 임베딩 서버(bge-m3) HTTP 호출로, LLM 호출은 `apps/web/src/ai`와 같은 공급자 인터페이스로 한다.
