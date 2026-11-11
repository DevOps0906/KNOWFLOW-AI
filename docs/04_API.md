# 04 API — KNOWFLOW-AI

> **린 통과 전 조건부**: `00_LEAN.md` 통과 전까지 확정 아님(통과 후 변경 가능). ID는 `03_SCREENS_UX.md` 화면 표의 API 칸과 같다.
> 기준: Next.js Route Handler(`/api/...`). 근거 `diagrams/01-system-architecture.md#2·#3`, `02-rag-and-job-flow.md#3·#4`, 테이블 `03-data-model-erd.md`. 조직·관리자 API는 MVP 제외.

## 공통 규칙
| 항목 | 규칙 |
|---|---|
| 인증·권한 | 세션 필수(A-01 제외). 모든 자원은 **본인 프로젝트 소유**만. 타인 자원·없는 자원은 모두 404(존재 노출 금지). 클라이언트가 보낸 user_id는 쓰지 않음 |
| 장시간 처리 | 자료 처리·리포트 생성은 **202 + 작업 id**(`processing_jobs`). 상태는 A-05로 조회 |
| 멱등 키 | 자료 등록·재시도(A-04·A-05)·질문(A-06)·리포트 생성(A-08) POST는 `Idempotency-Key` 헤더. 같은 키+다른 입력은 409. 저장: `idempotency_keys`(user_id+key 유니크, request_hash 비교). 업로드는 파일마다 키. A-02(프로젝트 생성)는 대상 아님 |
| 목록 | 커서 방식(`cursor`, `limit`) → `{items, next_cursor}` |
| 오류 형식 | `{error:{code, message}}` 한국어 안전 메시지만(내부 오류·키·경로 미노출) |
| 공통 오류 | 401 세션 없음 · 404 · 429 쿼터/요청 초과(`user_quotas`·rate limit, `Retry-After`) · 500 |
| source_type | MVP는 `pdf`·`url`·`youtube`. `youtube`는 기능 플래그(`YOUTUBE_ENABLED`)가 꺼져 있으면 키·`videos.list`보다 먼저 422 "지원 예정". 플래그는 법무 확인 뒤 켠다([05#8](05_DATA_MODEL.md)). 05 예약 목록(`audio`·`video`·`docx`·`pptx`·`image`·`text`)과 그 외 값은 422 "지원 예정" |

## 엔드포인트
| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|
| A-01 | POST | /api/auth/signup · login · logout · reset-password · update-password | 이메일, 비밀번호 / (재설정) 이메일 | 세션 쿠키 / 재설정은 항상 동일 안내(존재 여부 비노출) | 비로그인(logout·update-password는 로그인) | 400 형식 · 401 불일치 · 409 이미 가입 · 422 약한 비밀번호 · 429 시도 과다 |
| A-02 | GET · POST | /api/projects | (GET) 검색어, 상태, 정렬, 커서 / (POST) 이름, 설명 | 프로젝트 목록(이름·자료 수·수정일·상태)·다음 커서 / 프로젝트 id | 로그인(본인) | 400 · 401 · 422 이름 길이 · 429 프로젝트 수 한도 |
| A-03 | GET · PATCH · DELETE | /api/projects/[projectId] | (PATCH) 이름·설명·보관 / (DELETE) — | 프로젝트 + 자료 목록(유형·처리 상태·오류 코드·`unavailable_at`) + 요약·추천 질문 / 변경 결과 / 삭제 결과(소프트 삭제 `deleted_at`, 30일 뒤 자료·청크·대화·리포트 영구 삭제 — [05#5](05_DATA_MODEL.md)). 요약·추천 질문은 자료 completed 시 Worker가 생성해 `projects.summary`·`suggested_questions`에 저장 | 소유자 | 401 · 404 · 409 처리 중 작업 있음(삭제) · 422 |
| A-04 | POST · DELETE | /api/projects/[projectId]/sources | (POST) source_type, (pdf) 서명 업로드 URL 발급 → 브라우저가 Storage로 직접 업로드 → 등록 요청(파일별 멱등 키) 또는 (url) URL 또는 (youtube) 영상 1건 URL(호스트 `youtube.com`·`www.youtube.com`·`m.youtube.com`·`youtu.be`만. 웹 서버가 `video_id`를 뽑아 `videos.list`로 동기 검사) / (DELETE) source id 목록 | 서명 업로드 URL / 자료 id·작업 id(202, status=queued) / 삭제 결과(소프트 삭제 `deleted_at`, 영구 삭제는 30일 뒤) | 소유자 | 401 · 404 · 409 같은 content_hash 또는 (project_id, video_id) 자료 있음·같은 멱등 키 다른 입력 · 413 크기 초과 · 415 PDF 아님 · 422 source_type 미지원("지원 예정")·URL 형식/차단 주소(SSRF)·유튜브 거절(허용 외 호스트, 재생목록·채널 URL, 비공개·미등록, 임베드 불가, 연령·지역 제한, 라이브, 어린이용(`madeForKids`), 길이 초과) · 429 자료 수 한도·월 영상 시간 한도·분당 10회 · 502 `videos.list` 장애(판정 불가, 등록 안 함) · 503 유튜브 신규 수집 중단(Gemini Preview 종료·차단). 500쪽 초과·스캔 PDF는 등록 후 Worker가 job failed + error_code로 판정(A-05에서 확인) |
| A-05 | GET · POST | /api/projects/[projectId]/jobs · /api/sources/[sourceId]/retry | (GET) 상태 필터, 커서 / (POST) 멱등 키 | 작업 목록(id·job_type·source_id·source.status와 status 분리 표기(job: queued·running·succeeded·failed·cancelled, 매핑 05#6)·step·progress·attempt_count·error_code·retryable·report_id·created_at·started_at·finished_at) / 새 작업 id(202, 재시도=새 작업 생성) | 소유자 | 400 멱등 키 없음·형식 오류 · 401 · 404 · 409 진행 중 작업 있음(job queued·running) · 422 completed 자료는 재처리만·재시도 불가 실패(`retryable=false`, [05#7](05_DATA_MODEL.md)) · 429 재시도 한도 |
| A-06 | GET · POST | /api/projects/[projectId]/conversations · /api/conversations/[id]/messages | (GET) 커서 / (POST) 질문(길이 상한), 질의 범위 source id 목록(생략 시 completed 전체), 멱등 키 | 대화·메시지 목록 / 답변 + 출처 칩(source_id·chunk_id·source_title·source_type·locator(locator.page 또는 유튜브 `t_start`·`t_end` 등 확보된 경우만), 서버가 검색 결과로 생성·인용 검증 통과분), no_answer 여부 | 소유자 | 401 · 404 · 409 같은 멱등 키 진행 중 · 422 질문 길이·범위에 미완료·비활성 자료 · 429 월 질문 쿼터 · 502 생성 실패(다시 시도, 쿼터 차감 취소) |
| A-07 | GET | /api/sources/[sourceId] · /api/sources/[sourceId]/chunks · /api/sources/[sourceId]/moments | (선택) chunk_id, 커서 | 자료 메타(유튜브는 video_id·channel_title·original_url·`unavailable_at` 포함) + 원문 청크(chunk_index·content·locator) / 장면 카드(id·locator·title·description·리포트 인용 가능 여부). 비활성 자료는 메타만 | 소유자(자료의 project 소유) | 401 · 404 · 409 아직 completed 아님 |
| A-08 | GET · POST | /api/reports · /api/projects/[projectId]/reports | (GET) 프로젝트 필터, 검색어, 커서 / (POST) 제목(선택), 대상 source id 목록(선택), 장면 카드 id 목록(선택), 멱등 키 | 리포트 목록(제목·프로젝트·생성일)·다음 커서 / 리포트 id·작업 id(202) | 로그인(본인) | 401 · 404 프로젝트 · 409 같은 멱등 키 진행 중 · 422 completed 자료 없음·겹치는 청크 없는 장면 카드 · 429 쿼터 · 502 생성 실패 |
| A-09 | GET · DELETE | /api/reports/[reportId] · /api/reports/[reportId]/export | (GET export) format=markdown | 리포트 본문 + 출처(report_citations: chunk_id·position) + 생성 상태 / Markdown 파일 / 삭제 결과 | 소유자 | 401 · 404 · 409 생성 중(내보내기) · 422 지원하지 않는 format |
| A-10 | GET · PATCH · DELETE | /api/me · /api/me/usage | (PATCH) 이름 / (DELETE) 확인 문구 | 프로필 / 사용량(usage_events 집계)·한도(plans·user_quotas) / 저장·삭제 결과(계정 삭제 시 전 데이터 삭제) | 로그인(본인) | 401 · 422 이름 길이·확인 문구 불일치 · 409 처리 중 작업 있음(삭제) |
| A-11 | GET · POST | /api/sources/[sourceId]/captures | (POST) 장면 카드 id, 캡처 이미지(형식·크기 상한 **팀장 결정 필요**) | (GET) 캡처 목록(장면 카드 id·서명 URL·시각·채널명·원본 링크) / (POST) 캡처 id | 소유자 | **법무 게이트 조건부**: task-026 프레임 저장 허용 전까지 모든 호출 422 "지원 예정". 401 · 404 · 413 크기 초과 · 415 이미지 아님 · 422 유튜브 외 자료 · 429 영상당 캡처 한도(제안 20장, [검토 4장](youtube-mvp-review.md#4-중요-장면-캡처)) |

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
| 결정 | 수치(한도·크기 상한·rate limit)는 [PRD 8-1](01_PRD.md#8-1-베타-초기값-2026-11-02-확정-조정-가능) 베타 초기값, 측정 후 조정 |

### 유튜브 수집·임베드 ([ADR-0006](adr/0006-youtube-summary-and-capture-mvp.md))
| 항목 | 내용 |
|---|---|
| 노출 면 | A-04 유튜브 등록(세션 필요) · S-10 임베드 플레이어 · 외부 호출(YouTube Data API, Gemini) · A-11 L1 캡처 업로드(법무 게이트 조건부) |
| 인증·인가 | 공통 규칙과 같다. 장면 카드도 자료 소유자만 |
| 다루는 데이터 | 영상 메타데이터, AI 전사, 장면 설명, L1 캡처 이미지. 전사 저장·재제공과 프레임 저장 가능 여부 **미확인**(법무 확인 필요) |
| 키·권한 | YouTube Data API 키·Gemini 키는 서버 측만([02#2](02_ARCHITECTURE.md)) |
| 입력 | 허용 호스트의 URL에서 `video_id`만 뽑아 쓰고 서버가 그 URL을 직접 fetch하지 않는다. 전사·제목·설명은 신뢰하지 않는 데이터. A-11 이미지는 서버가 형식·크기 검증 |
| 체인 | 영상 속 프롬프트 인젝션 → 요약·답변 조작 / 모델이 지어낸 시각 → 시각 검증으로 버림([검토 5장](youtube-mvp-review.md#5-처리-설계)) |
| 피해 범위 | Gemini 키 유출 시 공급자 비용. 약관 위반 판정 시 유튜브 수집 전체 중단 |
| 남용 | 긴 영상 반복 등록으로 비용 폭주 → 영상당·월 시간 한도, 서비스 전체 일 상한(Phase 0 뒤 결정). A-11은 영상당 캡처 한도 |
| 로그 | `video_id`·오류 코드·버린 구간 수 O / 전사 원문·키 X |
| 결정 | 서버는 영상·음성·자막을 내려받지 않는다. 썸네일은 YouTube 주소로 표시만(서버 프록시·`next/image` 금지). 임베드 의무 항목은 **미확인**(공식 원문 대조 필요, [검토 1장](youtube-mvp-review.md#1-확인한-제약)) |
