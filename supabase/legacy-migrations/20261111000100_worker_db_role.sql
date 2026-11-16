-- task-010: Worker 전용 접속 역할. 비슈퍼유저 LOGIN이며 service_role로 SET ROLE 할 때만 큐 함수를 쓸 수 있다.
-- noinherit이라 접속만으로는 service_role 권한을 받지 않는다.
-- 비밀번호는 여기서 정하지 않는다(로컬: compose의 migrate 서비스, 운영: 배포 단계에서 별도 설정). 설정 전에는 로그인할 수 없다.
do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'knowflow_worker') then
    create role knowflow_worker login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
  end if;
end
$$;

grant service_role to knowflow_worker;
