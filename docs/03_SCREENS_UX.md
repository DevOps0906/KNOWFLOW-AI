# 03 화면·UX — KNOWFLOW-AI

> 형식: ~/.claude/skills/ux-patterns/SKILL.md 2절. 표를 채우면 `plan2spec`이 구조도·와이어프레임·필수 구조 검사를 만든다.
> 유형: 대시보드 · 목록 · 상세 · 폼 · 보드 · 마법사 · 설정 · 로그인 · 랜딩
> 근거: 이동 구조·레이아웃 `diagrams/04-screen-map-and-layout.md`, 처리 상태 `diagrams/02-rag-and-job-flow.md#2`, 테이블명 `diagrams/03-data-model-erd.md`. API ID(A-xx)는 가칭이며 `04_API.md` 확정 때 맞춘다.
> 자료 처리 상태 4종(queued·processing·completed·failed)은 자료 목록 행마다 배지로 노출한다(상세 표시는 02#2). 색·크기 값은 Gate A에서 확정(여기 쓰지 않음).

## 화면
| ID | 화면 | 유형 | 경로 | 주된 일 | 구성 | 데이터 | API | 권한 | 다음 |
|---|---|---|---|---|---|---|---|---|---|
| S-01 | 랜딩 | 랜딩 | / | 제품 이해 후 가입 시작 | hero:자료로 답하는 지식 워크스페이스, text:핵심 기능 3가지, button:무료로 시작, link:로그인, footer | — | — | 누구나 | S-02, S-03 |
| S-02 | 로그인 | 로그인 | /login | 계정으로 들어가기 | header, form:이메일*·비밀번호*, button:로그인, link:가입하기, link:비밀번호 재설정, link:약관 | profiles | A-01 | 비로그인 | S-06, S-03, S-04 |
| S-03 | 가입 | 로그인 | /signup | 새 계정 만들기 | header, form:이메일*·비밀번호*, button:가입, link:로그인, link:약관 | profiles | A-01 | 비로그인 | S-05, S-02 |
| S-04 | 비밀번호 재설정 | 폼 | /reset-password | 재설정 메일 요청·새 비밀번호 설정 | header, form:이메일*, button:메일 보내기, button:취소, link:로그인으로 | profiles | A-01 | 비로그인 | S-02 |
| S-05 | 온보딩 | 마법사 | /onboarding | 빈 프로젝트 만들기 안내 | header, steps:환영·빈 프로젝트 만들기·첫 질문 안내, form:프로젝트 이름*, button:이전, button:다음, link:건너뛰기 | projects | A-02 | 로그인 | S-06 |
| S-06 | 대시보드 | 목록 | /dashboard | 만들던 프로젝트 이어가기 | header, search, filter:상태, list:최근 프로젝트·처리 중 자료, pagination, button:새 프로젝트, link:리포트 | projects, sources, processing_jobs | A-02, A-05, A-10 | 로그인 | S-07, S-08, S-11, S-13 |
| S-07 | 프로젝트 목록 | 목록 | /projects | 프로젝트 찾기·만들기 | header, search, filter:상태, sort, table:이름·자료 수·수정일·상태, pagination, button:새 프로젝트 | projects | A-02 | 로그인 | S-08 |
| S-08 | 워크스페이스 | 상세 | /projects/[projectId] | 자료 확인·질문·리포트 생성 | header, breadcrumb, sidebar:자료(3단 중 왼쪽, DESIGN.md#2), tabs:요약·원문, filter:자료 유형, list:자료 선택 체크(질의 범위)·이름·처리 상태 배지·재시도, button:선택 자료 삭제, card:요약, list:추천 질문, list:질문·답변(인용 칩 hover 미리보기→원문 위치 이동), form:질문 입력*, button:자료 추가, button:리포트 생성 | projects, sources, source_chunks, conversations, messages, processing_jobs | A-03, A-04, A-05, A-06, A-08 | 로그인(소유자) | S-09, S-10, S-12, S-07 |
| S-09 | 자료 추가 | 폼 | 다이얼로그(/projects/[projectId]) | PDF·URL 등록 | modal:자료 추가, tabs:PDF·URL, form:파일(여러 개) 또는 URL*, text:지원 예정 매체 안내(YouTube·오디오·Office·HWP 등, PRD 3-1), button:추가, button:취소 | sources, processing_jobs | A-04 | 로그인(소유자) | S-08 |
| S-10 | 문서 뷰어 | 상세 | /sources/[sourceId] | 인용된 원문 위치 확인(진입 규칙: ?chunk=<chunk_id>) | header, breadcrumb, text:원문(인용 위치 강조), list:인용 패널, button:워크스페이스로 | sources, source_chunks | A-07 | 로그인(소유자) | S-08 |
| S-11 | 리포트 목록 | 목록 | /reports | 만든 리포트 찾기 | header, search, filter:프로젝트, table:제목·프로젝트·생성일, pagination | reports | A-08 | 로그인 | S-12 |
| S-12 | 리포트 | 상세 | /reports/[reportId] | 리포트 읽기·출처 확인·내보내기 | header, breadcrumb, text:AI 오류 가능 안내, text:리포트 본문(문장 클릭→근거 구절 강조), list:출처 패널, button:Markdown 내보내기, link:프로젝트로 | reports, report_citations | A-08, A-09 | 로그인(소유자) | S-10, S-11, S-08 |
| S-13 | 설정·사용량 | 설정 | /settings | 계정 관리·사용량 확인 | header, tabs:계정·사용량, form:이름·이메일, stat:사용량·한도, button:저장, button:계정 삭제 | profiles, usage_events, plans, user_quotas | A-10 | 로그인 | S-06 |
| S-14 | 없는 경로 | 상세 | 404 | 길을 잃었을 때 복귀 | header, breadcrumb, text:찾을 수 없거나 접근 권한이 없습니다, button:대시보드로, link:랜딩으로 | — | — | 누구나 | S-06, S-01 |
| S-15 | 오류 | 상세 | 오류 페이지 | 예상 못한 오류 안내·재시도 | header, breadcrumb, text:문제가 생겼습니다, button:다시 시도, link:대시보드로 | — | — | 누구나 | S-06 |

가칭 API: A-01 인증(가입·로그인·재설정) · A-02 프로젝트 목록·생성 · A-03 프로젝트 조회 · A-04 자료 등록 · A-05 자료 처리 상태·재시도 · A-06 질의응답(인용 포함) · A-07 원문·청크 조회 · A-08 리포트 생성·목록 · A-09 리포트 조회·내보내기 · A-10 계정·사용량.

## 상태
| ID | 빈 | 로딩 | 오류 | 성공 |
|---|---|---|---|---|
| S-01 | — | — | — | — |
| S-02 | — | 버튼 진행 표시 | 이메일·비밀번호 불일치 안내 | 대시보드로 이동 |
| S-03 | — | 버튼 진행 표시 | 이미 가입된 이메일·약한 비밀번호 안내 | 온보딩으로 이동 |
| S-04 | — | 버튼 진행 표시 | 메일 전송 실패 안내 + 다시 시도 | 메일 전송 안내(존재 여부는 노출하지 않음) |
| S-05 | — | 프로젝트 생성 중 진행 표시 | 프로젝트 생성 실패 + 건너뛰기 | 대시보드로 이동 |
| S-06 | 첫 프로젝트 전 안내 + 새 프로젝트 버튼 | 목록 스켈레톤 | 다시 시도 버튼 | — |
| S-07 | 프로젝트 없음 안내 + 새 프로젝트 버튼 | 표 스켈레톤 | 다시 시도 버튼 | — |
| S-08 | 자료 없음 안내 + 자료 추가 버튼, 질문 전 예시 질문 | 패널별 스켈레톤, 답변 생성 단계 표시(검색·작성·인용 검증) | 자료 처리 실패 원인 + 재시도, 답변 실패 + 다시 시도, 근거 없음 안내 | 답변과 인용 칩 표시 |
| S-09 | — | 업로드 진행 표시 | 형식·크기 오류, 스캔 PDF 미지원 안내(제안) | 등록됨(대기) 표시 후 닫힘 — 분석 완료와 별도 |
| S-10 | 원문 없음 안내 + 워크스페이스로 | 원문 스켈레톤 | 다시 시도, 접근 불가 시 404 | — |
| S-11 | 리포트 없음 안내 + 프로젝트로 이동 | 표 스켈레톤 | 다시 시도 버튼 | — |
| S-12 | — | 리포트 생성 중 진행 표시 | 생성 실패 + 다시 시도, 근거 없음 구간 표시 | 리포트 본문과 출처 표시 |
| S-13 | 사용 기록 없음 안내 | 섹션 스켈레톤 | 저장 실패 안내 | 저장됨 알림 |
| S-14 | — | — | — | — |
| S-15 | — | — | — | — |

## 흐름
| ID | 흐름 | 단계 |
|---|---|---|
| F-01 | 가입 → 첫 자료 → 첫 질문 | S-01 → S-03 → S-05 → S-06 → S-08 → S-09 → S-08 → S-10 |
| F-02 | 리포트 생성 | S-06 → S-07 → S-08 → S-12 → S-10 |
| F-03 | 리포트 다시 보기·내보내기 | S-06 → S-11 → S-12 |
| F-04 | 비밀번호 재설정 | S-02 → S-04 → S-02 → S-06 |
