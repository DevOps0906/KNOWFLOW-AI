#!/bin/sh
# 로컬 compose 전용 일회성 마이그레이션: bootstrap.sql → supabase/migrations 순서로 한 번씩 적용한다.
# 비밀번호는 환경 변수로만 받고 psql 안에서 \getenv로 읽어 명령줄·로그에 남기지 않는다.
set -eu

run_psql() {
  psql -X -q -v ON_ERROR_STOP=1 "$@"
}

run_psql -c "create schema if not exists kf_local; create table if not exists kf_local.applied (name text primary key, applied_at timestamptz not null default now());"

already_applied() {
  [ "$(run_psql -At -c "select 1 from kf_local.applied where name = '$1'")" = "1" ]
}

apply() {
  if already_applied "$2"; then
    return 0
  fi
  echo "적용: $2"
  run_psql -1 -f "$1" -c "insert into kf_local.applied (name) values ('$2')"
}

apply /migrate/bootstrap.sql bootstrap.sql
for f in /migrate/migrations/*.sql; do
  apply "$f" "$(basename "$f")"
done

# 비밀번호는 마이그레이션 밖에서 설정한다(마이그레이션의 역할은 비밀번호 없이 만들어진다)
run_psql <<'SQL'
\getenv pw WORKER_DB_PASSWORD
alter role knowflow_worker password :'pw';
SQL
echo "마이그레이션 완료"
