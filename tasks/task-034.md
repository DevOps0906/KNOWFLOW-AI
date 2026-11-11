# task-034 WA 데스크톱 셸(Tauri 원격 셸, Windows·macOS)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WA · task-024 (task-033과 병렬 가능) |
| 위험도·보안 영향 | 높음 · 노출 면(원격 URL에 IPC 권한)·키(코드 서명 인증서)·세션 |
| 담당 | builder (+tester). 착수 전 challenger. 완료 후 reviewer(security) |
| 근거 | `docs/adr/0007-installable-apps.md`, `platform-docs/Tauri.md` 5·9·11·13장, `docs/01_PRD.md#8` |
| 쓰기 허용 | `apps/desktop/**`(새 패키지, 설정·Rust 최소), 루트 워크스페이스 설정 |
| 할 것 | ADR-0007 예외로 운영 빌드도 원격 URL을 메인 창에. Tauri 최신 stable 확인·버전 고정. 탐색 허용·IPC 범위는 [ADR-0007](../docs/adr/0007-installable-apps.md) 따름(capability remote 없음, 외부 링크 열기만 셸 처리), 연결 없음은 로드 실패 처리 화면, 앱 첫 실행은 로그인 화면, 쿠키 세션 유지 확인, Windows(NSIS 또는 MSI)·macOS(.dmg) 빌드 설정, 서명·공증 단계는 인증서 확보 시 활성화 |
| 하지 않을 것 | 웹 코드·API 수정, 로컬 DB·파일 접근·자동 업데이터, 스토어 출시, 서명 키·인증서를 저장소에 넣기 |
| 완료 조건 | [ ] `cargo audit`·`secscan license`·lockfile 커밋 [ ] 설정 테스트: capability에 remote 항목 없음·허용 파일과 일치 [ ] 테스트: 허용 외 도메인(서브도메인·http 포함) 이동이 창에서 열리지 않고 시스템 브라우저로 감 [ ] 최소 OS 버전은 ADR #5 확정 뒤 여기 기록 [ ] 실기기 확인(Windows·macOS 각 1대, 미확인): 로그인 후 재시작 세션 유지, 오프라인 안내 [ ] 서명 후 `signtool verify`(Windows)·`spctl --assess`(macOS) 통과(인증서 확보 시) |
| 착수 조건 | 열린 결정 #1(인증서)·#4·#5 해소. 인증서 없으면 비서명 빌드까지만 |
