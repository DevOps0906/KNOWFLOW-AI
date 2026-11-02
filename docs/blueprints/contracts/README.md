# Contracts — 청사진 공통 계약

여러 모듈에 복사돼 있던 공통 규칙의 정본 1곳. 각 모듈은 규칙을 복사하지 않고 링크한다.

| 문서 | 소개 |
|---|---|
| [EVENTS.md](EVENTS.md) | 이벤트 봉투 12필드·outbox/inbox·HMAC·순서·모르는 type 처리 |
| [JOBS.md](JOBS.md) | AI 작업 테이블·단계·상태 전이·재시도=새 작업·환불 멱등 키 |
| [ACCESS.md](ACCESS.md) | has_permission·플랫폼 운영자·서비스 키·서버 간 인증·owner_module |
| [CONVENTIONS.md](CONVENTIONS.md) | 금액·VAT·개인정보 마스킹·"확인 필요" 표기·이벤트 이름·ID 접두사 표 |

## 참조 규칙
- 다른 모듈은 `../contracts/<문서>`로 참조한다. 같은 표를 복사하지 않는다.
- 모듈 고유 값(type 목록·kind·step·payload)은 해당 모듈에 두고, 공통 규칙만 여기서 가져온다.

## 버전 규칙
- 계약 변경 = minor(0.x 올림). 이 모듈 `version`이 오르면 참조하는 모듈이 영향을 받는지 확인한다.
