# task-006 W1 앱 셸·공통 컴포넌트

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-002 |
| 위험도 | 낮음 |
| 보안 영향 | 없음 |
| 담당 | builder (+ tester) |
| 근거 | `spec S-06`, `DESIGN.md#2`, `design/prototype` (시안 기준) |
| 쓰기 허용 | `apps/web/src/components/**`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/styles/**` |

## 할 것
- 앱 셸(사이드바·상단바·모바일 하단/시트), 반응형 3구간(~767 / 768~1199 / 1200~) 레이아웃
- 공통 컴포넌트: 버튼·입력·카드·배지(처리 상태)·빈 상태·로딩·오류·토스트·다이얼로그(shadcn/ui 기반)
- 라이트 기본, 다크 2차 토글, 구간별 폰트 크기 토큰 적용

## 하지 않을 것
- 데이터 연동·API 호출, 개별 화면 본문, hex·px 직접 사용

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm test` 통과
- [ ] `design-preview`로 3구간 화면 확인, 시안과 대조 결과 기록
- [ ] `grep -rE "#[0-9a-fA-F]{3,6}|[0-9]+px" apps/web/src/components` 직접 값 없음
- [ ] 컴포넌트 렌더 테스트에서 상태(빈·로딩·오류) 각 1건
