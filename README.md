# KNOWFLOW-AI

AI 기반 자료 분석·지식 관리 SaaS. PDF와 웹 페이지를 모아 분석하고, 자료에 근거한 질의응답과 출처가 연결된 리포트를 만든다.

핵심 원칙: Source-grounded AI, Evidence-first, Modular Architecture, Contract-driven Multi-agent Development.

## 진행 현황 (2026-11-02 기준)

기획·설계 단계다. 검증 가설, PRD, 화면·API·데이터 명세, 디자인 시안이 "린 검증 통과 전 조건부 초안"으로 있고, 코드는 아직 없다.

| 구분 | 진행률 |
|---|---|
| 전체 프로젝트 | **약 34%** |
| 기획·설계 구간(01~05단계) | **약 76%** |
| 구현(06단계 이후) | 0% |

진행률 근거: SDLC 9단계에 가중치를 두고 단계별 완료도를 곱해 더한 추정값이다(아래 표). 작업 분해 전이라 작업 개수 기준은 아직 쓸 수 없다. 작업 분해 후에는 `tasks/README.md`의 완료 작업 수로 바꾼다.

제한: 고객·가격·통과 기준 수치는 가정이다. 린 검증 결과에 따라 범위가 바뀔 수 있다.

### 개발 단계별 진행률

| 단계 | 가중치 | 완료도 | 기여 | 현재 상태 |
|---|---|---|---|---|
| 01 검증 | 5 | 50% | 2.5 | 문제·고객 가설, 검증 방법(랜딩 사전예약 + 인터뷰 5명), 통과 기준 작성. 실행 전 |
| 02 기획 | 10 | 80% | 8 | PRD 조건부 초안, MVP 범위, 매체 확장 로드맵, 보안 위협 메모. 미결 7건 |
| 03 UX | 10 | 90% | 9 | 화면 15개, 흐름 4개, 상태 정의, 와이어프레임. 필수 구조 누락 0 |
| 04 UI | 10 | 65% | 6.5 | 디자인 토큰(라이트·다크·반응형 3구간), 고해상도 시안 3화면 + 상태, 앱 셸·반응형·인용 상호작용 다이어그램. 팔레트 확정 전 |
| 05 기술 설계 | 10 | 80% | 8 | 아키텍처, API 10개, 테이블 12개, ERD, ADR 1건, 시스템 구조도·시퀀스 3종·상태도·매체 파이프라인. 큐·Worker·임베딩 미정 |
| 06 구현 | 40 | 0% | 0 | 미착수(린 통과 후 작업 분해) |
| 07 QA | 7 | 0% | 0 | 미착수 |
| 08 배포 | 5 | 0% | 0 | 미착수 |
| 09 개선 | 3 | 0% | 0 | 미착수 |
| 합계 | 100 | | **34** | |

### 구현된 주요 항목
- [x] 기획 문서 체계(린 검증 · PRD · 아키텍처 · 화면 · API · 데이터 · ADR)
- [x] 경쟁 제품 벤치마킹(NotebookLM · Readray · Elicit, 매체 비교)
- [x] 디자인 토큰과 고해상도 시안
- [x] 멀티에이전트 개발 환경(NOMAD Agent OS, AGENTS.md)
- [ ] 애플리케이션 코드(미착수)

### 다음 개발 단계
- [ ] 린 검증 실행과 결과 기록
- [ ] PRD 미결 결정(큐 · Worker · 임베딩 · 팔레트 · 테마 · 태블릿 배치 · 리포트 템플릿)
- [ ] 시안 확정(팔레트 A 청록 / B 남색, 서체)
- [ ] 작업 분해(`tasks/`)와 보안 기본 설정
- [ ] 06 구현 착수

## 기획 요약

### 무엇을, 누구에게
| 항목 | 내용 |
|---|---|
| 고객(가정) | 한국어 자료를 조사·정리하는 지식노동자(컨설턴트·기획자·대학원생) |
| 문제 | 자료가 흩어져 있고, AI 답변의 근거를 원문에서 다시 찾아 확인하는 데 시간이 든다 |
| 핵심 가치 | 모든 답변·리포트 문장이 자료의 실제 출처로 연결된다. 근거가 없으면 없다고 말한다 |
| 수익 모델(가정) | 월 구독, 사용량(자료 수·질문 수) 한도로 플랜 구분. 가격은 검증 후 결정 |

### MVP 범위
| 기능 | 내용 |
|---|---|
| 계정 | 이메일 가입·로그인·비밀번호 재설정, 계정 삭제 |
| 프로젝트 | 생성·목록, 빈 프로젝트 만들기 안내 |
| 자료 수집 | PDF 업로드(여러 개), 웹 URL. 처리 상태 표시와 재시도 |
| 질의응답 | 선택한 자료 범위 안에서 답변, 인용 칩, 코드로 인용 검증, 근거 없음 처리 |
| 리포트 | 출처가 연결된 리포트, 문장별 근거 확인, Markdown 내보내기 |
| 한도 | 요청·자료 처리 쿼터 |

### 매체 확장 로드맵 (추후 예정, MVP에서 개발하지 않음)
| 단계 | 매체 | 인용 위치 |
|---|---|---|
| 확장 1 문서 | 텍스트, Word, PPT, HWP·HWPX, TXT·MD, 스캔 PDF·이미지(OCR) | 페이지·문단·슬라이드 |
| 확장 2 음성·영상 | YouTube, 오디오, 영상 파일, 팟캐스트 | 시각(mm:ss) |
| 확장 3 연동 | Excel·CSV, Google Drive·Docs, Zotero, ePub | 시트·셀 범위, 페이지 |
| 검토 후 결정 | 실시간 녹음, 로그인·유료 벽 웹페이지 | 시각, 문단 |

데이터는 `source_type` 예약 값과 `locator` 인용 위치로 미리 확장 가능하게 설계했다([ADR-0001](docs/adr/0001-media-expansion.md)).

### 구조
Next.js 웹과 Route Handler가 인증·검증을 맡고, 장시간 처리(추출·청킹·임베딩)는 작업 큐와 Worker로 넘긴다. Supabase(Postgres·RLS·Storage)와 pgvector 하이브리드 검색을 쓴다. 자세한 내용은 [아키텍처](docs/02_ARCHITECTURE.md)와 [다이어그램](docs/diagrams/README.md)에 있다.

### 디자인
Readray(구 Lilys AI)의 정보 배치를 참고했다. 접히는 사이드바, 자료 목록·원문·채팅 3단, 알약형 컨트롤이 그 구조다. 색과 브랜드는 고유하게 정했다. 흰 종이 바탕에 먹색 글자와 청록 강조색을 쓰고, 형광 노랑은 근거 하이라이트에만 쓴다. shadcn/ui 구조와 Tailwind CSS v4 토큰을 쓴다.

## 콘텐츠 바로가기

| 콘텐츠 | 화면 경로 | 기획·명세 문서 | 구현 코드 |
|---|---|---|---|
| 린 검증 | — | [docs/00_LEAN.md](docs/00_LEAN.md) | — |
| PRD | — | [docs/01_PRD.md](docs/01_PRD.md) | — |
| 아키텍처 | — | [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) | — |
| 다이어그램 | — | [docs/diagrams/](docs/diagrams/README.md) (기능 맵·사이트맵·UI 구조·시스템 구조·시퀀스·상태도, 단계별 목록) | — |
| 화면·UX | 전 화면 | [docs/03_SCREENS_UX.md](docs/03_SCREENS_UX.md) · [design/wireframes/index.html](design/wireframes/index.html) | — |
| API | — | [docs/04_API.md](docs/04_API.md) | — |
| 데이터 | — | [docs/05_DATA_MODEL.md](docs/05_DATA_MODEL.md) · [ERD](docs/diagrams/03-data-model-erd.md) | — |
| 결정 기록 | — | [docs/adr/](docs/adr/0001-media-expansion.md) | — |
| 벤치마킹 | — | [기능](docs/benchmark.md) · [Readray 시각 구조](docs/benchmark-readray.md) · [매체](docs/benchmark-media.md) | — |
| 디자인 | S-07 · S-08 · S-12 | [DESIGN.md](DESIGN.md) · [design/prototype/index.html](design/prototype/index.html) · [design/preview.html](design/preview.html) | [tokens.css](apps/web/src/styles/tokens.css) |
| 청사진 참고 | — | [docs/blueprints/](docs/blueprints/) (NOMAD 모듈, 표 행은 위 문서로 정본화) | — |

## 개발 방식

[NOMAD Agent OS](https://github.com/DevOps0906/nomad-agent-os) 멀티에이전트 팀으로 개발한다. 규칙 정본은 [AGENTS.md](AGENTS.md), 현재 상태는 [tasks/NOW.md](tasks/NOW.md)에 있다. 디자인 공통 기준은 [nomad-design-modules](https://github.com/DevOps0906/nomad-design-modules)를 경로로 인용한다.
