# KNOWFLOW-AI

AI 기반 자료 분석·지식 관리 SaaS. 유튜브 영상 요약과 중요 장면 정리를 최우선으로, PDF와 웹 페이지까지 모아 분석하고, 자료에 근거한 질의응답과 출처가 연결된 리포트를 만든다.

핵심 원칙: Source-grounded AI, Evidence-first, Modular Architecture, Contract-driven Multi-agent Development.

## 화면 미리보기

![KNOWFLOW 워크스페이스 메인 화면](design/screens/s08-workspace-1440.png)

<sub>S-08 워크스페이스(1440px): 왼쪽 자료 목록, 가운데 원문과 근거 하이라이트, 오른쪽 인용 칩이 붙은 질문 답변. 고해상도 시안(`design/prototype`) 캡처이며 실제 앱 화면이 아니다. 유튜브 요약·장면 카드는 시안 이후 기획이라 아직 들어 있지 않다. 맨 위 알약 줄은 시안 화면 전환용이다.</sub>

![KNOWFLOW 프로젝트 목록 화면](design/screens/s07-projects-1440.png)

<sub>S-07 프로젝트 목록(1440px). 표시된 프로젝트와 사용자는 예시 데이터다.</sub>

## 진행 현황 (2026-11-12 기준)

**기획 완료, 구현 진행 중.** 검증 계획, PRD, 화면·API·데이터 명세, 아키텍처, 디자인 시안, 다이어그램, 작업 분해(35개)가 끝났다([ADR-0002](docs/adr/0002-mvp-tech-decisions.md)). 유튜브 요약·중요 장면 정리를 최우선으로 두고([ADR-0006](docs/adr/0006-youtube-summary-and-capture-mvp.md)), 2026-11-12 사용자 결정으로 법무 확인·Phase 0 실측은 **착수 조건이 아니라 기능을 켜는 조건**이 됐다. 유튜브 기능은 플래그 `YOUTUBE_ENABLED`로 기본 꺼져 있다. 설치형 앱(Android·Windows·macOS)은 기획만 끝났고 구현은 베타 배포 뒤다([ADR-0007](docs/adr/0007-installable-apps.md)).

**지금 되는 것:** 가입·로그인, 프로젝트 만들기, PDF 업로드 → Worker가 격리된 파서로 텍스트 추출·청킹·키워드 색인 → 워크스페이스에서 자료 목록·처리 상태·재시도·삭제, 원문 뷰어에서 청크 읽기와 위치 이동. 유튜브는 등록·Gemini 분석(스텁)·전사 청크·장면 카드 저장·21일 재확인까지 코드가 있으나 플래그가 꺼져 있다. **아직 안 되는 것:** 영상 요약·장면 카드 화면, 질의응답, 리포트, 배포.

| 구분 | 진행률 |
|---|---|
| 전체 프로젝트 | **약 56%** (설치형 앱 작업 3개 추가로 분모 증가) |
| 기획·설계 구간(01~05단계) | **약 88%** |
| 구현 작업 | **14 / 35 완료 (40.0%)** · 진행 중 3개(task-025 실측 대기, task-027 활성화 조건 대기, task-029 구현 중) |

진행률 근거: 전체는 SDLC 9단계 가중치 × 단계별 완료도 추정값이다(아래 표). 구현부터는 [작업 표](tasks/README.md)의 완료 작업 수로 센다.

제한: 고객·가격은 가정이고 보안 수치는 베타 초기값이다. 유튜브는 Phase 0(task-025)에서 전사 충실도가 미달하면 철회한다. 유튜브 링크만으로 실제 캡처 이미지를 자동 생성하지 않는다. 화면 캡처 중 구현 화면은 정적 렌더 기준이며 실제 로그인 세션 캡처는 task-022에서 한다.

### 최근 완료 및 진행 중 (2026-11-12)

- **task-011 완료** PDF 추출·청킹·색인: unpdf 파서를 Node `--permission` 하위 프로세스에서 실행(환경 변수 비움·파일·네트워크·자식 프로세스·eval 차단, Docker에서 실제 차단 확인), 해시·매직 바이트·암호화·500쪽 초과·스캔 판정, 작업 펜싱된 청크 교체, 스텁 요약.
- **task-012 완료** 워크스페이스 S-08(데스크톱 3단·태블릿 2단·모바일 단일 열+채팅 시트), 자료 목록(상태 배지·오류 문구·재시도·선택/개별 삭제·처리 중일 때만 폴링), 원문 뷰어 S-10(이어 읽기·`?chunk` 강조·상태 안내), 대시보드 처리 중 자료, 청크 조회·소프트 삭제 RPC.
- **task-027(유튜브 수집) 구현 완료, 활성화 대기**: URL 검증·정규 URL, 영상 시간 월 한도(실패 환불·같은 달 규칙), 서버 전용 등록 RPC, Gemini 분석기(스텁 기본, 실호출 연결만), 20분 분할·시각 검증, 21일 재확인·29일 메타데이터 파기, 큐 함수 작업 유형 분기. **task-028 완료**(전사 → 공용 청킹, `t_start/t_end`).
- **task-029 진행 중**(영상 요약·장면 카드·플레이어): 결정과 분할 확정. 구현 일부는 미검증 상태라 커밋하지 않고 로컬 stash에 보관(`tasks/NOW.md` 참고).
- **설치형 앱 기획**: [ADR-0007](docs/adr/0007-installable-apps.md), task-033 Android(Capacitor)·034 데스크톱(Tauri)·035 다운로드 화면 S-18. 배포된 웹을 띄우는 원격 셸로 먼저 만든다.

### 개발 단계별 진행률

| 단계 | 가중치 | 완료도 | 기여 | 현재 상태 |
|---|---|---|---|---|
| 01 검증 | 5 | 50% | 2.5 | 가설·검증 계획 완료. 실행은 task-001(랜딩 사전예약)로 개발과 병행 |
| 02 기획 | 10 | 100% | 10 | PRD, MVP 범위, 매체 확장 로드맵, 보안 위협 메모. 남은 확인은 유튜브 법무(task-026) |
| 03 UX | 10 | 100% | 10 | 화면 18개(S-18 다운로드 추가), 흐름 6개, 상태 정의, 와이어프레임 |
| 04 UI | 10 | 80% | 8 | 토큰·팔레트·서체 확정, 핵심 3화면 고해상도 시안. 나머지는 구현에서 토큰으로 제작 |
| 05 기술 설계 | 10 | 90% | 9 | 아키텍처·키 경계, API, ERD, 시퀀스·상태도, ADR 7건 |
| 06 구현 | 40 | 40.0% | 16.0 | 작업 14/35 완료 |
| 07 QA | 7 | 0% | 0 | 작업별 리뷰 + task-022·023 |
| 08 배포 | 5 | 0% | 0 | task-024(운영 실행은 사람) |
| 09 개선 | 3 | 0% | 0 | 베타 후 |
| 합계 | 100 | | **55.5** | |

### 작업 진행률 (구현)

| 웨이브 | 작업 | 완료 |
|---|---|---|
| W0 검증 | task-001 | 1 / 1 |
| W1 기반 | task-002~006 | 5 / 5 |
| W2 자료 | task-007~012 | 5 / 6 (task-009 웹 URL만 남음) |
| WY 유튜브 | task-025~032 | 2 / 8 (027 구현 완료·활성화 대기, 029 진행) |
| W3 AI | task-013~016 | 0 / 4 |
| W4 리포트·계정 | task-017~020 | 0 / 4 |
| W5 출시 | task-021~024 | 1 / 4 |
| WA 설치형 앱 | task-033~035 | 0 / 3 (task-024 뒤) |

### 구현된 주요 항목
- [x] 기획 문서 체계(린 검증 · PRD · 아키텍처 · 화면 · API · 데이터 · ADR)
- [x] 디자인 토큰과 고해상도 시안, 다이어그램 구조도
- [x] 멀티에이전트 개발 환경(NOMAD Agent OS, AGENTS.md)
- [x] 저장소 골격(Next.js 16.4 · Tailwind CSS 4.3 · Vitest · pnpm · CI · 보안 헤더), 보안 L1
- [x] 앱 셸·공통 컴포넌트, 오류·404 화면, 랜딩 사전예약(외부 폼 연결 대기)
- [x] DB 마이그레이션·RLS·기반 RPC, 인증·프로젝트·PDF 업로드
- [x] 작업 큐·Worker 컨테이너·외부 연결 격리·재시도, 인용 검증 공용 패키지
- [x] PDF 추출·청킹·색인(격리 파서), 워크스페이스·원문 뷰어·자료 삭제
- [x] 유튜브 수집·분석(스텁)·전사 청킹·재확인·파기(플래그 꺼짐)
- [x] 설치형 앱 기획(ADR-0007, task-033~035)
- [ ] 영상 요약·장면 카드 화면, 검색·질의응답·리포트, 배포, 설치형 앱

### 남은 개발 단계 (권장 순서)
1. **유튜브 마무리:** task-029 요약·장면 카드·플레이어(진행 중) → task-030 사용자 승인 화면 캡처 → task-031 랜딩 문구
2. **유튜브 활성화 조건:** task-025 실측, task-026 법무, 사용자별 videos.list 호출 제한, 서비스 일일 비용 상한, Gemini 실호출 스모크
3. **AI 질의응답(W3):** task-013 골든셋·임베딩 확정 → task-014 하이브리드 검색 → task-015 질의응답 → task-016 채팅 화면
4. **리포트·계정(W4):** task-017 → task-018 → task-019 → task-020
5. **출시(W5):** task-009 웹 URL 수집 → task-022 E2E·반응형 → task-023 보안 L2 → task-024 베타 배포
6. **설치형 앱(WA):** task-033 Android → task-034 데스크톱 → task-035 다운로드 화면·배포 파이프라인

### 사람이 해야 진행되는 일
- [ ] 이 PC의 Node를 26.13.0으로 올리기(24에서는 PDF 격리 테스트가 실패하도록 막혀 있음)
- [ ] 권리 있는 공개 영상 10편·정답 라벨 준비, 판정 기준 승인(task-025)
- [ ] 변호사 또는 YouTube API 지원팀에 전사·프레임 저장 확인(task-026)
- [ ] 개발용 Supabase 프로젝트 생성(실제 Storage·인증 통합 검증)
- [ ] 루트 `.env.example`에 `KF_DB_SUPERUSER_PASSWORD`·`WORKER_DB_PASSWORD`·`KF_DB_HOST_PORT`·`YOUTUBE_METADATA_PROVIDER`·`YOUTUBE_WORKER_API_KEY` 이름 추가
- [ ] `apps/web/.env.example`에서 `SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_` 접두사가 없고 값이 비어 있는지 확인
- [ ] MVP 완성 단계에서 결정: 권리자 신고 이메일 주소, 약관·개인정보 초안 공개 여부, 설치형 앱 서명 인증서·계정(ADR-0007 열린 결정)
- [ ] 사전예약 폼 서비스 정하기, GitHub 보안 설정 켜기(docs/security/L2-checklist.md)

## 로컬 개발 및 검증

저장소에 고정된 Node·pnpm 버전은 [AGENTS.md](AGENTS.md)를 따른다. 루트에서 실행한다.

```sh
pnpm install
pnpm dev
```

| 목적 | 명령 |
|---|---|
| 린트·타입 검사 | `pnpm lint` · `pnpm typecheck` |
| 웹 테스트 | `pnpm test` |
| DB 통합 테스트 | `pnpm test:db` |
| Worker 단위 테스트 | `pnpm --filter worker test` |
| 전체 빌드 | `pnpm build` |
| Worker 실행(빌드 후) | `pnpm --filter worker start` |

DB 테스트는 기본적으로 임시 내장 PostgreSQL을 사용한다. 외부 DB를 지정할 때는 위의 전용 테스트 DB 조건을 따른다. Worker 실행에는 `DATABASE_URL`이 필요하며 기본 DB 역할은 `service_role`이다. 연결 정보는 Worker 전용 환경에만 설정한다. `WORKER_DUMMY_HANDLERS=1`은 더미 작업의 상태 전이 검증용이며 실제 자료 처리는 아직 구현하지 않았다.

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
| 유튜브(최우선) | 공개 영상 요약과 시각 인용, 중요 장면 카드(클릭 시 그 시각부터 재생). 실제 화면 캡처는 법무 확인 후 |
| 자료 수집 | PDF 업로드(여러 개), 웹 URL. 처리 상태 표시와 재시도 |
| 질의응답 | 선택한 자료 범위 안에서 답변, 인용 칩, 코드로 인용 검증, 근거 없음 처리 |
| 리포트 | 출처가 연결된 리포트, 문장별 근거 확인, Markdown 내보내기 |
| 한도 | 요청·자료 처리 쿼터 |

### 매체 확장 로드맵 (추후 예정, MVP에서 개발하지 않음)
| 단계 | 매체 | 인용 위치 |
|---|---|---|
| 확장 1 문서 | 텍스트, Word, PPT, HWP·HWPX, TXT·MD, 스캔 PDF·이미지(OCR) | 페이지·문단·슬라이드 |
| 확장 2 음성·영상 | 오디오, 영상 파일, 팟캐스트 | 시각(mm:ss) |
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
| 자료 처리·워크스페이스 | S-08 · S-10 | [task-011](tasks/task-011.md) · [task-012](tasks/task-012.md) | [apps/worker/src/pdf](apps/worker/src/pdf) · [apps/worker/src/ingest](apps/worker/src/ingest) · [components/workspace](apps/web/src/components/workspace) |
| 유튜브 수집 | S-09 | [task-027](tasks/task-027.md) · [검토](docs/youtube-mvp-review.md) | [server/youtube](apps/web/src/server/youtube) · [apps/worker/src/youtube](apps/worker/src/youtube) |
| 결정 기록 | — | [ADR-0001 매체 확장](docs/adr/0001-media-expansion.md) · [ADR-0002 MVP 결정](docs/adr/0002-mvp-tech-decisions.md) · [ADR-0006 유튜브](docs/adr/0006-youtube-summary-and-capture-mvp.md) · [ADR-0007 설치형 앱](docs/adr/0007-installable-apps.md) | — |
| 작업 | — | [tasks/README.md](tasks/README.md) (35개, 웨이브 W0~W5·WY·WA) · [현재 상태](tasks/NOW.md) | — |
| 벤치마킹 | — | [기능](docs/benchmark.md) · [Readray 시각 구조](docs/benchmark-readray.md) · [매체](docs/benchmark-media.md) | — |
| 디자인 | S-07 · S-08 · S-12 | [DESIGN.md](DESIGN.md) · [design/prototype/index.html](design/prototype/index.html) · [design/preview.html](design/preview.html) | [tokens.css](apps/web/src/styles/tokens.css) |
| 청사진 참고 | — | [docs/blueprints/](docs/blueprints/) (NOMAD 모듈, 표 행은 위 문서로 정본화) | — |

## 개발 방식

[NOMAD Agent OS](https://github.com/DevOps0906/nomad-agent-os) 멀티에이전트 팀으로 개발한다. 규칙 정본은 [AGENTS.md](AGENTS.md), 현재 상태는 [tasks/NOW.md](tasks/NOW.md)에 있다. 디자인 공통 기준은 [nomad-design-modules](https://github.com/DevOps0906/nomad-design-modules)를 경로로 인용한다.
