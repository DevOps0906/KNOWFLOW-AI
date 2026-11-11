# task-031 WY 랜딩 S-01 유튜브 문구 반영
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-025 |
| 위험도·보안 영향 | 낮음 · 없음 (문구만) |
| 담당 | builder. 완료 후 codex-reviewer(design) |
| 근거 | `docs/youtube-mvp-review.md#7`, `docs/00_LEAN.md`(결과 행), `docs/adr/0006-youtube-summary-and-capture-mvp.md`(결과 행), `spec S-01` |
| 쓰기 허용 | `apps/web/src/app/(marketing)/page.tsx`(문구만), `apps/web/src/app/(marketing)/page.test.tsx`, `docs/claims-ledger.md` |
| 할 것 | 유튜브 요약·시각 인용·장면 카드(L0)를 "예정" 기능으로만 문구 수정, 주장별 근거를 claims-ledger에 기록 |
| 하지 않을 것 | 유튜브 링크만으로 실제 캡처 이미지 자동 생성 약속, 경쟁사 대비 차별 주장(미확인), 법무 판정 전 L1 약속, 레이아웃·사전예약 폼 변경 |
| 완료 조건 | [ ] `pnpm --filter web test` · `pnpm typecheck` 통과 [ ] claims-ledger에 새 주장 전부 근거 표기 [ ] 유튜브 문구 전부 "예정" 표기 [ ] 3구간 화면 캡처 |
