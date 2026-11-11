# 유튜브 Phase 0 측정 도구 (task-025)

의존성 없음(Node 내장만). 영상·음성·자막을 내려받지 않고 Gemini에 YouTube URL만 넘긴다. 결과와 기준은 [`docs/youtube-phase0-result.md`](../../docs/youtube-phase0-result.md).

## 실행
1. `videos.example.json`을 복사해 `videos.json`을 만든다. `rights_basis`가 없거나 `youtube.com`·`www.`·`m.`·`youtu.be` 외 URL이면 전체 거부. `duration_sec`는 사람이 영상 길이를 초로 적는다.
2. `labels/<영상 id>.json`에 정답 라벨을 쓴다(아래 양식). 라벨이 없는 영상이 있으면 `run.mjs`는 호출 없이 거부한다. 실행 기록에 라벨 SHA-256이 남고, 실행 뒤 라벨을 고치면 그 영상은 `label_changed`로 측정에서 빠진다.
3. 20분 넘는 영상이 있으면 먼저 대조 실험을 한다. 판정이 `inconclusive`이면 분할 호출은 거부된다.
   ```
   node --env-file=apps/web/.env.local scripts/phase0-youtube/run.mjs --offset-check
   ```
4. 호출과 측정:
   ```
   node --env-file=apps/web/.env.local scripts/phase0-youtube/run.mjs --max-videos 10
   node scripts/phase0-youtube/measure.mjs
   ```
5. 테스트: `node --test "scripts/phase0-youtube/*.test.mjs"` (따옴표 포함, 외부 호출 없음. 임시 파일은 `output/test-*`에 만들고 지운다)

| `run.mjs` 옵션 | 기본 | 뜻 |
|---|---|---|
| `--model <id>` | `gemini-3.5-flash` | 모델 ID |
| `--only a,b` | 전체 | 처리할 영상 id |
| `--repeat N` | 1 | 영상당 반복 횟수(분산 보고). `--only`와 함께 쓴다 |
| `--max-videos N` | 없음 | UTC 하루 동안의 실행 건수 상한 |
| `--chunk-sec` · `--overlap-sec` | 1200 · 30 | 긴 영상 분할 |
| `--offset-check` | 끔 | 클립 시각의 절대·상대 대조 실험(2회 호출, 길이 300초 이상 영상 필요) |

- `GEMINI_API_KEY`는 환경 변수로만 받는다. 전사·제목·응답 본문은 터미널에 나오지 않는다.
- `--root`(두 스크립트 공통)는 이 폴더 또는 그 아래만 허용한다.
- 재실행은 `run-NNN.json`을 새 번호로 쌓고 `output/ledger.jsonl`(append-only 원장)에 번호·상태·파일 해시를 남긴다. 원장과 응답 파일이 어긋나면 `measure.mjs`는 거부한다.
- 측정은 현재 모델(`measure.mjs --model`, 기본 `gemini-3.5-flash`)·현재 프롬프트 해시의 실행 중 가장 앞선 유효 실행을 채택하고, 뒤 실행은 분산 계산에만 쓴다. 비용은 조건과 무관하게 그 영상의 모든 실행·재시도 토큰을 실행별 단가로 합산한다.
- 프롬프트·스키마는 `common.mjs`에 있다. 바꾸면 해시가 달라져 이전 실행은 채택 대상에서 빠진다.
- 단가: 이 폴더에 `pricing.json`을 직접 만든다. 없거나 출처·확인일이 비면 "단가 미확인"으로 토큰만 보고한다.
  ```json
  { "gemini-3.5-flash": { "input_per_1m_usd": 0, "output_per_1m_usd": 0, "thinking_per_1m_usd": 0, "source_url": "공식 단가 URL", "checked_at": "YYYY-MM-DD" } }
  ```

## 라벨 양식 (`labels.example.json`)
| 필드 | 내용 |
|---|---|
| `video_id` | `videos.json`의 `id` |
| `fillers` | `ignore`면 단독 토큰 어·음·그 제외, `keep`이면 유지 |
| `eval_windows` | 평가 창 `{start,end}`(초). 시간순·겹침 금지. 20분 넘는 영상은 전체 라벨 금지 |
| `segments` | 창 안의 정답 문장 `{t_start,t_end,text}` |
| `numbers` | `{segment,surface,forms}`: `segment`는 `segments` 인덱스, `surface`는 그 문장의 표기, `forms`는 인정 표기(`["2024","이천이십사"]`). CER에서 빼고 별도 평가 |
| `proper_nouns` | `{segment,surface,aliases}`. CER에 포함하고 일치율도 별도 집계 |
| `nonspeech` | `{start,end,kind}`, `kind`는 `silence`·`music`·`lyrics`(노래 가사). `has_nonspeech`와 일치해야 한다 |
| `scenes` | 사람이 고른 중요 장면 `{t}`(참고값) |

## 수동 체크리스트 (데스크톱, 결과 문서 4장에 기록)
- [ ] YouTube 임베드(IFrame)가 각 영상에서 재생된다
- [ ] 임베드에서 지정 시각으로 이동된다
- [ ] L1 탭 공유 캡처(`getDisplayMedia`) 권한 요청과 탭 선택이 동작한다
- [ ] 임베드 재생 중 프레임 캡처가 비어 있지 않게 저장된다
- [ ] 사용한 브라우저·버전과 실패 현상을 적었다

판정이 끝나면 결과 문서 5장의 예정일에 `videos.json`·`labels/`·`responses/`·`output/`을 삭제한다.
