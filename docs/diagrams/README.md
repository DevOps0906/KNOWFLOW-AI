# 다이어그램 구조도 (v1.1 초안)

KNOWFLOW AI 개발 기준 문서 v1.0(KF-DES-001, KF-ARC-001, KF-AGT-001)을 다이어그램으로 구조화하고, 검토에서 나온 보강안(v1.1 제안)을 함께 표시한 문서 묶음이다. 모든 다이어그램은 Mermaid이며 GitHub에서 바로 렌더링된다. 상태는 설계 초안이고 코드는 포함하지 않는다.

## 1. 문서 목록

| 파일 | 내용 | 다이어그램 |
|---|---|---|
| [01-system-architecture.md](01-system-architecture.md) | 시스템 구조, 구성 요소 책임, 경계 규칙, 미정 항목 | 구성도 1 |
| [02-rag-and-job-flow.md](02-rag-and-job-flow.md) | 자료 수집 파이프라인, 처리 상태 전이, 질의응답 순서(인용 검증), 출처 계약 | 흐름도 1, 상태도 1, 시퀀스 1 |
| [03-data-model-erd.md](03-data-model-erd.md) | ERD, v1.0 대비 변경, RLS 원칙 | ERD 1 |
| [04-screen-map-and-layout.md](04-screen-map-and-layout.md) | 화면 이동, 화면별 패턴·시각, Lilys AI 벤치마킹 대응, 반응형 3구간과 글꼴 | 이동도 1, 레이아웃 3 |
| [05-multi-agent-workflow.md](05-multi-agent-workflow.md) | 역할, 작업 1건 흐름, 승인 게이트, 작업 ID, 병렬 규칙 | 흐름도 3 |

## 2. 표기 규칙

| 표기 | 뜻 |
|---|---|
| 제안 | v1.0에 없는 v1.1 보강안. 근거가 약하거나 수치가 없으면 Gate에서 확정 |
| 미확인 | 확인하지 않은 외부 사실이나 측정 전 값 |
| 점선 화살표 | 01 구성도에서 v1.1 제안 구성 요소 |

## 3. 참고 자료

| 자료 | 사용한 부분 |
|---|---|
| KNOWFLOW AI 개발 기준 문서 v1.0 (사용자 제공 docx·pdf) | 전체 구조의 기준 |
| platform-docs 저장소 `products/_design-guide/DASHBOARD_PATTERNS.md`, `DASHBOARD_VISUAL.md`, `DESIGN_SYSTEM.md` | 화면 구조 패턴(A~O), 시각 아키타입(V-A~V-N), 토큰·반응형 규칙 |
| platform-docs `README.md` 6장 | task 폴더, 웨이브, 계획 공격·리뷰 방식 |
| Lilys AI 공개 변경 기록·사용 가이드 | 결과 화면 구조, AI 채팅 패널, 라이브러리 구조. 공개된 화면과 사용 흐름만 참고하고 내부 구현을 추정하거나 복제하지 않았다 |

## 4. v1.0 대비 보강 요약 (제안)

| 영역 | 보강 |
|---|---|
| RAG | 하이브리드 검색, 인용 검증 단계, 근거 부족 처리, 골든셋 30~50개 |
| 데이터 | report_citations, plans, user_quotas, content_hash, embedding_model, 전문검색 컬럼 |
| 화면 | 비밀번호 재설정, 온보딩, 404·오류 페이지, 반응형 3구간과 구간별 글꼴 |
| 비용 | 쿼터·rate limit, 모델 라우팅, 작업당 토큰 예산 |
| 에이전트 | 계획 공격 단계, 1 작업 = 1 계약 = 1 PR, git worktree 병렬 분리, CLAUDE.md와 AGENTS.md 연결 |

## 5. 다음 단계

| 순서 | 작업 |
|---|---|
| 1 | 이 구조도 검토 후 열린 결정 확정 (04장 7절 디자인 결정 3개, 01장 4절 미정 3개) |
| 2 | 대시보드 디자인안 (Lilys AI 벤치마킹 반영, 화면별 와이어프레임) |
| 3 | 개발기획서 v1.1 (일정, Phase 0 검증, 쿼터·요금 초안) |
| 4 | AGENTS.md 보완과 작업 계약 목록 |
