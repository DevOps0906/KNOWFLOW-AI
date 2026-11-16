#!/usr/bin/env bash
# KNOWFLOW nomad DB 전환 스크립트 검사(일회용 로컬 DB). 운영 DB에 접속하지 않는다.
# 사용: bash supabase/nomad-cutover/check.sh   (컨테이너 기본 supabase_db_nomad-supabase-module, NOMAD_CUTOVER_CONTAINER로 변경)
# 흐름: 일회용 DB cutover_knowflow 생성(auth·storage·vault 골격 복제) → legacy-migrations → 합성 seed → 01 freeze(차단 확인)
#   → 새 migrations(= repair + db push) → 코어 시드 → 02 플랜 대응 누락 거부 → 02 dry-run(변경 없음) → 02 apply → 값·RLS 대조
#   → 02 재실행 거부 → 익명 행 중단 → 03 목록·복사 단위 검사·대조(누락 거부/통과) → 01 undo(권한·함수 원상) → DB 삭제
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
sb="$(cd "$dir/.." && pwd)"
C="${NOMAD_CUTOVER_CONTAINER:-supabase_db_nomad-supabase-module}"
DB=cutover_knowflow
PLAN_MAP='beta:B,pro:A'
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

admin() { docker exec -i "$C" psql -U supabase_admin -v ON_ERROR_STOP=1 -q "$@"; }
pg() { docker exec -i "$C" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
step() { echo "== $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
# 실패해야 하는 실행: 종료 코드 0이면 FAIL, 출력에 기대 코드가 없으면 FAIL
expect_fail() {
  local want="$1"; shift
  if "$@" >"$tmp/out" 2>&1; then cat "$tmp/out"; fail "실패해야 하는데 통과: $want"; fi
  grep -q "$want" "$tmp/out" || { cat "$tmp/out"; fail "기대한 오류가 아님: $want"; }
  echo "ok: 거부됨($want)"
}
count() { pg -At -c "$1"; }

step "일회용 DB $DB 생성"
admin -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB owner postgres" 2>&1 | grep -v NOTICE || true
admin -d "$DB" -c "create schema extensions" \
  -c "create extension pgcrypto with schema extensions" -c 'create extension "uuid-ossp" with schema extensions' \
  -c "create extension pg_trgm with schema extensions" -c "create extension vector with schema extensions"
# auth·storage·vault 골격은 같은 컨테이너의 postgres DB에서 구조만 복제(데이터 없음). 다른 제품 트리거는 뺀다
docker exec "$C" pg_dump -U supabase_admin -d postgres --schema-only -n auth -n storage -n vault -n extensions \
  | sed -e '/^CREATE SCHEMA extensions;/d' -e '/^CREATE TRIGGER .*EXECUTE FUNCTION \(nomad_\|public\)/d' \
  | admin -d "$DB" >/dev/null
admin -d "$DB" -c "create extension supabase_vault with schema vault"
# Supabase 기본 권한(postgres가 public에 만든 객체 → anon·authenticated·service_role)
pg -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role" \
   -c "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role" \
   -c "alter default privileges in schema public grant all on functions to anon, authenticated, service_role"

step "옛 migrations(legacy-migrations) 적용"
for f in "$sb"/legacy-migrations/*.sql; do pg < "$f" >/dev/null 2>"$tmp/err" || { cat "$tmp/err"; fail "$f"; }; done
step "합성 seed"
pg < "$dir/check_seed.sql" >/dev/null
acl_before="$(pg -At < "$dir/check_acl_snapshot.sql")"

step "01 freeze"
pg < "$dir/01_freeze.sql" 2>&1 | grep -v '^$' || true
pg < "$dir/check_frozen.sql"
expect_fail already_frozen pg -f /dev/stdin < "$dir/01_freeze.sql"

step "새 migrations 적용(운영: migration repair --status reverted 옛 버전 → db push)"
for f in "$sb"/migrations/*.sql; do pg < "$f" >/dev/null 2>"$tmp/err" || { cat "$tmp/err"; fail "$f"; }; done
step "코어 시드(운영: 코어 시드가 먼저 있어야 한다)"
pg -c "insert into nomad_core.products (code, name) values ('knowflow', 'KNOWFLOW AI') on conflict do nothing" \
   -c "insert into nomad_core.plans (product_code, code, name) values ('knowflow','A','A'),('knowflow','B','B'),('knowflow','C','C') on conflict do nothing"

step "02 시작 검사"
expect_fail plan_map_required pg < "$dir/02_copy.sql"
expect_fail unmapped_plan pg -v plan_map=beta:B < "$dir/02_copy.sql"

step "02 dry-run(변경 없음)"
pg -v plan_map="$PLAN_MAP" < "$dir/02_copy.sql" >/dev/null
[ "$(count "select (select count(*) from nomad_knowflow.projects) + (select count(*) from nomad_core.subscriptions where product_code = 'knowflow')")" = 0 ] \
  || fail "dry-run이 데이터를 남겼다"
[ "$(count "select count(*) from nomad_core.profiles where display_name = 'Alice'")" = 0 ] || fail "dry-run이 profiles를 바꿨다"
echo "ok: dry-run 변경 없음"

step "02 apply"
pg -v plan_map="$PLAN_MAP" -v apply=true < "$dir/02_copy.sql"
pg < "$dir/check_after.sql"

step "02 재실행 거부"
expect_fail target_not_empty pg -v plan_map="$PLAN_MAP" -v apply=true < "$dir/02_copy.sql"

step "익명 소유 행이면 중단(건수 보고)"
pg -c "insert into auth.users (instance_id, id, aud, role, is_anonymous) values ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', true)" \
   -c "insert into public.profiles (id) values ('d0000000-0000-4000-8000-00000000000d')" \
   -c "insert into public.projects (id, user_id, name) values ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000d', '익명')"
expect_fail anonymous_owned_rows pg -v plan_map="$PLAN_MAP" < "$dir/02_copy.sql"
grep -q '"projects": 1' "$tmp/out" || { cat "$tmp/out"; fail "익명 건수 보고 없음"; }
pg -c "delete from auth.users where id = 'd0000000-0000-4000-8000-00000000000d'"

step "03 Storage 목록·복사 단위 검사·대조"
pg -At < "$dir/03_storage_map.sql" > "$tmp/map.tsv"
[ "$(grep -c . "$tmp/map.tsv")" = 2 ] || { cat "$tmp/map.tsv"; fail "Storage 목록 건수"; }
(cd "$dir" && node check_storage_copy.mjs "$tmp/map.tsv")
node "$dir/03_storage_copy.mjs" "$tmp/map.tsv" | tail -1
expect_fail storage_mismatch pg < "$dir/03_storage_verify.sql"
# 복사 흉내: 한 건은 크기가 다르게 → 거부, 맞추면 통과
pg -c "insert into storage.objects (bucket_id, name, metadata)
       select 'knowflow-sources', ns.storage_path, jsonb_build_object('size', (o.metadata->>'size')::bigint + case when os.user_id = 'b0000000-0000-4000-8000-00000000000b' then 1 else 0 end)
         from nomad_knowflow.sources ns join public.sources os on os.id = ns.id
         join storage.objects o on o.bucket_id = 'sources' and o.name = os.storage_path"
expect_fail storage_mismatch pg < "$dir/03_storage_verify.sql"
pg -c "update storage.objects set metadata = jsonb_set(metadata, '{size}', '999') where bucket_id = 'knowflow-sources' and name like '%/f2.pdf'"
pg < "$dir/03_storage_verify.sql" 2>&1 | grep storage_ok || fail "Storage 대조"

step "01 undo(권한·함수 원상)"
pg < "$dir/01_freeze_undo.sql" 2>&1 | grep -v '^$' || true
[ "$(pg -At < "$dir/check_acl_snapshot.sql")" = "$acl_before" ] || fail "undo 뒤 권한·함수가 freeze 전과 다르다"
[ "$(count "select count(*) from pg_namespace where nspname = 'nomad_cutover'")" = 0 ] || fail "nomad_cutover 남음"
expect_fail not_frozen pg < "$dir/01_freeze_undo.sql"
echo "ok: undo 원상 복구"

admin -d postgres -c "drop database $DB with (force)"
echo "PASS: KNOWFLOW nomad-cutover check"
