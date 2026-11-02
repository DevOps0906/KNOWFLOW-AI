# Files Storage — 화면 디자인 기준

근거: `screens.md`, `_design-guide/DASHBOARD_PATTERNS.md` 2~3장(패턴 A~O). 색·크기 값은 프로젝트 `tokens.css`를 따른다(이 문서에 hex·px 없음). 와이어프레임은 `plan2spec`이 생성한다.

## 1. 화면 → 패턴 대응
| 화면 ID | 패턴 | 핵심 컴포넌트 |
|---|---|---|
| FILE-S01 | B 리스트-상세 | 검색, FilterBar, DataTable(상태 Badge·크기 오른쪽 정렬), Pagination, 업로드 버튼 |
| FILE-S02 | 폼 + 진행 목록 | 업로드 안내, 드롭 영역 + "파일 선택" 버튼, 업로드 진행 행(진행률·재개·검사 상태), 취소 |
| FILE-S03 | G 상세 | 상태 Badge, 필드 요약, 미리보기 카드, Tabs(3: 버전·연결·공유), 격리 Callout, 삭제 위험 영역 |
| FILE-S04 | 폼 | 공유 안내 Callout, 만료·한도·비밀번호 Form, 링크 만들기 버튼 |
| FILE-S05 | B 리스트-상세 | FilterBar, DataTable(상태 Badge·다운로드 사용량), 폐기 버튼, Pagination |
| FILE-S06 | 공개 단일 카드 | 상태 Badge, 파일 요약(이름·크기·형식·만료), 비밀번호 Form, 다운로드 버튼, 개인정보 안내 |
| FILE-S07 | B 리스트-상세 | FilterBar, DataTable(영구 삭제 예정일), 복구 버튼, Pagination |
| FILE-S08 | B 리스트-상세 | FilterBar, DataTable(탐지 사유·상태), 재검사·영구 삭제 버튼, Pagination |
| FILE-S09 | H 설정 | Tabs(4), 용량·크기·형식 Form, 사용량 Stat(진행 막대), 저장 버튼 |
- S01~S07은 조직 앱 셸(viewer는 업로드 버튼 숨김이 아니라 비활성 + 사유 텍스트). S06은 로그인 없는 공개 셸. S08~S09는 `/admin/files/*` 관리자 셸.

## 2. 상태 배지 의미 색 (토큰 이름만, 색 + 텍스트/아이콘 함께)
| 값 | 토큰 | 비고 |
|---|---|---|
| 파일 uploading / scanning | --color-info / --color-info | 문구 "업로드 중" / "검사 중"으로 구분, 다운로드 비활성 |
| 파일 ready | --color-success | 문구 "사용 가능" |
| 파일 quarantined | --color-danger | 문구 "격리됨" + 경고 아이콘, 탐지 사유 병기 |
| 파일 deleted | --color-neutral | 문구 "삭제됨", 영구 삭제 예정일 병기 |
| 파일 purged | --color-neutral | 문구 "영구 삭제됨"(복구 불가), 삭제됨과 아이콘으로 구분 |
| 버전 uploading / scanning / ready / quarantined / deleted / purged | --color-info / --color-info / --color-success / --color-danger / --color-neutral / --color-neutral | 파일과 같은 규칙 |
| 공유 active | --color-success | 만료 임박은 --color-warning |
| 공유 revoked / expired | --color-neutral / --color-neutral | 폐기·만료는 텍스트로 구분(한도 소진은 "만료"에 사유 병기) |
| 미리보기 failed | --color-warning | "미리보기 실패 · 다운로드는 가능" |
| 전달 pending / delivered / failed / dead | --color-neutral / --color-success / --color-warning / --color-danger | |
- 각 배지 글자색은 짝 토큰 `--color-*-fg`, 대비 4.5:1(`design-preview --check`).

## 3. 반응형 3구간
| 화면 유형 | ~767 | 768~1199 | 1200~ |
|---|---|---|---|
| 목록(S01·S05·S07·S08) | 카드 목록(이름·상태 우선), 필터 시트 | 표, 보조 열 숨김 | 전체 열 표 |
| 업로드(S02) | 1열, 업로드 버튼 하단 고정, 진행 행 세로 | 2열 | 폼 왼쪽 · 진행 목록 오른쪽 |
| 상세(S03) | 요약 → 미리보기 → 탭 세로 | 2열 | 본문 + 오른쪽 요약 |
| 공유 폼·공개(S04·S06) | 1열 | 1열 + 폭 제한 | 중앙 카드 |
| 설정(S09) | 1열 | 1열 + 폭 제한 | 사이드바 + 본문 |
- 사이드바: ~1023 햄버거 시트, 1024~ 고정. 페이지 전체 가로 스크롤 금지.
| 토큰 | ~767 | 768~1199 | 1200~ |
|---|---|---|---|
| --text-display (사용량 수치) | 28px | 36px | 48px |
| --text-h1 (페이지 제목) | 24px | 28px | 34px |
| --text-h2 (섹션·카드 제목) | 20px | 22px | 26px |
| --text-body | 15px | 16px | 16px |
| --text-caption (표 보조·배지·형식 안내) | 12px | 13px | 13px |
- 위 값은 시작점이며 최종 값은 `tokens.css`가 정답이다. 크기·sha256 앞자리·진행률은 `--font-mono`(tabular).

## 4. 업로드·격리·크기 표기
- **크기·형식**: 크기는 1024 단위 B·KB·MB·GB, 소수 1자리(예: 3.2 MB), 표에서는 오른쪽 정렬. 형식은 확장자 대문자 + 종류 텍스트. 업로드 안내에 허용 형식·파일당 한도를 항상 병기하고 신분증 사본 업로드 금지 문구를 같은 영역에 둔다.
- **진행률**: 행마다 이름·크기·진행 막대·"n%" 텍스트·남은 상태("업로드 중 → 검사 중 → 사용 가능"). 색만으로 표시하지 않는다.
- **재개·실패**: 네트워크 끊김 행은 "같은 위치에서 재개" 버튼 + 마지막 위치 텍스트. 크기 초과(413)·형식 불가(415)·내용 불일치(422)·용량 초과는 행 안에 사유 텍스트와 "다시 시도/제거" 버튼. 같은 내용(sha256)은 오류가 아닌 info 안내.
- **드래그앤드롭 키보드 대안**: 드롭 영역 전체가 포커스 가능한 "파일 선택" 버튼이고 Enter·Space로 파일 선택창을 연다. 드롭 가능 상태는 테두리 + 문구 "여기에 놓으면 올라갑니다"로 알린다.
- **격리 파일 경고**: S03·S08에서 danger Callout("격리됨 · 다운로드·공유 불가") + 탐지 사유. 검사 중(423)은 info Callout. 격리 해제 버튼은 두지 않고 "재검사 요청"만 둔다.
- 공유 링크 원문은 생성 직후 한 번만 표시하고 복사 버튼 + "다시 볼 수 없음" 텍스트를 함께 둔다. 만료·시각은 KST 절대.
- 삭제는 휴지통 이동임을, 영구 삭제는 되돌릴 수 없음을 확인 단계에서 문구로 구분한다.

## 5. 접근성 체크
- [ ] 상태는 색 + 텍스트/아이콘(파일·버전·공유·격리).
- [ ] 본문 대비 4.5:1, 입력창 경계 3:1, 포커스 링 토큰 항상 보임.
- [ ] 업로드 진행은 행마다 `role="progressbar"`(`aria-valuenow`) + 완료·실패는 `aria-live`로 알림.
- [ ] 드롭 영역은 키보드만으로 파일 선택 가능, 포커스 순서가 드롭 영역 → 진행 목록 → 업로드 버튼.
- [ ] 비활성 버튼(검사 중 다운로드, viewer 업로드)은 `aria-disabled`와 사유 텍스트를 함께 둔다.
- [ ] 표: th scope, 정렬 `aria-sort`, 크기 열 머리에 단위, 행 동작에 대상 파일 이름 라벨.
- [ ] 삭제·영구 삭제·링크 폐기는 확인 단계 필수. 비밀번호 오류는 칸 옆 텍스트 + `aria-describedby`.
- [ ] 터치 대상 최소 44px, 하단 고정 바가 본문·포커스를 가리지 않음, 375px에서 페이지 가로 스크롤 없음.
- [ ] `prefers-reduced-motion` 존중(진행 애니메이션은 정적 막대 + 텍스트 대체).
