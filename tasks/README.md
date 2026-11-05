# 작업 표

순서: task-002 → (001 · 003 · 006 병행) → 004 → 005 → 007 → 008 → 010 → 009 → 011 → 012 → W3 → W4 → W5.
마이그레이션: 기존 파일은 고치지 않고 새 번호만 추가한다. 병렬 작업이 동시에 마이그레이션을 쓰면 번호는 팀장이 배정한다. 위험도 높음은 착수 전 challenger, 완료 후 codex-reviewer(code) + reviewer(security/contract).

| 번호 | 제목 | 웨이브 | 선행 | 위험도 | 담당 | 상태 |
|---|---|---|---|---|---|---|
| [task-001](task-001.md) | 랜딩 S-01 + 외부 폼 사전예약(린 검증) | W0 | task-002 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-002](task-002.md) | 저장소 골격(Next.js·pnpm·Tailwind v4·shadcn/ui·토큰) | W1 | — | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-003](task-003.md) | 보안 기본 설정 /secure setup(L1) | W1 | task-002 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-004](task-004.md) | Supabase 마이그레이션 12테이블 + RLS | W1 | task-003 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-005](task-005.md) | 인증 S-02~S-04 | W1 | task-004, task-006 | 높음 | builder (+tester) · 착수 전 challenger | 완료 |
| [task-006](task-006.md) | 앱 셸·공통 컴포넌트 | W1 | task-002 | 낮음 | builder (+tester) | 완료 |
| [task-007](task-007.md) | 프로젝트 S-05~S-07 · A-02 | W2 | task-004, task-005, task-006 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-008](task-008.md) | PDF 업로드·Storage S-09 · A-04 | W2 | task-007 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-009](task-009.md) | URL 가져오기(SSRF 방어) | W2 | task-010 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-010](task-010.md) | 작업 큐(테이블 폴링)·Worker 골격·A-05 재시도 | W2 | task-004, task-008 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-011](task-011.md) | 추출·청킹·임베딩·색인 | W2 | task-009, task-010 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-012](task-012.md) | 자료 목록·원문 뷰어 S-08 · S-10 · A-03 · A-07 | W2 | task-007, task-011 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-013](task-013.md) | 골든셋 30~50문항 + 평가(임베딩·청킹 확정, 벡터 컬럼·저장 연결) | W3 | task-011 | 보통 | builder (+tester) | 대기 |
| [task-014](task-014.md) | 하이브리드 검색 함수(project_id 강제) | W3 | task-013 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-015](task-015.md) | 질의응답 A-06(인용 검증) | W3 | task-014 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-016](task-016.md) | 채팅 UI S-08 | W3 | task-015, task-012 | 보통 | builder (+tester) | 대기 |
| [task-017](task-017.md) | 리포트 생성 작업 A-08 | W4 | task-015 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-018](task-018.md) | 리포트 화면·목록·Markdown 내보내기 S-11 · S-12 · A-09 | W4 | task-017 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-019](task-019.md) | 계정 설정·삭제·소프트 삭제 정리 S-13 · A-10 | W4 | task-012, task-018 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-020](task-020.md) | 요청 한도·사용량 표시(S-13 통합) | W4 | task-004, task-005, task-015, task-017, task-019 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-021](task-021.md) | 오류·404·빈 상태 S-14 · S-15 | W5 | task-006 | 낮음 | builder (+tester) | 완료 |
| [task-022](task-022.md) | E2E F-01~F-04 + 반응형 캡처 | W5 | task-016, task-018, task-019, task-021 | 보통 | tester (+builder 시드) | 대기 |
| [task-023](task-023.md) | 보안 L2 상향 점검 | W5 | task-020, task-022 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |
| [task-024](task-024.md) | 베타 배포(인프라 ADR·Worker 배포) | W5 | task-023 | 높음 | builder (+tester) · 착수 전 challenger | 대기 |

상태: 대기 / 진행 / 완료 / 보류

## 발견한 문제 (범위 밖 — 나중 작업 후보)
| 날짜 | 위치 | 내용 | 제안 |
|---|---|---|---|

## 교훈 (다음 작업에 그대로 적용할 것만, 20줄 이내 유지)
- 
