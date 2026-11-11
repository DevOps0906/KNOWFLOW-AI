# task-035 WA 다운로드 화면 S-18·배포 파이프라인
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WA · task-024, task-033, task-034 (파일이 있어야 연결) |
| 위험도·보안 영향 | 높음 · 노출 면(다운로드 경로)·공급망(배포 파일 변조)·키(서명 시크릿) |
| 담당 | builder (+tester). 착수 전 challenger. 완료 후 reviewer(security) |
| 근거 | `docs/adr/0007-installable-apps.md`, `docs/03_SCREENS_UX.md` S-06·S-18, `platform-docs/Capacitor.md` 4.9장·`Tauri.md` 11장 |
| 쓰기 허용 | `apps/web/src/app/download/**`, `apps/web/src/components/download/**`, `apps/web/src/lib/download/**`, `.github/workflows/**`(앱 배포만), 배포 목록(매니페스트) 파일 |
| 할 것 | S-18(OS 감지·추천 버튼·전체 목록·설치 안내: Android 알 수 없는 앱·SmartScreen·Gatekeeper), S-06 설치 카드, 목록(버전·크기·SHA-256·릴리스일), CI가 빌드·서명·해시 계산·업로드·목록 갱신(CI 토큰 최소 권한: 해시·목록 쓰기와 파일 업로드 권한 분리), 비서명 베타 경고 문구는 S-18에, 비로그인 접근은 S-02 이동 후 복귀, 최소 셸 버전 안내(제안) |
| 하지 않을 것 | 스토어 연동, 자동 업데이트, 결제·계정·DB 변경, 서명 키·시크릿을 저장소·로그에 노출, 새 의존성 임의 추가 |
| 완료 조건 | [ ] 테스트: OS 감지 분기(UA 조작: 지원 OS·비지원 OS·모바일 iOS는 안내만) [ ] 테스트: 목록 해시 형식·파일 해시 일치, 불일치 시 화면에 노출 안 됨 [ ] 반응형 3구간 캡처(`shot`) [ ] CI 로그에 시크릿 0건, `pnpm test` · `pnpm lint` · `pnpm typecheck` · `secscan` 통과 [ ] 내려받은 파일의 SHA-256이 화면 값과 같다(수동 1회) |
| 착수 조건 | 열린 결정 #2(저장 위치·접근) 확정, `docs/03_SCREENS_UX.md` S-18 승인 |
