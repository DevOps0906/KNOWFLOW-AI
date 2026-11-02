# RAG Chat — 데이터 모델 (plan2spec 입력)
> KNOWFLOW-AI: 이 표의 행은 docs/03_SCREENS_UX.md·04_API.md·05_DATA_MODEL.md로 옮겨 정본화했다(2026-11-02). 원본 행은 upstream nomad-blueprints-module 참조.

공통 규칙: 개인정보·민감 컬럼은 ★. 공통 컬럼 created_at · updated_at. 모든 테이블 `org_id` + 조직 RLS(`app_id`='rag-chat'). 권한 판정은 auth-rbac `has_permission`(미설치 시 core 헬퍼).
**core 확장 구조**: `rag_collections`·`rag_documents`·`rag_chunks`는 core `ai_collections`·`ai_documents`·`ai_chunks`와 **같은 id를 쓰는 모듈 확장 행**(복합 외래키 (id, org_id, app_id)로 다른 조직 라벨 불가). 임베딩 벡터(`vector(1024)`, HNSW cosine)는 `ai_chunks`에 두고 `match_ai_chunks`(service_role 전용, org·app 필터 강제)를 재사용한다. 근거 `_platform-core/AI_ARCHITECTURE.md#5`, core_lite.sql `match_ai_chunks`. **core 설계 대조 확인 필요**.
**ACL 강제**: SECURITY INVOKER 확장 함수 `rag_match_chunks(요청자, 컬렉션, 쿼리 벡터, k)`가 `match_ai_chunks` 결과에 `rag_documents`·`rag_chunks` ACL을 조인해 권한 밖 청크를 반환에서 제외한다(서버 후처리는 이중 방어).
**접근 범위(ACL)**: 문서가 `visibility`(org · roles · users · owner_only)와 `allowed_roles`·`allowed_user_ids`를 갖고, 청크는 사본과 `acl_version`을 갖는다. 검색은 두 버전이 같은 청크만 쓴다.
입력 파일은 files-storage `file_id`로만 받는다(미설치 시 Storage 경로 규칙 CORE_SPEC#10). 질문·답변·사유는 개인정보로 보고 로그에 원문을 남기지 않는다. 임베딩 모델·차원은 컬렉션에 고정하고 바꾸면 재색인한다.

| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
