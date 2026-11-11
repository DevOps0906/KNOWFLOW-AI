# task-033 WA Android 셸(Capacitor 원격 셸, APK)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WA · task-024 (배포된 운영 웹 주소 필요) |
| 위험도·보안 영향 | 높음 · 노출 면(원격 콘텐츠가 부르는 플러그인)·키(서명 키스토어)·세션 |
| 담당 | builder (+tester). 착수 전 challenger. 완료 후 reviewer(security) |
| 근거 | `docs/adr/0007-installable-apps.md`, `platform-docs/Capacitor.md` 4.2·4.3·4.9·4.10장, `docs/01_PRD.md#8` |
| 쓰기 허용 | `apps/android/**`(새 패키지, 앱 코드 없이 설정·네이티브만), 루트 워크스페이스 설정, `.env.example`(이름만) |
| 할 것 | ADR-0007 예외로 운영 빌드도 `server.url`(원격 셸). Capacitor 최신 stable 확인·버전 고정. `androidScheme=https`, `cleartext:false`, 탐색 허용·플러그인 범위는 [ADR-0007](../docs/adr/0007-installable-apps.md) 따름, 연결 없음은 플러그인 없이 로드 실패 처리 화면, 앱 첫 실행은 로그인 화면, 쿠키 세션 유지 확인, 서명 APK 생성(키스토어는 로컬·CI 시크릿) |
| 하지 않을 것 | 웹 코드·API 수정, 푸시·카메라·파일 플러그인, 스토어 출시, iOS, 서명 키를 저장소에 넣기 |
| 완료 조건 | [ ] `secscan license`·lockfile 커밋 [ ] 설정 테스트: 운영 빌드에 `cleartext`·디버깅·개발 `server.url` 없음 [ ] 테스트: 허용 외 도메인(서브도메인·http 포함) 이동이 웹뷰에서 열리지 않고 시스템 브라우저로 감 [ ] 실기기(미확인 기종 목록) 확인: 이메일 로그인 후 앱 재시작해도 세션 유지, 비행기 모드에서 안내 화면 [ ] 최소 Android 버전은 ADR #5 확정 뒤 여기 기록 [ ] `apksigner verify`로 서명 확인, APK에서 비밀 패턴 0건(`secscan`) |
| 착수 조건 | 열린 결정 #1(키스토어 정책)·#4·#5 해소 또는 기본값 승인 |
