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

## 보류 (2026-11-16 사용자 결정)
challenger 착수 전 검토 REVISE 뒤 보류. 재착수 조건: task-025 L1 수동 확인 4항목(`docs/youtube-phase0-result.md` 64~67줄) 통과 + task-026 프레임 저장 허용 판정. IFrame API(029 결정 4 금지)를 L1에 한해 허용할지는 재착수 때 025 결과를 보고 결정.
재착수 시 반영할 검토 결과(요약):
1. 🔴 Storage 파일 잔존: SQL은 행만 지움. RPC가 캡처 행 삭제 + storage_path 목록 반환 → 웹 서버(A-04 DELETE)·운영 런북에서 Storage API remove, 실패분은 task-019 고아 정리. takedown_video는 새 파일에서 재정의, rights_takedowns에 deleted_captures. "영상 삭제 시 캡처 제거"가 즉시 숨김인지 파일 삭제인지 명시.
2. 🔴 재처리 시 캡처 소실: replace_source_moments가 장면 id를 갈아끼움 → source_captures(source_id FK, moment_id ON DELETE SET NULL, t_sec는 서버가 moment에서 복사). `docs/05_DATA_MODEL.md` 98줄("source_moments에 경로 추가")을 먼저 고침.
3. 🔴 업로드 검증 우회: authenticated의 storage INSERT·UPDATE·DELETE 정책 없음. 새 비공개 captures 버킷(file_size_limit·png/jpeg/webp), 검증한 라우트가 서버 권한으로 업로드, 읽기는 60초 서명 URL. 서명 업로드 URL 패턴 금지.
4. 🔴 실현 가능성: 지정 시각 프레임이 떴는지 알 수 없음(광고·버퍼링). 저장 전 미리보기·확인 필수.
5. 🟡 20장 경쟁: sources 행 for update로 자리 예약 → 업로드 → 실패 시 예약 행 삭제. 위조 이미지: t_sec·video_id·채널은 DB 값만, 매직바이트·가로세로 상한, 재인코딩 의존성 없음, "사용자 캡처" 표시. 탭 선택: displaySurface==='browser', preferCurrentTab, 지원 시 cropTo(iframe), 1장 뒤 track.stop(). 데스크톱 판정은 UI만(1200px+·기능 감지). 채널·링크는 캡처 행에 복사하지 않고 sources 조인, 오버레이는 화면에서만(30일 파기·takedown 준수). A-11(`docs/04_API.md` 30줄) DELETE·t_sec 계약을 먼저 고침, RLS는 source_summaries와 같은 조건. 사용자 총량 상한, 플래그 꺼짐 시 GET 처리, 법무 불가 시 일괄 파기 런북, 개인정보 초안에 캡처 항목, task-017 리포트·내보내기에서 캡처 제외.
6. 사람 결정 필요: IFrame API 허용, 이미지 크기·형식 상한, 사용자 총량 상한, 플래그 꺼짐 시 기존 캡처 표시 여부, 캡처 DELETE 노출 면 수용.
