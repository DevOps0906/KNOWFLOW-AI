# 벤치마크: 자료 매체 유형 (Readray · NotebookLM)

기준일 2026-11-02. 공식 도움말·공식 페이지에서 직접 연 내용만 적었다. 칸 표기는 R=Readray, N=NotebookLM이고, "목록 없음"은 공식 지원 목록에 그 매체가 없다는 뜻이다. NotebookLM 도움말에는 현재 제품명이 "Gemini Notebook"으로 표기돼 있다.
공통 제한: R은 파일당 2GB, 한 번에 10개(Free)·20개(유료), Free 자료 100개[R1][R5]. N은 소스당 50만 단어 또는 업로드 200MB, Free 노트북당 소스 50개[N1].
인용 위치: R은 영상·오디오가 시각(예: 1:01), PDF·문서가 페이지(예: p.3), 일부 웹은 위치 없이 원문 링크만 준다[R3]. N은 원문 구절을 인용하고 클릭하면 원문 맥락으로 이동한다. 페이지·시각 표시는 문서에 언급이 없다[N2].

| 매체 | Readray | NotebookLM | 입력 방법 | 처리 방식 | 인용 위치 | 제한 | 근거 |
|---|---|---|---|---|---|---|---|
| YouTube | O (재생목록·채널 포함) | O (공개 영상만) | URL. R은 확장 프로그램 배지도 지원 | R: 자막이 없으면 자체 STT로 전사. N: 자막(업로드·자동 생성) 텍스트만 가져옴 | R: 시각 / N: 구절 | R: 최대 30시간, 일부공개 영상은 Basic 이상, 비공개 불가. N: 자막 50만 단어까지, 업로드 72시간 이내 영상은 불가 | R1, N1 |
| 오디오 파일 | O (MP3·WAV·M4A) | O (MP3·WAV 등) | 업로드 | R: 언어를 고르면 전사. N: 가져올 때 전사해 텍스트로 저장, 약 75개 언어 | R: 시각 / N: 구절 | R: 2GB. N: 200MB, 음성이 없으면 불가 | R1, R2, N1 |
| 영상 파일 | O (MP4·MOV·AVI·MKV·WMV·FLV·WEBM) | 목록 없음 | 업로드, 데스크톱 앱 | R: 언어를 고르면 전사 | R: 시각 | R: 2GB | R1, R2 |
| 팟캐스트 | O | 미확인 | R: 링크 또는 음성 파일 | R: 자동 받아쓰기 | R: 시각 | 미확인 | R6 |
| 녹음(실시간) | O | 목록 없음 | R: 마이크 녹음(웹 브라우저) | R: 실시간 전사, 화자 분리, 번역 | 미확인 | R: 약 600크레딧/시간, 다른 소스와 합칠 수 없음 | R1, R4 |
| PDF(텍스트) | O | O | 업로드. R은 Zotero도 지원 | 텍스트 추출(세부 비공개) | R: 페이지 / N: 구절 | R: 2GB / N: 200MB | R1, N1 |
| PDF(스캔) | O | 미확인 | 업로드 | R: OCR. 읽을 텍스트가 없으면 오류 | R: 페이지 | R: 2GB | R1 |
| Word | O (DOCX) | O (docx) | 업로드 | 미확인 | R: 페이지 / N: 구절 | R: 2GB / N: 200MB | R1, R6, N1 |
| PPT | O (PPTX·PPT) | O (pptx, Google Slides) | 업로드, Drive | 미확인 | R: 페이지 / N: 구절 | N: Slides 100장까지 | R1, N1 |
| Excel·CSV | O (XLSX·XLS) | O (CSV, Google Sheets) | 업로드, Drive | 미확인 | R: 미확인 / N: 구절 | N: Sheets 10만 토큰 | R1, N1 |
| HWP·TXT·MD | O (HWP·HWPX·TXT·MD) | O (txt·md) | 업로드 | 미확인 | R: 페이지 / N: 구절 | R: 2GB | R1, N1 |
| 이미지 | O (JPG·PNG) | O (avif·bmp·gif·heic·png·tiff·webp·jpg) | 업로드 | N: "일부 이미지는 잘 안 될 수 있음" | 미확인 | R: 2GB | R1, N1 |
| 웹페이지 | O | O | URL. R은 로그인·유료 벽 페이지를 확장 프로그램으로 가져옴 | R: 서버가 가져옴. N: HTML 텍스트만 가져오고 이미지·임베드 영상·하위 페이지는 제외 | R: 위치 없이 링크만(일부) / N: 구절 | N: 유료 벽 불가 | R1, R3, N1 |
| 텍스트 붙여넣기 | O | O | 붙여넣기 | — | R: 미확인 / N: 구절 | R: 100~100,000자 | R1, N1 |
| Google Docs·Drive | 목록 없음 | O | N: Drive에서 가져옴(보기 권한 이상) | N: 몇 분마다 자동 동기화. 각주·댓글 제외, 여러 탭은 하나로 합침 | N: 구절 | 미확인 | N1 |
| Zotero 연동 | O | 목록 없음 | R: Zotero 라이브러리의 PDF | — | R: 페이지 | 미확인 | R2 |
| ePub·Play Books | 목록 없음 | O | N: 업로드, Play Books에서 구매한 책 | N: 텍스트만 | N: 구절 | 미확인 | N1 |

Notion 연동: 두 서비스 모두 공식 목록에 없다.
근거: [R1](https://help.lilys.ai/en/articles/14474128-what-you-can-import-and-the-limits) · [R2](https://help.lilys.ai/en/articles/14474366-import-sources) · [R3](https://help.lilys.ai/en/articles/11704028-sentence-level-citations-timestamps-and-the-original-viewer) · [R4](https://help.lilys.ai/en/articles/11704172-live-recording) · [R5](https://help.lilys.ai/en/articles/11704849-is-there-a-limit-to-upload-size) · [R6](https://readray.ai/ko/features/) · [N1](https://support.google.com/notebooklm/answer/16215270?hl=en) · [N2](https://support.google.com/notebooklm/answer/16179559?hl=en)

## KNOWFLOW 확장 시 고려
- 오디오·영상 파일: STT 전사, 화자 분리, 타임코드 정렬이 필요하다. 인용 단위는 시각(mm:ss)이다. 파일 크기와 전사 비용 상한을 정해야 한다.
- YouTube: MVP는 Gemini URL 입력, 서버 수집 없음(ADR-0006). 인용 단위는 시각이다. 다운로드·스크래핑은 YouTube 약관과 저작권 위험이 있으니 공개 영상으로 범위를 좁히고(공식 자막 API는 영상 편집 권한이 필요해 타인 영상에 못 쓴다, [ADR-0006](adr/0006-youtube-summary-and-capture-mvp.md)), 삭제·비공개 전환 시 소스를 제거하는 정책이 필요하다(N은 30일 안에 제거).
- 스캔 PDF·이미지: OCR과 레이아웃 복원이 필요하다. 인용 단위는 페이지(가능하면 영역 좌표)다. OCR 신뢰도가 낮을 때 경고를 보여 줘야 한다.
- Office·HWP: 형식별 파서가 필요하다(HWP는 국내 필수). 인용 단위는 PPT는 슬라이드, Excel은 시트·셀 범위, Word·HWP는 페이지 또는 문단이다.
- 웹 URL: 본문 추출과 스냅샷 보관이 필요하다(원문이 바뀌어도 인용 근거를 유지하기 위해). 유료 벽·로그인 페이지는 제외하고 robots·약관을 준수한다. 인용 단위는 문단 앵커다.
- 실시간 녹음·Drive 연동: 녹음은 동의 고지와 개인정보 보관 기간 정책, 연동은 OAuth 최소 권한과 동기화 시 인용 위치 무효화 처리가 필요하다.
