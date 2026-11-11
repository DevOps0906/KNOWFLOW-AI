# task-022 E2E 테스트 F-01~F-05 + 반응형 shot

| 항목 | 내용 |
|---|---|
| 웨이브 | W5 |
| 선행 | task-016, task-018, task-019, task-021, task-029 |
| 위험도 | 보통 |
| 보안 영향 | 없음 |
| 담당 | tester (+ builder: 테스트 계정 시드) |
| 근거 | `docs/03_SCREENS_UX.md#흐름`(F-01~F-05), `docs/01_PRD.md#5` |
| 쓰기 허용 | `e2e/**`, `playwright.config.*`, `.github/workflows/e2e.yml`, `package.json`(scripts `e2e` 추가만) |

## 할 것
- F-01~F-05 핵심 흐름을 E2E로 작성(F 정의는 `03_SCREENS_UX.md#흐름` 기준, 가입→자료 등록→질문→리포트 순, F-05 유튜브 요약·장면 카드 포함)
- 테스트 전용 계정·샘플 자료 시드, 외부 LLM·Gemini·YouTube 호출은 고정 응답 목 처리(비용 0)
- 3개 구간(모바일 390 / 태블릿 820 / 데스크톱 1440)에서 주요 화면 `shot` 캡처
- 타 사용자 자료 접근 불가 시나리오 1건 포함

## 하지 않을 것
- 제품 코드 수정(발견한 결함은 `tasks/README.md` 발견한 문제에 기록)
- 실제 LLM·Gemini·YouTube 호출, 실제 사용자 데이터 사용

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm e2e` F-01~F-05 전부 통과
- [ ] `shot` 3개 구간 캡처 파일이 생성되고 가로 스크롤 없음 확인
- [ ] 실패 시 `.nomad/logs/` 로그로 원인 확인 가능
