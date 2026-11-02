# 다이어그램 구조도 (v1.1 초안)

KNOWFLOW AI 개발 기준 문서 v1.0(KF-DES-001, KF-ARC-001, KF-AGT-001)을 다이어그램으로 구조화하고, 검토에서 나온 보강안(v1.1 제안)을 함께 표시한 문서 묶음이다. 모든 다이어그램은 Mermaid이며 GitHub에서 바로 렌더링된다. 상태는 설계 초안이고 코드는 포함하지 않는다.

## 1. 문서 목록

### 1-1. 설명 문서 (v1.1 초안)
| 파일 | 내용 |
|---|---|
| [01-system-architecture.md](01-system-architecture.md) | 시스템 구조, 구성 요소 책임, 경계 규칙, 미정 항목 |
| [02-rag-and-job-flow.md](02-rag-and-job-flow.md) | 자료 수집 파이프라인, 처리 상태 전이, 질의응답 순서(인용 검증), 출처 계약 |
| [03-data-model-erd.md](03-data-model-erd.md) | ERD(locator·작업 필드 반영), v1.0 대비 변경, RLS 원칙 |
| [04-screen-map-and-layout.md](04-screen-map-and-layout.md) | 화면 이동, 화면별 패턴, 반응형(디자인 시안 기준으로 갱신), 글꼴 |
| [05-multi-agent-workflow.md](05-multi-agent-workflow.md) | 역할, 작업 1건 흐름, 승인 게이트, 병렬 규칙 |

### 1-2. Mermaid 원본 (`.mmd`, 단계별)
| 단계 | 파일 | 종류 | 내용 |
|---|---|---|---|
| 02 기획 | [feature-map.mmd](feature-map.mmd) | mindmap | MVP 기능과 추후 매체 확장 1·2·3 |
| 03 UX | [sitemap.mmd](sitemap.mmd) | flowchart | 화면 15개 이동(사양 생성기 자동) |
| 03 UX | [flow-F-01.mmd](flow-F-01.mmd) ~ [flow-F-04.mmd](flow-F-04.mmd) | flowchart | 사용자 흐름 4개(자동) |
| 03 UX | [screen-data.mmd](screen-data.mmd) | flowchart | 화면 ↔ API ↔ 데이터 연결(자동) |
| 04 UI | [ui-app-shell.mmd](ui-app-shell.mmd) | flowchart | 앱 셸과 shadcn/ui 컴포넌트 배치(S-07·S-08·S-12) |
| 04 UI | [ui-responsive.mmd](ui-responsive.mmd) | flowchart | 데스크톱 3단 / 태블릿 2단 / 모바일 1단 + 시트 |
| 04 UI | [ui-citation.mmd](ui-citation.mmd) | sequence | 인용 칩 → 근거 하이라이트, 리포트 문장 → 출처 패널 |
| 05 기술 | [architecture.mmd](architecture.mmd) | flowchart | 시스템 아키텍처(매체 확장은 점선) |
| 05 기술 | [seq-ingest.mmd](seq-ingest.mmd) | sequence | 자료 추가 → 작업 → Worker 처리 |
| 05 기술 | [seq-ask.mmd](seq-ask.mmd) | sequence | 질문 → 검색 → 생성 → 인용 검증 |
| 05 기술 | [seq-report.mmd](seq-report.mmd) | sequence | 리포트 생성 작업과 인용 검증 |
| 05 기술 | [state-source-job.mmd](state-source-job.mmd) | state | 작업 5상태 ↔ 자료 4상태 매핑 |
| 05 기술 | [media-pipeline.mmd](media-pipeline.mmd) | flowchart | 매체별 처리 단계(MVP 실선, 추후 점선) |

ERD 원본은 코드가 생기면 `sql2erd`로 `erd.mmd`를 기계 생성한다. 배포 구조도는 08 배포 단계에서 만든다. 렌더링 SVG는 커밋하지 않는다(GitHub가 Mermaid를 직접 그린다).

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
| `nomad-design-modules/_design-guide/DASHBOARD_PATTERNS.md`, `DASHBOARD_VISUAL.md`, `DESIGN_SYSTEM.md` (디자인 정본, 옛 platform-docs 위치에서 이전) | 화면 구조 패턴(A~O), 시각 아키타입(V-A~V-N), 토큰·반응형 규칙 |
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
| 1 | 사용자 결정(팔레트·PRD 미결·데이터 미정)과 린 검증 |
| 2 | 작업 분해 후 구현, 코드 생성 시 `sql2erd`·`deps2mmd`로 ERD·모듈 구조도 기계 생성 |
| 3 | 08 배포 단계에서 배포 구조도 추가 |
