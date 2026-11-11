# task-030 WY 사용자 승인 탭 캡처(L1)
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-029 (활성화는 task-026 프레임 저장 허용 판정 뒤) |
| 위험도·보안 영향 | 높음 · 노출 면·민감 데이터 (화면 캡처 업로드·저장) |
| 담당 | builder (+ tester). 착수 전 challenger. 완료 후 reviewer(security) |
| 근거 | `docs/youtube-mvp-review.md#4`, `docs/adr/0006-youtube-summary-and-capture-mvp.md#결정`(1번), `docs/05_DATA_MODEL.md`(캡처 저장, `#7` 반영 후), `docs/04_API.md#A-11` |
| 쓰기 허용 | `apps/web/src/components/youtube/capture/**`, `apps/web/src/app/api/sources/[sourceId]/captures/**`, `apps/web/src/lib/storage/**`, `supabase/migrations/**`(새 번호만), `packages/db-tests/**` |
| 할 것 | 사용자가 탭 공유를 승인하면 브라우저가 카드별 시각 화면 캡처(데스크톱 전용). 초기값(제안): 비공개 프로젝트에만 저장, 영상당 20장, 시각·채널·링크 자동 표기, 권리자 요청·영상 삭제 시 제거 |
| 하지 않을 것 | 서버 측 프레임 추출, 공개 공유, 승인 없는 자동 캡처, 업로드 영상 캡처(L2) |
| 완료 조건 | [ ] 테스트: 탭 공유 거부 시 저장 없음 [ ] 테스트: 21장째 거절 [ ] DB 테스트: 타인 캡처 접근 불가 [ ] 테스트: 영상 삭제 시 캡처 제거 [ ] 모바일·태블릿에서 진입 숨김 확인 |
| 보류 조건 | task-026 프레임 저장 불가 또는 task-025 L1 동작 실패 시 보류하고 L0를 유지한다 |
