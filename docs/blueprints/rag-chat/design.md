# RAG Chat — 화면 디자인 기준

근거: `screens.md`, `_design-guide/DASHBOARD_PATTERNS.md` 2~3장(패턴 A~O). 색·크기 값은 프로젝트 `tokens.css`를 따른다(이 문서에 hex·px 없음). 와이어프레임은 `plan2spec`이 생성한다.

## 1. 화면 → 패턴 대응
| 화면 ID | 패턴 | 핵심 컴포넌트 |
|---|---|---|
| RAG-S01 | 채팅 | 말풍선 목록(질문·답변), 스트리밍 표시, 출처 칩·출처 패널, 피드백 버튼, 질문 입력, 보내기·중단, AI 안내 |
| RAG-S02 | B 리스트-상세 | 검색, FilterBar, DataTable(검색 범위·상태 Badge), 새 대화·삭제 버튼, Pagination |
| RAG-S03 | B 리스트-상세 | FilterBar, DataTable(색인 상태 Badge), 컬렉션 추가 모달, Pagination |
| RAG-S04 | G 상세 | 상태 Badge, 컬렉션 요약 필드, 문서 표(상태·접근 범위), 문서 추가·삭제 버튼 |
| RAG-S05 | 폼 | 입력 방식 선택, 문서 이름·파일·본문, 접근 범위 선택, 개인정보 포함 체크, 안내 Callout |
| RAG-S06 | G 상세 | 상태 Badge, 필드 요약, 청크 미리보기 표, 색인 단계 표, 실패 사유 Callout |
| RAG-S07 | B 리스트-상세 | FilterBar, DataTable(평가·사유 분류·처리 상태), 검토 완료 버튼, Pagination |
| RAG-S08 | H 설정 | Tabs(3), 청크·검색·보관 Form, 위험 영역(임베딩 모델 변경) |
| RAG-S09 | B 리스트-상세 | FilterBar, DataTable(진행률·상태·오류), 재시도·취소 버튼, Pagination |
- S01~S06은 조직 앱 셸(S03~S06은 지식 관리자에게만 메뉴 노출). S07~S09는 `/admin/rag/*` 조직 관리자 셸이며 플랫폼 운영자 화면이 아니다.

## 2. 상태 배지 의미 색 (토큰 이름만, 색 + 텍스트/아이콘 함께)
| 값 | 토큰 | 비고 |
|---|---|---|
| 메시지 streaming | --color-info | 문구 "답변 중", 중단 버튼 노출 |
| 메시지 done | --color-success | 출처 목록과 함께 표시 |
| 메시지 failed | --color-danger | "생성 실패" + 다시 시도·크레딧 환불 안내 |
| 메시지 refused (no_answer) | --color-warning | 고정 문구 "자료에서 찾지 못함", 출처 없음 |
| 문서 queued / indexing | --color-neutral / --color-info | 문구 "대기" / "색인 중" |
| 문서 ready / failed | --color-success / --color-danger | ready만 검색 대상, 실패 사유 병기 |
| 컬렉션 active / reindex_required | --color-success / --color-warning | 문구 "사용 중" / "재색인 필요" |
| 대화 active / archived | --color-success / --color-neutral | |
| 작업 queued / running | --color-neutral / --color-info | 진행률 병기 |
| 작업 succeeded / failed / cancelled | --color-success / --color-danger / --color-neutral | 취소는 텍스트로 구분 |
| 단계 pending / running / succeeded / failed / skipped | --color-neutral / --color-info / --color-success / --color-danger / --color-neutral | |
| 피드백 처리 open / reviewed | --color-warning / --color-success | |
| 전달 pending / delivered / failed / dead | --color-neutral / --color-success / --color-warning / --color-danger | |
- 각 배지 글자색은 짝 토큰 `--color-*-fg`, 대비 4.5:1(`design-preview --check`).

## 3. 반응형 3구간
| 화면 유형 | ~767 | 768~1199 | 1200~ |
|---|---|---|---|
| 채팅(S01) | 1열, 입력창 하단 고정, 출처는 답변 아래 칩 → 바텀 시트 | 대화 영역 + 출처 패널 접이식 | 대화 목록 · 대화 · 출처 패널 3열 |
| 목록(S02·S03·S07·S09) | 카드 목록(제목·상태 우선), 필터 시트 | 표, 보조 열 숨김 | 전체 열 표 |
| 상세(S04·S06) | 요약 → 표 세로 | 2열 | 본문 + 오른쪽 요약 |
| 폼(S05) | 1열 | 1열 + 폭 제한 | 폼 + 오른쪽 접근 범위 안내 |
| 설정(S08) | 1열 | 1열 + 폭 제한 | 사이드바 + 본문 |
- 사이드바: ~1023 햄버거 시트, 1024~ 고정. 페이지 전체 가로 스크롤 금지.
| 토큰 | ~767 | 768~1199 | 1200~ |
|---|---|---|---|
| --text-display (통계 수치) | 28px | 36px | 48px |
| --text-h1 (페이지 제목) | 24px | 28px | 34px |
| --text-h2 (섹션·카드 제목) | 20px | 22px | 26px |
| --text-body (말풍선 본문) | 15px | 16px | 16px |
| --text-caption (출처 칩·배지·AI 안내) | 12px | 13px | 13px |
- 위 값은 시작점이며 최종 값은 `tokens.css`가 정답이다. 문서 번호·페이지·청크 위치는 `--font-mono`(tabular).

## 4. 채팅·출처·피드백 표기
- **말풍선**: 질문은 오른쪽·`--color-surface` 계열, 답변은 왼쪽. 발화자는 위치 + "나/AI" 텍스트 라벨로도 구분하고 색에만 의존하지 않는다. 답변 아래에 "AI 답변 · 자료 기반 · 오류 가능" 안내를 항상 둔다.
- **스트리밍 표시**: 답변 중에는 "답변 중…" 텍스트 + 커서 표시, 중단 버튼 활성, 보내기 비활성(`aria-disabled` + 사유). 완료 시 출처 칩이 나타나며 레이아웃이 밀리지 않도록 자리를 예약한다.
- **출처 칩**: "문서 이름 · p.n" 형식 칩, 클릭·Enter 시 출처 패널에서 해당 문서·페이지·청크 위치를 열고 원문 위치를 강조(문서 상세 RAG-S06로 이동 가능). 삭제된 문서는 "삭제된 문서" 칩(비활성)으로 남기고 이유를 텍스트로 병기. 접근 권한 밖 문서는 내용을 노출하지 않는다.
- **"자료에서 찾지 못함" 상태**: 근거 없음 고정 문구를 warning Callout으로, 출처 칩 없이 표시하고 "검색 범위 바꾸기"·"다시 질문" 안내를 둔다. 추측 답변을 이어 붙이지 않는다.
- **피드백 버튼**: 좋아요·싫어요는 토글 버튼(`aria-pressed`) + 텍스트 라벨. 싫어요 선택 시 사유 분류(부정확·잘못된 출처·자료 없음·기타)와 검토용 공유 동의 체크를 펼친다.
- 실패·한도 초과·크레딧 부족은 입력창 위 Callout + 다시 시도. 시각은 KST 절대.

## 5. 접근성 체크
- [ ] 상태는 색 + 텍스트/아이콘(메시지·문서·컬렉션·작업), 발화자는 라벨로 구분.
- [ ] 본문 대비 4.5:1, 입력창 경계 3:1, 포커스 링 토큰 항상 보임.
- [ ] 대화 영역은 `role="log"` + `aria-live="polite"`로 새 답변을 알리되, 스트리밍 중 토큰마다 읽지 않고 완료 시 알린다.
- [ ] 출처 칩은 버튼이며 라벨 "출처: 문서 이름 n쪽 열기", 패널 열림 시 포커스 이동·닫기 시 칩으로 복귀.
- [ ] 좋아요·싫어요는 `aria-pressed`, 사유 입력 오류는 칸 옆 텍스트 + `aria-describedby`.
- [ ] 표: th scope, 정렬 `aria-sort`, 행 동작에 대상 이름 라벨.
- [ ] 대화 삭제·문서 삭제·임베딩 모델 변경(전체 재색인)은 확인 단계 필수.
- [ ] 터치 대상 최소 44px, 하단 고정 입력창이 본문·포커스를 가리지 않음, 375px에서 페이지 가로 스크롤 없음.
- [ ] `prefers-reduced-motion` 존중(스트리밍 커서 깜박임은 정적 표시로 대체).
