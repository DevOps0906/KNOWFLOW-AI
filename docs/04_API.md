# 04 API — KNOWFLOW-AI

> **린 통과 전 조건부**: `00_LEAN.md` 통과 전까지 확정 아님(통과 후 변경 가능). ID는 `03_SCREENS_UX.md` 화면 표의 API 칸과 같다.
> 기준: Next.js Route Handler(`/api/...`). 근거 `diagrams/01-system-architecture.md#2·#3`, `02-rag-and-job-flow.md#3·#4`, 테이블 `03-data-model-erd.md`. 조직·관리자 API는 MVP 제외.

## 공통 규칙
| 항목 | 규칙 |
|---|---|
| 인증·권한 | 세션 필수(A-01 제외). 모든 자원은 **본인 프로젝트 소유**만. 타인 자원·없는 자원은 모두 404(존재 노출 금지). 클라이언트가 보낸 user_id는 쓰지 않음 |
| 장시간 처리 | 자료 처리·리포트 생성은 **202 + 작업 id**(`processing_jobs`). 상태는 A-05로 조회 |
| 멱등 키 | 자료 등록·재시도(A-04·A-05)·질문(A-06)·리포트 생성(A-08) POST는 `Idempotency-Key` 헤더. 같은 키+다른 입력은 409. 저장: 자료·리포트 작업은 `processing_jobs`, 질문은 `messages.idempotency_key`(user 범위 유니크). A-02(프로젝트 생성)는 대상 아님 |
| 목록 | 커서 방식(`cursor`, `limit`) → `{items, next_cursor}` |
| 오류 형식 | `{error:{code, message}}` 한국어 안전 메시지만(내부 오류·키·경로 미노출) |
| 공통 오류 | 401 세션 없음 · 404 · 429 쿼터/요청 초과(`user_quotas`·rate limit, `Retry-After`) · 500 |
| source_type | MVP는 `pdf`·`url`만. 05 예약 목록(`youtube`·`audio`·`video`·`docx`·`pptx`·`image`·`text`)과 그 외 값은 422 "지원 예정" |

## 엔드포인트
| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|
| A-01 | POST | /api/auth/signup · login · logout · reset-password · update-password | 이메일, 비밀번호 / (재설정) 이메일 | 세션 쿠키 / 재설정은 항상 동일 안내(존재 여부 비노출) | 비로그인(logout·update-password는 로그인) | 400 형식 · 401 불일치 · 409 이미 가입 · 422 약한 비밀번호 · 429 시도 과다 |
| A-02 | GET · POST | /api/projects | (GET) 검색어, 상태, 정렬, 커서 / (POST) 이름, 설명 | 프로젝트 목록(이름·자료 수·수정일·상태)·다음 커서 / 프로젝트 id | 로그인(본인) | 400 · 401 · 422 이름 길이 · 429 프로젝트 수 한도 |
| A-03 | GET · PATCH · DELETE | /api/projects/[projectId] | (PATCH) 이름·설명·보관 / (DELETE) — | 프로젝트 + 자료 목록(유형·처리 상태·오류 코드) + 요약·추천 질문 / 변경 결과 / 삭제 결과(자료·청크·대화·리포트 함께 삭제 — 삭제 정책 확정 전, 05 미정) | 소유자 | 401 · 404 · 409 처리 중 작업 있음(삭제) · 422 |
| A-04 | POST · DELETE | /api/projects/[projectId]/sources | (POST) source_type, (pdf) 파일 여러 개 또는 (url) URL, 멱등 키 / (DELETE) source id 목록 | 자료 id·작업 id(202, status=queued) / 삭제 결과(청크·Storage 연쇄 삭제 — 삭제 정책 확정 전, 05 미정) | 소유자 | 401 · 404 · 409 같은 content_hash 자료 있음·같은 멱등 키 다른 입력 · 413 크기 초과 · 415 PDF 아님 · 422 source_type 미지원("지원 예정")·URL 형식/차단 주소(SSRF)·스캔 PDF 미지원 · 429 자료 수 한도 |
| A-05 | GET · POST | /api/projects/[projectId]/jobs · /api/sources/[sourceId]/retry | (GET) 상태 필터, 커서 / (POST) 멱등 키 | 작업 목록(source_id·source.status와 job.status 분리 표기(job: queued·running·succeeded·failed·cancelled, 매핑 05#6)·단계·attempt_count·error_code) / 새 작업 id(202, 재시도=새 작업 생성) | 소유자 | 401 · 404 · 409 진행 중 작업 있음(job queued·running) · 422 completed 자료는 재처리만 · 429 재시도 한도 |
| A-06 | GET · POST | /api/projects/[projectId]/conversations · /api/conversations/[id]/messages | (GET) 커서 / (POST) 질문(길이 상한), 질의 범위 source id 목록(생략 시 completed 전체), 멱등 키 | 대화·메시지 목록 / 답변 + 출처 칩(source_id·chunk_id·source_title·locator(locator.page 등 확보된 경우만), 서버가 검색 결과로 생성·인용 검증 통과분), no_answer 여부 | 소유자 | 401 · 404 · 409 같은 멱등 키 진행 중 · 422 질문 길이·범위에 미완료 자료 · 429 월 질문 쿼터 · 502 생성 실패(다시 시도, 쿼터 차감 취소) |
| A-07 | GET | /api/sources/[sourceId] · /api/sources/[sourceId]/chunks | (선택) chunk_id, 커서 | 자료 메타 + 원문 청크(chunk_index·content·locator) | 소유자(자료의 project 소유) | 401 · 404 · 409 아직 completed 아님 |
| A-08 | GET · POST | /api/reports · /api/projects/[projectId]/reports | (GET) 프로젝트 필터, 검색어, 커서 / (POST) 제목(선택), 대상 source id 목록(선택), 멱등 키 | 리포트 목록(제목·프로젝트·생성일)·다음 커서 / 리포트 id·작업 id(202) | 로그인(본인) | 401 · 404 프로젝트 · 409 같은 멱등 키 진행 중 · 422 completed 자료 없음 · 429 쿼터 · 502 생성 실패 |
| A-09 | GET · DELETE | /api/reports/[reportId] · /api/reports/[reportId]/export | (GET export) format=markdown | 리포트 본문 + 출처(report_citations: chunk_id·position) + 생성 상태 / Markdown 파일 / 삭제 결과 | 소유자 | 401 · 404 · 409 생성 중(내보내기) · 422 지원하지 않는 format |
| A-10 | GET · PATCH · DELETE | /api/me · /api/me/usage | (PATCH) 이름 / (DELETE) 확인 문구 | 프로필 / 사용량(usage_events 집계)·한도(plans·user_quotas) / 저장·삭제 결과(계정 삭제 시 전 데이터 삭제) | 로그인(본인) | 401 · 422 이름 길이·확인 문구 불일치 · 409 처리 중 작업 있음(삭제) |

## 위협 메모
| 항목 | 내용 |
|---|---|
| 노출 면 | 공개: A-01만. 나머지는 세션 필요 인터넷 API(업로드 A-04, URL 수집 A-04, 질문 A-06) |
| 인증·인가 | 세션 + 서비스 계층 소유권 교차 검증 + RLS 2차 방어. 타인 자원 404 |
| 다루는 데이터 | 이메일, 사용자 PDF 원본, 질문·답변 원문(개인정보 포함 가능), 사용량 |
| 키·권한 | AI·임베딩 공급자 키, service_role: 서버·Worker만. 브라우저 노출 금지 |
| 입력 | PDF 형식·크기·매직 바이트 검증, URL은 SSRF·리디렉션 검사, 질문 길이 상한, 웹 텍스트는 신뢰하지 않는 데이터로 프롬프트에 격리 |
| 체인 | URL 수집(SSRF) + 내부망 접근 / 프롬프트 인젝션 + 타 프로젝트 청크 → 벡터 검색 `project_id` 강제로 차단 |
| 피해 범위 | 소유권 우회 시 타 사용자 자료·대화 / 키 유출 시 공급자 비용 |
| 남용 | 질문·자료 쿼터 + rate limit(429), 202 작업 재시도 한도, 멱등 키 |
| 로그 | `usage_events`·오류 코드 O / 질문·원문·토큰·키 X |
| 결정 | 수치(한도·크기 상한·rate limit)는 **미확인**: 요금제·처리 시간 측정 후 팀장 결정 필요 |
