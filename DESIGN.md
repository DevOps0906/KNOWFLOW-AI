# DESIGN — KNOWFLOW-AI

> 정답 소스: `apps/web/src/styles/tokens.css`(Tailwind CSS v4 `@theme`, shadcn/ui 변수 이름). 이 문서의 수치 표는 사본이며 `docs/DESIGN_TOKENS.md`로 자동 생성한다.
> 공통 기준: `nomad-design-modules/_design-guide/DESIGN_PRINCIPLES.md` 7단계 · `REFERENCES.md` 금지 4종. 구조 레퍼런스: `docs/benchmark-readray.md`.

## 1. 브리프 (팀장, 2026-11-02)
| 항목 | 내용 |
|---|---|
| 대상 | 한국어 자료를 오래 읽고 정리하는 지식노동자(컨설턴트·기획자·대학원생) |
| 주된 일 | 자료를 모으고, 질문하고, 답의 근거를 원문에서 바로 확인한다 |
| 분위기 3단어 | 차분한 · 정밀한 · 종이 같은 |
| 구조 | Readray(구 Lilys AI)의 정보 배치를 따른다: 접히는 사이드바 · 자료 라이브러리 · 리포트 옆 원문 뷰어 · 우측 채팅(좁으면 하단 시트). 픽셀 트레이싱·로고·카피·색 조합은 가져오지 않는다 |
| 컴포넌트 | shadcn/ui 구조(Sidebar · Card · Tabs · Badge · Sheet · ResizablePanelGroup · Command · ScrollArea · Tooltip · Dialog) |
| 대담함의 위치 | 하나만: **근거 하이라이트**(인용 칩을 누르면 원문 구절이 형광펜처럼 칠해진다). 나머지는 조용하게 |
| 피할 것 | 보라·핑크 그라디언트(AI 보라), 똑같은 카드 격자, 모든 카드의 그림자·hover 효과, 대문자 아이브로 라벨, 장식 번호 |
| 색 방향(제안) | 흰 종이 바탕 + 먹색 글자 + 청록 잉크 강조 1색 + 형광 노랑은 근거 하이라이트 전용. 기존 보라 #5B5BD6 제안은 철회(다른 NOMAD 제품 보라와 겹침, 안티패턴) |
| 서체(제안) | UI·본문 Pretendard, 원문 뷰어·리포트 본문 Noto Serif KR(읽기 영역만), 숫자는 tabular-nums |
| 테마·반응형(제안) | 라이트 기본, 다크 2차. 태블릿은 2분할(원문+채팅, 사이드바 아이콘으로 접힘), 모바일은 단일 열 + 채팅 하단 시트 |

## 2. 레이아웃 계획 (팀장 결정, 구조 근거 `docs/benchmark-readray.md`)
| 화면 | 데스크톱 1200~ | 태블릿 768~1199 | 모바일 ~767 |
|---|---|---|---|
| 앱 셸 | 전역 상단바 없음. 좌측 Sidebar 약 17%(로고·새 프로젝트·검색 Command·프로젝트·리포트·하단 사용량 Progress·계정) | Sidebar 아이콘만(접힘) | Sidebar는 Sheet(햄버거) |
| S-07 프로젝트 목록 | 가운데 좁은 단(최대 폭 제한). 제목 + 알약 Select 필터 2개 + 검색·정렬 아이콘. 구분선 없는 행: 유형 아이콘 · 제목 / 보조 회색 "자료 N개 · 수정일" / 우측 상태 Badge. hover 시 체크박스 | 같음 | 같음, 행 2줄 |
| S-08 워크스페이스 | ResizablePanelGroup 3단 ≈ 30 : 45 : 25 — ① 자료 목록(유형 필터 칩·선택 체크로 질의 범위·처리 상태 Badge) ② 요약/원문 Tabs(원문은 세리프, **근거 하이라이트**) ③ 채팅(답변 안 인용 칩 [1] hover Tooltip, 추천 질문 테두리 알약 세로 쌓기, 생성 단계 표시, 하단 알약 입력창 + 원형 보내기) | 2단: ②+③, ①은 Sheet | 단일 열 ②, 채팅은 하단 Sheet(드로어) |
| S-12 리포트 | 좌측 목차(현재 장 강조) · 가운데 세리프 본문(문장 클릭 → 근거 하이라이트) · 우측 출처 패널(원문 구절 카드). 상단 AI 오류 가능 안내 한 줄 | 목차 접힘, 출처 패널은 Sheet | 단일 열, 목차·출처 모두 Sheet |
- 떠 있는 패널(②③·Sheet·Dialog)만 큰 반경과 그림자. 목록 행·사이드바는 그림자 없음. 컨트롤(버튼·칩·입력)은 알약형.
- 강조색은 주 버튼·선택 상태·포커스 링에만. 형광 노랑은 근거 하이라이트에만.

## 3. 팔레트 (토큰 사본 — 정답은 `apps/web/src/styles/tokens.css`)
**A안 확정**(2026-11-02, [ADR-0002](docs/adr/0002-mvp-tech-decisions.md)). B안은 기록으로만 남긴다. 서체: Pretendard(UI) + Noto Serif KR(읽기 영역) 확정.

| 역할(shadcn 이름) | A안 청록 잉크 라이트 | A안 다크 | B안 먹물 남색 라이트 |
|---|---|---|---|
| background / bg | #FFFFFF | #121518 | #FFFFFF |
| foreground / text | #1B1F23 | #E9ECEE | #1B1F23 |
| card / surface | #FFFFFF | #1A1E22 | #FFFFFF |
| muted | #F4F5F5 | #22272C | #F3F4F6 |
| muted-foreground / text-muted | #5B6470 | #A1AAB3 | #5B6470 |
| primary (강조 1색) | #0F5F66 | #6CC4CC | #1F3A5F |
| primary-foreground | #FFFFFF | #0B1417 | #FFFFFF |
| accent (선택·hover 배경) | #E3F0F1 | #1E3438 | #E4EAF3 |
| accent-foreground | #0B4A50 | #BFE6EA | #14294A |
| border (장식) | #E3E6E8 | #2E343A | #E3E6E8 |
| input (경계, 3:1) | #8A929B | #6E7882 | #8A929B |
| ring | #0F5F66 | #6CC4CC | #1F3A5F |
| destructive / danger | #B42318 | #F0857B | #B42318 |
| success / warning | #1E6B3C / #8A5A00 | #6FCB8E / #E5B54D | 동일 |
| highlight (근거 전용) | #FFE45C (soft #FFF4B8) | #6B5A12 | 동일 |

- A안: 청록 잉크 + 형광 노랑 하이라이트. 종이/도서관 인상, 노랑과 보색 대비가 약해 하이라이트가 은은하게 보인다.
- B안: 먹물 남색 + 형광 노랑. 더 격식 있고 금융·법률 느낌, 하이라이트와 대비가 커서 더 눈에 띈다. 남색은 보라 계열로 읽히지 않게 채도를 낮춘 값.
- 공통: Readray 색 조합(라임/미색) 미사용. 보라·그라디언트 없음.
- 폰트 3구간 표(display/h1/h2/body/caption/reading)는 tokens.css의 `@media` 블록이 정답이며 `docs/DESIGN_TOKENS.md`에 자동 생성된다.
- 서체: Pretendard Variable(UI) · Noto Serif KR(원문·리포트 본문) · 숫자 `tabular-nums`.
- 구간 기준: 모바일 ~767 / 태블릿 768~1199 / 데스크톱 1200~(`desk:` 변형 = 75rem).
- 시안: `design/prototype/index.html`(Tailwind v4.1.11 browser CDN, lucide 0.469.0, Pretendard 1.3.9). 토큰 값은 tokens.css 사본을 인라인으로 복사했으므로 값 수정 시 다시 복사한다. 상태 화면(빈·스켈레톤·오류 8종)은 시안 띠의 "상태" 탭.
- 추가 토큰: `--color-scrim`(라이트·다크), `--size-touch`(2.75rem, 히트 영역 44px), `--size-chat`, `--container-reading`, `--leading-reading`. 문장 선택 표시는 accent, 형광 노랑은 근거 구절 전용.
