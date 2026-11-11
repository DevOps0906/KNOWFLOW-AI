# 작업 표

권장 순서(실제 제약은 표의 선행): **2026-11-12 사용자 결정: 유튜브 구현 최우선 027 → 028 → 012 → 029 → 030, 기능 플래그 기본 꺼짐·활성화는 025 통과·026 판정 뒤.** 이전 순서: task-002 → (001 · 003 · 006 병행) → 004 → 005 → 007 → 008 → 010 → 032 게이트 무관 기반 → 025 Phase 0(철회 가능) → 031 랜딩 문구(예정 기능만) → 026 법무 게이트 → 027 유튜브 수집 → 011 → 028 공용 청킹 → 012 → 029 요약·장면 카드 → 030 L1 → 009 → W3 → W4 → W5. PDF 경로(011)는 유튜브 게이트와 무관하게 010 뒤 진행할 수 있고, 유튜브 전사는 028에서 011에 연결한다. 유튜브 순서 근거: [ADR-0006](../docs/adr/0006-youtube-summary-and-capture-mvp.md). 설치형 앱(033~035, WA)은 W5의 024 뒤에 진행한다([ADR-0007](../docs/adr/0007-installable-apps.md)). 유튜브를 철회·보류하면 다른 작업의 선행에서 유튜브 작업(027~031)을 빼고, 본문의 유튜브 항목도 제외한 채 진행한다.
마이그레이션: 기존 파일은 고치지 않고 새 번호만 추가한다. 병렬 작업이 동시에 마이그레이션을 쓰면 번호는 팀장이 배정한다. 위험도 높음은 착수 전 challenger, 완료 후 codex-reviewer(code) + reviewer(security/contract).

| 번호 | 제목 | 웨이브 | 선행 | 위험도 | 담당 | 상태 |
|---|---|---|---|---|---|---|
| [task-001](task-001.md) | 랜딩 S-01 + 외부 폼 사전예약(린 검증) | W0 | task-002 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-002](task-002.md) | 저장소 골격(Next.js·pnpm·Tailwind v4·shadcn/ui·토큰) | W1 | — | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-003](task-003.md) | 보안 기본 설정 /secure setup(L1) | W1 | task-002 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-004](task-004.md) | Supabase 마이그레이션 12테이블 + RLS | W1 | task-003 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-005](task-005.md) | 인증 S-02~S-04 | W1 | task-004, task-006 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-006](task-006.md) | 앱 셸·공통 컴포넌트 | W1 | task-002 | 낮음 | builder (+tester) | 완료 |
| [task-007](task-007.md) | 프로젝트 S-05~S-07 · A-02 | W2 | task-004, task-005, task-006 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-008](task-008.md) | PDF 업로드·Storage S-09 · A-04 | W2 | task-007 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-009](task-009.md) | URL 가져오기(SSRF 방어) | W2 | task-010, task-029 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-010](task-010.md) | 작업 큐(테이블 폴링)·Worker 골격·A-05 재시도 | W2 | task-004, task-008 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-011](task-011.md) | 추출·청킹·임베딩·색인 | W2 | task-010 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-012](task-012.md) | 자료 목록·원문 뷰어 S-08 · S-10 · A-03 · A-07 | W2 | task-007, task-011, task-032 | 높음 | builder (+tester) · 착수 전 challenger | 진행 |
| [task-013](task-013.md) | 골든셋 30~50문항 + 평가(임베딩·청킹 확정, 벡터 컬럼·저장 연결) | W3 | task-011 | 보통 | builder (+tester) | 대기 |
| [task-014](task-014.md) | 하이브리드 검색 함수(project_id 강제) | W3 | task-013, task-032 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-015](task-015.md) | 질의응답 A-06(인용 검증) | W3 | task-014, task-032 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-016](task-016.md) | 채팅 UI S-08 | W3 | task-015, task-012 | 보통 | builder (+tester) | 대기 |
| [task-017](task-017.md) | 리포트 생성 작업 A-08 | W4 | task-015 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-018](task-018.md) | 리포트 화면·목록·Markdown 내보내기 S-11 · S-12 · A-09 | W4 | task-017 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-019](task-019.md) | 계정 설정·삭제·소프트 삭제 정리 S-13 · A-10 | W4 | task-012, task-018 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-020](task-020.md) | 요청 한도·사용량 표시(S-13 통합) | W4 | task-004, task-005, task-015, task-017, task-019 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-021](task-021.md) | 오류·404·빈 상태 S-14 · S-15 | W5 | task-006 | 낮음 | builder (+tester) | 완료 |
| [task-022](task-022.md) | E2E F-01~F-05 + 반응형 캡처 | W5 | task-016, task-018, task-019, task-021, task-029 | 보통 | tester (+builder 시드) | 대기 |
| [task-023](task-023.md) | 보안 L2 상향 점검 | W5 | task-020, task-022 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-024](task-024.md) | 베타 배포(인프라 ADR·Worker 배포) | W5 | task-023 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-025](task-025.md) | 유튜브 Phase 0 검증(미달 시 철회) | WY | task-010 | 높음 | builder (+사람 라벨) · 착수 전 challenger | 진행 |
| [task-026](task-026.md) | 법무 게이트(전사 저장·재제공, 프레임 저장) | WY | task-025 | 보통 | 사용자 · 팀장 | 대기 |
| [task-027](task-027.md) | 유튜브 수집(URL 검증·Gemini 분석·시각 검증) | WY | task-010, task-032 (활성화: 025·026 뒤) | 높음 | builder (+tester) · 착수 전 challenger | 진행 |
| [task-028](task-028.md) | 공용 청킹 연결(전사 구간 → task-011 파이프라인) | WY | task-027, task-011 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-029](task-029.md) | 영상 요약·장면 카드(L0)·S-10 플레이어 | WY | task-028, task-012, task-032 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-030](task-030.md) | 사용자 승인 탭 캡처(L1) | WY | task-029 (활성화: 026 뒤) | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-031](task-031.md) | 랜딩 S-01 유튜브 문구 반영(예정 기능만) | WY | task-025 | 낮음 | builder | 대기 |
| [task-032](task-032.md) | 유튜브 게이트 무관 기반(unavailable_at·packages/citations) | WY | task-010 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-033](task-033.md) | Android 셸(Capacitor 원격 셸, APK) | WA | task-024 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-034](task-034.md) | 데스크톱 셸(Tauri 원격 셸, Windows·macOS) | WA | task-024 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-035](task-035.md) | 다운로드 화면 S-18·배포 파이프라인 | WA | task-024, task-033, task-034 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |

상태: 대기 / 진행 / 완료 / 보류

## 발견한 문제 (범위 밖 — 나중 작업 후보)
| 날짜 | 위치 | 내용 | 제안 |
|---|---|---|---|
| 2026-11-06 | task-008 등록 검증 | 매직 바이트 검사에 실패하거나 등록하지 않은 업로드 객체는 Storage에 남는다(사용자 UPDATE·DELETE 정책 없음) | 고아 객체 정리 배치를 task-019(소프트 삭제 정리)에 포함 |
| 2026-11-06 | task-008 content_hash | 등록 시 content_hash는 클라이언트 값(중복 안내용). 신뢰 값은 아님 | Worker가 계산한 해시로 덮어쓰기(task-011) |
| 2026-11-11 | task-010 상태 | 커밋 e6d9734로 임대·상태 전이·재시도 RPC와 Worker 골격은 저장됐으나 표는 "대기", `tasks/NOW.md`는 "다음 작업"이었다. 컨테이너(Dockerfile·compose)·네트워크 제한 검증·A-05 라우트는 저장소에 없고 전체 검증도 미완료 | 상태를 "진행"으로 표시. 완료 조건 전부 확인 뒤 "완료". `tasks/NOW.md`는 팀장이 갱신 |

## 교훈 (다음 작업에 그대로 적용할 것만, 20줄 이내 유지)
- 
