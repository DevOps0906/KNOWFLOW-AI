# 벤치마킹: 핵심 화면 3종 (기준일 2026-11-02)

대상: Google NotebookLM, Lilys AI, Elicit. 화면: 자료 라이브러리 · 자료 기반 질의응답 작업 화면 · 리포트/요약 결과 화면.
대조 기준: `docs/diagrams/04-screen-map-and-layout.md` 1~3절. 근거는 2026-11-02에 직접 열어 확인한 공식 도움말만 적었다. 스크린샷은 찍지 않았다(경로 없음).

명칭 메모
- NotebookLM: 공식 도움말 페이지 제목과 본문이 "Gemini Notebook"으로 표기된다. 공식 개명 공지와 날짜는 미확인.
- Lilys AI: lilys.ai/ko/features가 readray.ai로 301 이동하고, 내비게이션에 "Readray구 LilysAI"라고 표기된다. 도움말은 help.lilys.ai.
- Elicit: 2026-09-30에 Find Papers·Extract Data·Chat with Papers가 Research Agent로 통합됐다(공식 도움말).

| 제품 | 화면 | 반드시 있는 것 | 우리에게 없는 것 | 채택 여부 | 근거(URL·스크린샷 경로) |
|---|---|---|---|---|---|
| NotebookLM | 자료 라이브러리 (노트북 안 Sources 패널) | 좌측 Sources 패널, "+ Add"로 PDF·웹 URL·YouTube·오디오·Google Docs 추가, 웹·Drive 검색으로 자료 찾기, 자료별 선택·해제로 채팅 범위 지정, 자료 5개 이상이면 자동 라벨 분류, 무료 50개 한도 표시 | 자료 선택 체크로 질의 범위 좁히기, 자동 라벨(분류) | 채택: 자료 선택 체크 / 미채택: 자동 라벨, 외부 웹 검색 추가 | https://support.google.com/notebooklm/answer/16215270 , https://support.google.com/notebooklm/answer/16206563 (노트북 목록 홈 화면의 배치·정렬은 미확인) |
| NotebookLM | 질의응답 작업 화면 (Chat 패널) | 전체 자료 요약 자동 표시, 인용 hover 시 인용문 전체, 인용 클릭 시 원문 맥락으로 이동, 답변을 노트로 저장(인용 유지), 대화 기록 삭제, 응답 스타일·길이 설정 | 인용 hover 미리보기, 답변을 노트로 저장, 응답 길이 설정 | 채택: 인용 hover 미리보기 / 보류(P2): 답변 노트 저장 / 미채택: 응답 스타일 설정 | https://support.google.com/notebooklm/answer/16179559 |
| NotebookLM | 리포트 결과 화면 (Studio 패널) | Studio > Reports > Document·Interactive, 템플릿(FAQ·학습 가이드·브리핑 문서 등)과 AI 제안 형식, 생성 전 Edit로 지시 수정, 리포트 링크 공유, Docs 내보내기, "부정확할 수 있음" 안내 | 리포트 템플릿 선택, 리포트 링크 공유, 생성물 목록 패널, AI 오류 가능 안내 | 후보(PRD 7장 #7): 템플릿 선택(소수) / 채택: AI 오류 가능 안내 / 보류(P2): 링크 공유 / 미채택: Docs 연동 | https://support.google.com/gemininotebook/answer/18323649 , https://support.google.com/notebooklm/answer/16206563 (리포트 안 인용 표시 방식은 미확인) |
| Lilys AI | 자료 라이브러리 (Sources 화면) | 사이드바(가져오기·Sources·Chats·Creations·휴지통), 상단 폴더 카드, Status(Inbox·Shortlist·Archive)·Type 필터, 이름·최신·오래된 순 정렬, hover 체크박스로 일괄 이동·삭제, 제목·폴더 검색(Ctrl+F), 하단 "라이브러리에 질문" 입력 | 읽기 상태 분류, 자료 유형 필터 칩, 일괄 선택 행동, 휴지통, 라이브러리 전체 질의 입력 | 채택: 유형 필터 칩, 일괄 선택 삭제 / 보류(P2): 읽기 상태, 휴지통 / 미채택: 라이브러리 전체 질의(프로젝트 범위 유지) | https://help.lilys.ai/en/articles/16443151-getting-around-your-source-library , https://help.lilys.ai/en/articles/11703749-finding-sources-search-and-filters |
| Lilys AI | 질의응답 작업 화면 (채팅) | 모든 화면 하단 입력, 설정으로 우측 패널 전환(약 800px 미만은 하단 시트), 보고 있는 화면이 질의 범위, @로 자료·폴더 지정, 선택한 문장으로 범위 한정, 문장마다 원문 위치 인용, 답변 아래 추천 질문 칩, Chats에 대화 보관 | @ 자료 지정, 선택 문장 질문, 추천 질문 칩, 대화 목록, 좁은 화면 하단 시트 | 채택: 추천 질문 칩 / 후보: 선택 문장 질문, 모바일 하단 시트(태블릿 결정 PRD 7장 #6과 함께) / 보류(P2): @ 지정, 대화 목록 | https://help.lilys.ai/en/articles/17703433-what-chat-can-do |
| Lilys AI | 요약 결과 화면 (Reports) | Key points·Deep research 토글, 원문 뷰어를 리포트 옆에 열기(이동·크기 조절·고정), 인용 클릭 시 PDF 페이지·영상 시각으로 이동 및 근거 구절 하이라이트, 우측 채팅을 켜면 3단, 커버리지 배지("95% covered"), 버전 기록, 편집 모드, Word·PDF·Excel 내보내기 | 원문 구절 하이라이트, 뷰어 고정, 요약 깊이 토글, 커버리지 표시, 버전 기록, 직접 편집 | 채택: 근거 구절 하이라이트 / 후보(PRD 7장 #7): 요약 깊이 토글(2종) / 보류(P2): 커버리지 표시, 버전 기록 / 미채택: 편집 모드(MVP 제외 범위) | https://help.lilys.ai/en/articles/17703216-the-original-viewer , https://help.lilys.ai/en/articles/17703212-key-points-and-deep-research-reports , https://help.lilys.ai/en/collections/19787998-share-export-and-mcp |
| Elicit | 자료 라이브러리 (Library) | 좌측 사이드바에서 진입, 업로드 PDF와 저장 논문 보관, 대량 업로드, .ris·.bib 가져오기, Zotero 가져오기, 체크박스 선택 후 Tag, 컬렉션 묶기·팀 공유, 업로드 PDF는 계정 비공개 | 태그, 대량 업로드, 서지 파일 가져오기 | 채택: 다중 파일 업로드 / 보류(P2): 태그 / 미채택: Zotero·서지 가져오기 | https://support.elicit.com/en/articles/14757550-elicit-s-library , https://support.elicit.com/en/articles/14744229-tag-papers-in-your-library (라이브러리 검색·필터 UI는 미확인) |
| Elicit | 질의응답 작업 화면 (Research Agent) | 세션 단위 작업 공간, 착수 전 되묻기, 입력창의 노력 단계 버튼(5단계), 참조 중인 자료와 진행 상황 실시간 표시, 결과 표 필터·내보내기, 인용 클릭 시 해당 논문·페이지 열기, Artifacts 드롭다운 | 답변 생성 중 참조 자료 진행 표시, 모호한 지칭 되묻기 | 채택: 생성 중 단계 표시(검색→근거→작성) / 미채택: 노력 단계 선택, Artifacts 목록 | https://support.elicit.com/en/articles/11241729 , https://support.elicit.com/en/articles/17220397-where-did-find-papers-extract-data-and-chat-with-papers-go (근거 인용문 표시 방식은 미확인) |
| Elicit | 리포트 결과 화면 (Reports) | 템플릿(General Review·1-Page Overview·Research Gap Analysis), 깊이(fast·balanced·comprehensive), 생성 중 우측 진행 사이드바, 문장 클릭 시 근거 인용과 추론 표시, 수행 단계 되돌아보기, 버전 선택, PDF·Word 내보내기, 단계별 표 CSV | 리포트 문장 클릭 시 근거 인용 표시, 생성 과정(단계) 열람, 버전 선택 | 채택: 문장 클릭 → 근거 인용 표시 / 보류(P2): 버전 선택 / 미채택: 단계 수정 후 재생성 | https://support.elicit.com/en/articles/4168449 |

## 반영 상태
- "채택"은 `03_SCREENS_UX.md` S-08·S-09·S-12 구성에 반영했다(2026-11-02).
- "후보"는 PRD 7장 결정 후 반영한다. "보류(P2)"는 MVP 이후 검토한다.
