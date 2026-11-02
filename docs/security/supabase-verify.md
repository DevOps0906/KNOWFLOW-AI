# 실제 Supabase에서만 확인할 항목 (ADR-0005)

확인 시점: task-005(인증) 완료 전, 개발 Supabase 프로젝트(서울)에 `supabase/migrations`를 한 번 적용한 뒤.

| 항목 | 확인 방법 | 상태 |
|---|---|---|
| 가입 트리거 | Auth로 가입 → profiles·user_quotas 행 생성 | 대기 |
| Storage 정책 | 첫 폴더 = user_id, 타인 폴더 업로드·읽기 거부, upsert 시 UPDATE 정책 | 대기 |
| 기본 권한 회수 | anon·authenticated로 PostgREST 직접 INSERT·UPDATE·DELETE 거부 | 대기 |
| RPC 노출 | anon으로 /rpc 호출 거부, authenticated는 허용 목록만 | 대기 |
| 마이그레이션 적용 | 전체 마이그레이션 오류 없이 적용 | 대기 |
