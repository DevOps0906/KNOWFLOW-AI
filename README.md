# KNOWFLOW-AI

AI 기반 자료 분석·지식 관리 SaaS. PDF와 웹 페이지를 모아 분석하고, 자료에 근거한 질의응답과 출처가 연결된 리포트를 만든다.

핵심 원칙: Source-grounded AI, Evidence-first, Modular Architecture, Contract-driven Multi-agent Development.

## 진행 현황 (2026-11-02 기준)

**기획 단계 완료.** 검증 계획, PRD, 화면·API·데이터 명세, 아키텍처, 디자인 시안, 다이어그램, 작업 분해(24개)가 끝났고 결정 항목은 모두 확정됐다([ADR-0002](docs/adr/0002-mvp-tech-decisions.md)). 다음은 구현(06단계)이다. 린 검증은 사용자 결정으로 개발과 병행하며, 첫 작업 묶음에서 랜딩 사전예약으로 실행한다.

| 구분 | 진행률 |
|---|---|
| 전체 프로젝트 | **약 48%** |
| 기획·설계 구간(01~05단계) | **약 88%** (남은 몫은 작업으로 넘긴 검증 실행·측정 확정) |
| 구현 작업 | **5 / 24 완료 (21%)** · task-004 진행 중(중단, `wip/task-004` 브랜치) |

진행률 근거: 전체는 SDLC 9단계 가중치 × 단계별 완료도 추정값이다(아래 표). 구현부터는 [작업 표](tasks/README.md)의 완료 작업 수로 센다.

제한: 고객·가격은 가정이고, 보안 수치는 베타 초기값(보수적 추정)이다. 린 검증과 베타 사용량으로 조정한다.

### 중단 지점 (2026-11-02)

- task-004(Supabase 마이그레이션·RLS·기반 RPC)를 진행하다 멈췄다. 마이그레이션 6개와 DB 테스트 하네스 일부가 `wip/task-004` 브랜치에 있고, 아직 검증하지 않았다.
- Docker가 없어 DB 테스트는 embedded-postgres + Supabase 호환 스크립트로 하기로 했다([ADR-0005](docs/adr/0005-db-test-harness-and-queue.md)). 큐는 pgmq 대신 테이블 폴링이다.
- 다시 시작: `git switch wip/task-004` → task-004 완료 조건(`pnpm test:db`·동시성·게이트 테스트) 마무리 → 리뷰 → master 병합.

### 개발 단계별 진행률

| 단계 | 가중치 | 완료도 | 기여 | 현재 상태 |
|---|---|---|---|---|
| 01 검증 | 5 | 50% | 2.5 | 가설·검증 계획 완료. 실행은 task-001(랜딩 사전예약)로 개발과 병행 |
| 02 기획 | 10 | 100% | 10 | PRD, MVP 범위, 매체 확장 로드맵, 보안 위협 메모·베타 초기값. 미결 0건 |
| 03 UX | 10 | 100% | 10 | 화면 15개, 흐름 4개, 상태 정의, 와이어프레임. 필수 구조 누락 0 |
| 04 UI | 10 | 80% | 8 | 토큰·팔레트 A·서체 확정, 핵심 3화면 고해상도 시안. 나머지 화면은 구현 작업에서 토큰으로 제작 |
| 05 기술 설계 | 10 | 90% | 9 | 아키텍처·키 경계, API 10개, 테이블 13개, ERD, 시퀀스·상태도, ADR 2건. 호스팅(ADR-0003)·임베딩(ADR-0004)은 해당 작업에서 측정 후 기록 |
| 06 구현 | 40 | 21% | 8.3 | 작업 5/24 완료(골격·랜딩·보안 L1·앱 셸·오류 화면), DB 작업 진행 중 |
| 07 QA | 7 | 0% | 0 | 작업별 리뷰 + task-022·023 |
| 08 배포 | 5 | 0% | 0 | task-024(운영 실행은 사람) |
| 09 개선 | 3 | 0% | 0 | 베타 후 |
| 합계 | 100 | | **47.8** | |

### 작업 진행률 (구현)

| 웨이브 | 작업 | 완료 |
|---|---|---|
| W0 검증 | task-001 | 1 / 1 |
| W1 기반 | task-002~006 | 3 / 5 |
| W2 자료 | task-007~012 | 0 / 6 |
| W3 AI | task-013~016 | 0 / 4 |
| W4 리포트·계정 | task-017~020 | 0 / 4 |
| W5 출시 | task-021~024 | 1 / 4 |

### 구현된 주요 항목
- [x] 기획 문서 체계(린 검증 · PRD · 아키텍처 · 화면 · API · 데이터 · ADR)
- [x] 경쟁 제품 벤치마킹(NotebookLM · Readray · Elicit, 매체 비교)
- [x] 디자인 토큰과 고해상도 시안, 다이어그램 구조도
- [x] 작업 분해 24개(문서 리뷰 · 사전 공격 반영)
- [x] 멀티에이전트 개발 환경(NOMAD Agent OS, AGENTS.md)
- [x] 저장소 골격(Next.js 16.4 · Tailwind CSS 4.3 · Vitest · pnpm 작업 공간 · CI · 보안 헤더)
- [x] 랜딩 사전예약 페이지(외부 폼 연결 대기)
- [x] 보안 L1(gitleaks CI·Dependabot·SECURITY.md·커밋 전 훅)
- [x] 앱 셸·공통 컴포넌트(반응형 사이드바·시트·상태·배지·테마)
- [x] 오류·404 화면(내부 정보 비노출)
- [ ] DB 마이그레이션·RLS·기반 RPC(task-004, 진행 중)
- [ ] 애플리케이션 기능 코드

### 다음 개발 단계
- [ ] 사용자 작업: 사전예약 폼 서비스 정하기(preorder.ts 두 줄), GitHub 보안 설정 켜기(docs/security/L2-checklist.md)
- [ ] W1 남은 작업: task-004 DB와 RLS → task-005 인증
- [ ] W2~W5 순서대로 진행

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
| 결정 기록 | — | [ADR-0001 매체 확장](docs/adr/0001-media-expansion.md) · [ADR-0002 MVP 결정](docs/adr/0002-mvp-tech-decisions.md) | — |
| 작업 | — | [tasks/README.md](tasks/README.md) (24개, 웨이브 W0~W5) | — |
| 벤치마킹 | — | [기능](docs/benchmark.md) · [Readray 시각 구조](docs/benchmark-readray.md) · [매체](docs/benchmark-media.md) | — |
| 디자인 | S-07 · S-08 · S-12 | [DESIGN.md](DESIGN.md) · [design/prototype/index.html](design/prototype/index.html) · [design/preview.html](design/preview.html) | [tokens.css](apps/web/src/styles/tokens.css) |
| 청사진 참고 | — | [docs/blueprints/](docs/blueprints/) (NOMAD 모듈, 표 행은 위 문서로 정본화) | — |

## 개발 방식

[NOMAD Agent OS](https://github.com/DevOps0906/nomad-agent-os) 멀티에이전트 팀으로 개발한다. 규칙 정본은 [AGENTS.md](AGENTS.md), 현재 상태는 [tasks/NOW.md](tasks/NOW.md)에 있다. 디자인 공통 기준은 [nomad-design-modules](https://github.com/DevOps0906/nomad-design-modules)를 경로로 인용한다.
