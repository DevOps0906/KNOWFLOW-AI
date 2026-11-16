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

## 구현 결정 (2026-11-17 challenger REVISE 반영, 팀장 확정)
- 사용자 결정(2026-11-17): ① 법무 판정 전이라도 지금 구현하고 캡처 스위치는 끈다(ADR-0006 #2 우선, `05_DATA_MODEL.md#8` 문구 정정). 판정이 "불가"면 drop 마이그레이션으로 되돌린다. ② 사용자가 지운 자료(소프트 삭제)의 캡처는 즉시 삭제 대기로 옮긴다(복구해도 돌아오지 않음).
- 남은 위험: task-025 L1 실측 전 구현이라 실측 결과에 따라 고칠 수 있다. 활성화는 025 통과·026 허용 뒤.
쓰기 범위 추가: `apps/web/src/components/youtube/**`(장면 카드 캡처 버튼), `apps/web/src/components/workspace/viewer/**`, `apps/web/src/server/captures/**`, `supabase/migrations/20261117000100_*`, `docs/05_DATA_MODEL.md#8`(캡처 저장 행만), `docs/04_API.md`(A-11 행만), `docs/runbooks/**`.
1. 테이블 `source_captures`(id, source_id FK sources, user_id, moment_id nullable `on delete set null`, t_seconds, storage_path, status `pending|ready`, idempotency_key, bytes, created_at). 장면 재처리(replace_source_moments)에도 캡처는 남는다. RLS: 소유자 SELECT만(sources 미삭제·`unavailable_at is null` 조건), INSERT·UPDATE·DELETE 정책 없음.
2. 버킷 `captures`(private, 허용 MIME `image/webp`·`image/jpeg`, `file_size_limit` 2MB). authenticated 정책 없음. 업로드·서명·삭제는 서버 service_role만. 경로 `{user_id}/{source_id}/{capture_id}.{ext}`는 DB가 정한다.
3. 이미지 형식·크기(팀장 결정): WebP 또는 JPEG, 2MB 이하, 가로·세로 각 2560 이하. POST는 서버 경유: 바이트 상한으로 스트림을 끊고(413) 매직바이트·헤더 크기 검사(415) 뒤에만 저장.
4. 한도: service_role RPC `reserve_capture(source_id, user_id, t_seconds, moment_id, idempotency_key)`가 sources 행을 `for update`로 잠그고 자료 상태·소유·유튜브 여부 확인 → 같은 멱등 키면 기존 행 반환 → `count < 20`(자료당) 확인 → pending 행 삽입. 업로드 성공 시 `confirm_capture`로 ready, 실패 시 행 삭제. 21장째는 429.
5. 삭제: 삭제 대기 테이블 `capture_purge_queue(storage_path, reason, queued_at)`. sources에 AFTER UPDATE 트리거(`deleted_at` 또는 `unavailable_at`이 null→값) · BEFORE DELETE 트리거가 그 자료의 캡처 경로를 대기열에 넣고 캡처 행을 지운다 → `delete_sources`·`takedown_video`·`apply_source_recheck`를 재정의하지 않고 모두 덮는다. 실제 객체 삭제는 웹 서버 `purgeCaptures()`(service_role Storage, 대기열 처리 후 행 삭제)가 사용자 캡처 삭제·자료 삭제 API 직후와 런북 명령에서 실행한다. GET 서명 전에 자료 상태를 다시 확인한다.
6. 출처 표기: 시각·원본 링크(video_id로 생성)는 항상, 채널명은 메타데이터가 있을 때만(30일 파기 규칙상 캡처 행에 복사하지 않음).
7. 브라우저: `getDisplayMedia({preferCurrentTab:true, selfBrowserSurface:'include'})`, `displaySurface==='browser'` 아니면 저장 없이 중단. `CropTarget`(또는 RestrictionTarget)으로 플레이어 영역만 자르고, 지원하지 않는 브라우저는 진입 숨김. 프레임은 video+canvas(`requestVideoFrameCallback` 있으면 사용) → 미리보기 확인 뒤 업로드. 캡처 직후·화면 이탈 시 트랙 stop. 승인 거부·취소는 저장 없음.
8. 진입 조건: 서버 플래그 `CAPTURE_ENABLED`(기본 꺼짐, `YOUTUBE_ENABLED`와 별개) && 폭 1200 이상 && 기능 감지. API는 플래그 꺼짐이면 모든 호출 422 "지원 예정".
9. 알려진 한계(2026-11-17 리뷰): 서버는 올라온 이미지가 실제 탭 화면인지 검증할 수 없다(형식·크기만). 변조된 클라이언트는 본인 자료에 임의 이미지를 올릴 수 있으나 피해는 본인 데이터에 한정된다. 캡처 시각은 카드 `t_start`로 이동 후 사용자가 미리보기로 확인한 값이다(임베드에서 현재 재생 시각을 읽지 않음). 계정 삭제(cascade)로 생긴 대기열은 다음 purge 실행 때 비운다.
