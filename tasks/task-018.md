# task-018 리포트 화면·목록·Markdown 내보내기 S-11·S-12·A-09

| 항목 | 내용 |
|---|---|
| 웨이브 | W4 |
| 선행 | task-017 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 (본문 내보내기·삭제, 소유자 검증) |
| 담당 | builder (+ tester), 착수 전 challenger |
| 근거 | `spec S-10`, `spec S-11`, `spec S-12`, `docs/04_API.md#A-08`, `docs/04_API.md#A-09` |
| 쓰기 허용 | `apps/web/src/app/(app)/reports/**`, `apps/web/src/app/api/reports/**`, `apps/web/src/components/report/**`, `apps/web/src/components/youtube/**`(S-10 선택 카드 → 리포트 생성 연결만) |

## 할 것
- S-11 목록: 제목·프로젝트·생성일, 검색, 커서 페이지, 빈 상태
- S-12 상세: 본문 + 출처 칩(→ 뷰어 하이라이트), 생성 중·실패·삭제 상태
- S-12 유튜브 출처 패널: mm:ss·채널명·원본 링크
- S-10 "선택 카드로 리포트 생성": task-029 장면 카드에서 체크한 id로 A-08 POST
- A-09: GET 본문·출처, DELETE, export `format=markdown`(출처 목록 포함)
- 오류: 404 · 409 생성 중 내보내기 · 422 미지원 format, 반응형 3구간

## 하지 않을 것
- PDF·DOCX 내보내기(MVP 제외, `01_PRD.md#3` 범위 외)
- 생성 로직 변경(task-017)

## 완료 조건 (실행 가능한 확인)
- [ ] 타인 리포트 GET·DELETE·export가 404인 소유권 테스트 통과
- [ ] export 파일에 Markdown 출처 목록이 포함됨을 테스트로 확인, 409·422 통과
- [ ] `pnpm typecheck` · `pnpm test` 통과
- [ ] 테스트: S-10 선택 카드 id가 A-08 요청에 담김, S-12 유튜브 출처 패널 mm:ss·채널명·원본 링크 렌더
- [ ] `shot`으로 S-11·S-12 3개 구간 스크린샷 확인
