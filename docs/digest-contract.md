# 자료 다이제스트 계약 v1 (2026-11-18, 사용자 결정: Readray digest 화면 구성)

레퍼런스: readray.ai `/digest/...` 화면(로그인 뒤). 로고·문구·이미지는 가져오지 않는다. 시각 값은 `DESIGN.md` §2-2.

## 1. 화면 구성 (`/sources/[sourceId]`, 앱 사이드바 없음·전체 폭)
| 영역 | 구성 |
|---|---|
| 상단 | 왼쪽 "‹ 홈" 알약(→ /sources), 오른쪽 ··· 메뉴. 스크롤 진행 막대(상단 얇은 라임 선) |
| 왼쪽 단 | 세그먼트 토글 "핵심 / 딥 리서치"(바탕 #EEEDE5, 패딩 3, 알약, 13px/500) → 목차: 자료 제목(진하게) + `01 장 제목`(번호 회색 12px, 항목 13px 회색, 현재 장 진하게) |
| 가운데 단(약 560~740px) | ① 제목 42px/600 lh 1.25 ② 자료 카드(썸네일·제목·메타 고정폭 한 줄·→ 원문) ③ 칩 줄(폴더 등) ④ 굵은 가로줄(2px) ⑤ "한눈에 보기" 19px/600 + 번호 목록(굵은 문장 + 하위 점 목록) ⑥ "핵심 용어" 상자(바탕 진한 미색, 번호 목록 `용어: 설명` + 인용 칩) ⑦ 장마다: 검정 번호 배지(28×28, 반경 6, 13px/600 흰 글자) → 장 제목 32px/600 + 인용 칩 → 도입 문단 → 번호 요점(굵은 첫 문장) + a·b·c 하위 요점, 각 끝에 인용 칩 |
| 인용 칩 | 11px, 회색 글자, 옅은 바탕, 반경 5. 영상은 `m:ss`(누르면 원본 플레이어 그 시각), PDF는 `p.N`(원문 카드 그 쪽) |
| 핵심 용어 표시 | 본문에서 terms의 용어와 일치하는 구절은 점선 밑줄, 마우스를 올리면 설명 |
| 하단(떠 있음) | 왼쪽 "원본" 알약(누르면 원문 카드: 영상 플레이어·PDF 원문) + 가운데 질문 입력(준비 중, 비활성) + 아래 회색 안내 한 줄 |
| 핵심 모드 | 한눈에 보기·핵심 용어만, 딥 리서치 모드는 전체 |

## 2. 저장 형식 (Worker 생성, 모든 chunk_ids는 그 자료의 현재 청크만)
```json
{ "version": 1,
  "title": "string(≤120)",
  "glance": [{ "text": "string", "details": ["string"], "chunk_ids": ["uuid"] }],
  "terms": [{ "term": "string(≤40)", "desc": "string(≤200)", "chunk_ids": ["uuid"] }],
  "chapters": [{ "title": "string", "intro": "string", "chunk_ids": ["uuid"],
                 "points": [{ "text": "string", "chunk_ids": ["uuid"],
                              "subpoints": [{ "text": "string", "chunk_ids": ["uuid"] }] }] }] }
```
개수: glance 3~5(details 0~3), terms 0~6, chapters 2~6(points 1~4, subpoints 0~3). 길이: title 120, text 300, intro 400, details·desc 200, term 40자.
검증(코드): 인용 없는 항목은 버리고, 요점이 모두 빠진 장은 장째 버린다. 남은 glance<2 또는 chapters<1이면 전체 거부. 원문 100자 넘는 그대로 인용 금지(기존 maxQuoteChars 규칙).

## 2-1. 생성·저장 결정 (challenger REVISE 반영)
- 저장: 별도 테이블 `source_digests`(source_id PK, user_id, project_id, job_id, status ready|failed, digest jsonb, model, created_at). RLS select는 source_summaries와 같은 조건, 쓰기는 security definer RPC `save_source_digest`만(최신 성공 작업 펜싱·chunk 소속 검사·digest 256KB 상한).
- 오래된 다이제스트: 행의 job_id가 그 자료의 최신 성공 source_ingest와 다르면 API는 pending, 현재 청크에 없는 인용은 뺀다.
- 호출: 다이제스트가 자료 요약(sentences) 단계를 대체한다(수집당 Gemini 최대 2회: 폴더 요약 1회·다이제스트 1회). 사용 기록 event_type `source_digest`.
- 입력: 청크를 고르게 최대 60개(약 6만 자) 표본. 프롬프트에는 청크를 짧은 번호(c1…)로 넘기고 코드가 UUID로 되돌린다(출력 토큰 절감).
- 출력 상한 16384토큰·thinking 0·타임아웃 120초. MAX_TOKENS·형식 불량이면 전체 거부, status failed 저장(사용량은 기록).
- 백필·재생성 버튼 없음(후속). 기존 자료는 status none.

## 3. 조회 API `GET /api/sources/[sourceId]/digest`
`{ unavailable: boolean, status: "ready"|"pending"|"failed"|"none", digest: null | 위 형식에서 chunk_ids → citations[{chunk_id, t_start: number|null, page: number|null}] }`. 로그인 세션(RLS)으로만 읽는다. 현재 청크에 없는 인용은 뺀다.
상태: 자료 처리 중이면 pending. 다이제스트 행이 없으면 최신 성공 source_ingest 완료(finished_at) 뒤 10분 미만은 pending, 정확히 10분부터는 none(기존 자료·공급자 없음).
