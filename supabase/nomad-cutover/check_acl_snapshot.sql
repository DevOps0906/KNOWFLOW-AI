-- check.sh 전용: 옛 public 객체 권한·함수 본문 지문(01_freeze 전과 01_freeze_undo 뒤가 같아야 한다)
select md5(string_agg(x, '|' order by x)) from (
  select 't:' || c.oid::regclass || ':' || a.grantee || ':' || a.privilege_type || ':' || a.is_grantable as x
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  union all
  select 'f:' || p.oid::regprocedure || ':' || a.grantee || ':' || a.privilege_type || ':' || a.is_grantable
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace and p.proname not like 'nomad\_%'
  union all
  select 's:' || p.oid::regprocedure || ':' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'nomad\_%') s;
