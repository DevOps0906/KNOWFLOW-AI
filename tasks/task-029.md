# task-029 WY 영상 요약·장면 카드(L0)·S-10 플레이어
| 항목 | 내용 |
|---|---|
| 웨이브·선행 | WY · task-028, task-012, task-032 |
| 위험도·보안 영향 | 높음 · 노출 면·키·권한 (임베드 플레이어, AI 공급자 키, 비신뢰 전사) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `docs/youtube-mvp-review.md#4`, `docs/youtube-mvp-review.md#5`, `docs/youtube-mvp-review.md#1`(임베드 의무), `spec S-10`, `docs/diagrams/02-rag-and-job-flow.md#4` |
| 쓰기 허용 | `apps/worker/src/summary/**`, `apps/web/src/app/(app)/sources/[sourceId]/**`(S-10은 task-012 소유, 플레이어·장면 카드 연결만), `apps/web/src/app/api/sources/[sourceId]/moments/**`(A-07), `apps/web/src/components/youtube/**`, `apps/web/src/app/(marketing)/terms/**`, `apps/web/src/app/(marketing)/privacy/**`, S-16·S-17 링크만: `apps/web/src/app/(marketing)/page.tsx`(S-01)·`apps/web/src/app/(auth)/login/page.tsx`(S-02)·`apps/web/src/app/(auth)/signup/page.tsx`(S-03), `supabase/migrations/**`(새 번호만). `packages/citations/**`는 task-032 소유(import만) |
| 할 것 | 저장된 청크만 입력한 별도 LLM 요약, 실제 `chunk_id` 인용과 코드 검증, S-10 임베드 플레이어·L0 장면 카드(해당 시각 재생), "AI 전사"·"AI가 본 장면, 전사 근거 아님" 표시, 채널명·원본 링크, 권리자 삭제 요청 창구, 약관·개인정보처리방침 화면, A-07 `/moments` 라우트, S-01·S-02·S-03에 S-16·S-17 링크, 장면 카드 겹침 판정 함수 |
| 하지 않을 것 | 썸네일 서버 프록시·`next/image`, 긴 원문 인용, 겹치는 청크 없는 카드의 리포트 인용, L1 캡처(task-030) |
| 완료 조건 | [ ] 테스트: 검색되지 않은 `chunk_id` 인용 거부 [ ] 테스트: 카드 클릭 시 해당 시각 재생 인자 전달 [ ] 단위 테스트: 겹침 판정 함수(겹치는 청크 없으면 인용 불가, 리포트 통합 테스트는 task-017) [ ] `unavailable_at` 자료 제외 [ ] 3구간 화면 캡처 [ ] `pnpm test` · `pnpm --filter worker test` 통과 |
| 공유 | 인용 검증은 task-032의 `packages/citations` 순수 함수를 재사용한다(task-015와 공용, 이 작업에서 새로 만들지 않음) |

## 구현 결정 (2026-11-12 challenger 반영, 팀장 확정)
분할: **029a** DB·Worker 요약(스텁)·겹침 함수, **029c** S-16·S-17·링크·권리자 처리(병렬) → **029b** /moments·플레이어·장면 카드·AI 표시.
쓰기 범위 추가: `apps/web/src/components/workspace/viewer/**`(029b), `packages/citations/**`(겹침 함수 추가만, 기존 API 변경 금지), `supabase/migrations/20261112000400_*`(029a)·`20261112000500_*`(029c), `packages/db-tests/**`, `docs/runbooks/**`(029c).
1. 영상 요약 저장: `source_summaries`(source_id 1:1, job_id, `sentences jsonb [{text, chunk_ids[]}]`, model, created_at). RLS 소유자 읽기만, sources와 같은 미삭제·`unavailable_at is null` 조건(DB 테스트). 쓰기는 service_role RPC `save_source_summary(job_id, sentences)`: job이 그 자료의 최신 완료 source_ingest 작업이고 모든 chunk_id가 지금 그 자료의 청크일 때만 저장. 새 마이그레이션에서 `replace_source_chunks`를 재정의해 같은 트랜잭션에서 그 자료의 요약을 지운다(재처리 시 낡은 인용 차단).
2. 요약 생성: Worker 후행 단계, 스텁 공급자만(실호출은 task-015 공급자 인터페이스 뒤). 입력 청크는 영상 전체에서 고르게 표본(앞부분만 아님), allowedChunks는 실제로 보낸 청크. 문장별 verifyCitations: 거부된 ID는 빼고, 유효 인용 0건 문장은 버리고, 남은 문장이 없으면 저장 안 함. 요약 문장이 한 청크와 연속 100자 이상 같으면 그 문장 버림(긴 원문 인용 금지). 스텁도 실제 chunk_id를 인용.
3. 겹침 함수: `packages/citations`에 `overlappingChunks(moment, chunks)` 추가. 반열린 구간 [t_start, t_end), 맞닿음은 겹침 아님, 겹치는 청크 전부를 겹친 길이 내림차순으로. 겹치는 청크 없으면 인용 불가.
4. 플레이어: `youtube-nocookie.com/embed/<id>?start=N&autoplay=1` iframe src 교체로 시각 이동(IFrame API 스크립트·postMessage 없음). video_id는 렌더 때 11자 정규식 재확인. referrerpolicy 기본값 유지. 장면 카드에 썸네일 없음(CSP·국외 이전 고지 문제 회피). 기존 CSP(frame-ancestors만) 변경 없음.
5. 플래그 꺼짐: 플레이어·장면 카드·요약 숨기고 "유튜브 기능 준비 중". `/moments`는 `{enabled:false}`. 비활성 자료는 메타와 `unavailable:true`만(장면 0건과 구분).
6. 비신뢰 렌더: 요약·장면 제목/설명은 React 텍스트만, 양방향·zero-width 제거, dangerouslySetInnerHTML 금지 검사를 `components/youtube/**`까지.
7. 권리자 처리: 약관·개인정보 화면에 신고 이메일(설정값 `RIGHTS_CONTACT_EMAIL`, 주소는 사용자 결정) 안내. S-10의 "권리자 신고" 링크는 두지 않는다. 운영자용 service_role RPC `takedown_video(video_id, reason)`: 모든 사용자의 해당 video_id 자료에 unavailable_at 설정 + 청크·장면·요약 삭제, 감사 기록. `docs/runbooks/rights-takedown.md`에 접수→확인→실행→회신 절차.
8. 약관·개인정보처리방침: 문구 초안, 화면 상단 "초안" 표시. 국외 이전(Google·Gemini) 고지 항목 포함. 공개 배포 여부는 사용자 결정.
9. 범위 밖: S-10의 리포트 포함 체크·선택 카드 리포트 생성(task-017), L1 캡처(task-030), 실제 요약 공급자.
- 보류(2026-11-12 사용자 결정): 권리자 신고 이메일 주소와 약관·개인정보 초안 공개 여부는 MVP 완성 단계에서 다시 결정. 그때까지 이메일은 "준비 중" 표시, 화면은 "초안" 표시 유지.
