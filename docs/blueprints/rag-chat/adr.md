# ADR — RAG 색인·검색·생성 구성

- 상태: 채택 · 버전·라이선스 확인일 **2026-10-27**(웹 검색 2차 출처 다수, 공식 페이지 재확인 전 수치는 사실로 쓰지 않는다)
- 맥락: 플랫폼 AI 계층 설계(`platform-docs/products/_platform-core/AI_ARCHITECTURE.md#2~5`)의 조직 격리·서명 토큰·`match_ai_chunks`를 재사용한다. 라이선스 서술은 모두 **확인 필요**.

## 선택
| 영역 | 선택 |
|---|---|
| 색인·검색 | 우리 DB: pgvector(PostgreSQL License) + core `match_ai_chunks`. 한국어 키워드는 PGroonga 우선, 불가 시 pg_trgm(`common-modules/search.md#4`)로 하이브리드 |
| 생성 | FastAPI(+LangGraph, MIT) 기본. Dify는 선택(Chatflow가 FastAPI `/tools/answer`를 호출하는 경로만, 내장 지식베이스·조직 데이터 입력 금지) |
| 임베딩 | bge-m3 자체 호스팅 기본(라이선스 MIT 표기 **확인 필요**), 대안 KURE-v1·multilingual-e5. 컬렉션에 모델·차원(1024) 고정, 바꾸면 재색인 잡 |

## 대안
| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| 외부 벡터DB(예: Qdrant·Milvus 등) | 대규모·필터 성능 | 서버 추가, DB와 동기화, **RLS 밖이라 권한 필터를 직접 구현**. 라이선스·버전 확인 필요 | 보류 — 100만 청크 이하는 pgvector로 충분(공식 문서 기준 확인 필요), 넘으면 어댑터로 재검토 |
| Dify 내장 지식베이스 | 노코드, 빠른 시작 | 조직 격리 불가, 대화 로그에 근거 문서 내용 잔존 | **금지**(플랫폼 규칙). Dify 라이선스는 Apache-2.0 + 추가 조건(멀티테넌트 SaaS 상용 라이선스 등) — 확인 필요 |
| 상용 임베딩(OpenAI·Cohere 등) | 운영 부담 없음 | 문서 조각 국외 전송·처리 위탁 고지, 비용 | 조직 설정·국외 이전 동의 후 선택 |
| 키워드만(`simple` 전문 검색) | 단순 | 한국어 재현율 낮음 | 제외 |

## 임베딩 후보 비교 (공개 수치는 모델카드 자체 보고 — 독립 검증 필요)
| 후보 | 한국어 평균(자체 보고) | GPU | 입력 한도 | 라이선스 |
|---|---|---|---|---|
| bge-m3 | 약 69.2 | 권장(소형 CPU 가능) | 8192 토큰 | MIT 확인 필요 |
| multilingual-e5-large | 약 68.1 | 권장 | 512 토큰 | MIT 확인 필요 |
| KURE-v1 | 약 71.4 | 권장(bge-m3 기반) | 확인 필요 | 확인 필요 |
- 최신 순위는 라이브 리더보드 재확인 필요. 선택 절차: 조직 문서로 질의-정답 평가셋을 만들어 재현율·출처 정확도를 **자체 벤치마크**로 비교한 뒤 컬렉션 기본값을 정한다(평가셋 방식은 `AI_ARCHITECTURE#5 평가`).

## 결과
- 색인·권한·이력을 한 DB(RLS·트랜잭션)에서 다뤄 권한 필터 누락 위험이 낮다. 대신 `match_ai_chunks`는 컬렉션·조직 단위까지만 걸러, 결정에 따라 **SECURITY INVOKER 확장 함수 `rag_match_chunks`가 문서 ACL을 SQL에서 조인**한다(후처리는 이중 방어, core 설계 대조 확인 필요).
- HNSW + 조직 필터는 소규모 조직에서 결과가 k보다 적을 수 있어 `hnsw.iterative_scan`·`ef_search` 설정이 필요(pgvector 0.8 이상, 운영 측정 필요).
- 확인 필요(2026-10): pgvector 최신 안정 버전(참고값 0.8.x, 단일 출처) · PGroonga 사용 가능 여부(Supabase 확장 목록) · LangGraph·Dify 최신 버전과 서버 플랫폼 라이선스 · bge-m3·KURE-v1 라이선스 · 한국어 임베딩 순위.
