# JOBS — AI 작업 계약 (정본)

rag-chat·ocr-docs·stt-voice가 같은 컬럼·상태값을 쓴다. 테이블 이름은 모듈 접두사 `<모듈>_jobs`, `kind`·`step` 값만 모듈별.

## 작업 테이블 `<모듈>_jobs`
| 컬럼 | 형식 | 규칙 |
|---|---|---|
| id · org_id | uuid | org_id RLS |
| kind | text | 모듈별 작업 종류. STT: `transcribe` · `summarize` |
| status | text | `queued` · `running` · `succeeded` · `failed` · `cancelled` |
| progress | int 0~100 | 단조 증가(줄지 않음). 종료 시 succeeded=100 |
| attempts · max_attempts | int | `max_attempts` 기본 3. attempts ≤ max_attempts CHECK |
| idempotency_key | text | 유니크 (org_id, key). 같은 키·같은 입력이면 기존 작업 반환, 다른 입력이면 409 |
| input_ref · output_ref | JSON | 입력 = `{file_id}` 등 참조만(본문 금지). 출력 = `{transcript_id}` 등 |
| error_code | text | 사용자 안내용 코드(본문·경로 금지) |
| credits_reserved · credits_charged · credits_refunded | int | 선차감-환불(**선택** — 미사용이면 0). charged + refunded ≤ reserved |
| started_at · finished_at | timestamptz | 첫 running 시각 · 종료 시각 |

## 단계 테이블 `<모듈>_job_steps`
(job_id, step, status, seq, units_total, units_done). 유니크 (job_id, seq). step 값은 모듈별(STT: normalize · chunk · transcribe · merge · diarize · summarize).

## 상태 전이
| 대상 | 허용 전이 | 부수 효과 |
|---|---|---|
| 작업 queued | → running | 워커가 행 잠금 후 상태 재확인, started_at |
| 작업 queued | → cancelled | 예약 크레딧 전액 환불 |
| 작업 running | → succeeded | 결과 저장·이벤트 outbox를 같은 트랜잭션. 크레딧 정산(charged 확정 · 차액 환불) |
| 작업 running | → failed | attempts = max_attempts일 때만 최종 실패. 크레딧 전액 환불, 실패 이벤트 |
| 작업 running | → queued | 자동 재시도(attempts < max_attempts, 지수 간격). 끝난 단계 결과는 재사용 |
| 작업 running | → cancelled | 다음 단위(조각) 시작 전 취소 요청을 확인. 미실행분 환불 |
| 종료 상태 | 없음 | 종료된 작업의 쓰기는 거부. 종료 때 남은 단계 pending → skipped(취소면 cancelled), running → failed(`aborted`) |
| 단계 | pending → running · skipped · cancelled / running → succeeded · failed · cancelled | 종료 상태는 전이 없음 |

## 규칙
- **재시도 = 새 작업 생성**: 사용자의 "다시 시도"는 새 작업(새 멱등 키)을 만든다. **종료 상태(succeeded·failed·cancelled)의 작업은 되살리지 않고 쓰기를 거부한다.** `running → queued` 자동 재시도는 워커만 한다.
- 환불은 멱등 키 `refund:job:<job_id>`로 한 번만. 크레딧 연동은 선택.
- 모든 전이는 서버 함수만 수행하고 서비스 키 경유(`guard_privileged_write`). 클라이언트는 취소·재시도 요청만 보낸다.

이관 원문: stt-voice/README.md 3장(2026-10 이관 — 이제 이 문서가 정본).
