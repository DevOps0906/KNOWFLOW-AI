-- task-030 DB 검사(org안): L1 캡처 소유 조직 격리·영상당 20장·영상 삭제/비활성 시 제거·Storage 정책. 마지막에 rollback.
-- 실행(로컬 nomad DB, nomad-supabase-module 저장소에서): run_check.sh와 같은 방식으로 한 트랜잭션에 이어 붙인다.
--   { echo 'begin;'; cat products/knowflow/check_prelude.sql;
--     for f in products/knowflow/org/0*.sql; do sed '/^begin;$/d;/^commit;$/d' "$f"; done;
--     cat <KNOWFLOW>/packages/db-tests/sql/captures_check_org.sql; } \
--   | docker exec -i supabase_db_nomad-supabase-module psql -U postgres -v ON_ERROR_STOP=1 -q
-- 전제: 코어 시드에 knowflow 플랜 C의 knowledge_base 기능이 있다(check_org.sql과 같은 전제).
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a-cap@example.invalid', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'b-cap@example.invalid', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'c-cap@example.invalid', 'authenticated', 'authenticated');
insert into nomad_core.organizations (id, name) values
  ('01010101-0000-0000-0000-000000000001', '조직 1'),
  ('02020202-0000-0000-0000-000000000002', '조직 2');
insert into nomad_core.memberships (organization_id, user_id, role) values
  ('01010101-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'owner'),
  ('01010101-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000c', 'viewer'),
  ('02020202-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'owner');

-- 준비(postgres): O1 프로젝트, 유튜브 자료 2개(y1·y2)·PDF 자료 1개, 장면 카드
insert into nomad_knowflow.projects (id, organization_id, name) values
  ('10000000-0000-0000-0000-000000000001', '01010101-0000-0000-0000-000000000001', 'O1 프로젝트');
insert into nomad_knowflow.sources (id, project_id, organization_id, source_type, title, original_url, video_id, status) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '01010101-0000-0000-0000-000000000001',
   'youtube', '영상 1', 'https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk', 'completed'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '01010101-0000-0000-0000-000000000001',
   'youtube', '영상 2', 'https://www.youtube.com/watch?v=bcdefghijkl', 'bcdefghijkl', 'completed');
insert into nomad_knowflow.sources (id, project_id, organization_id, source_type, title, storage_path, status) values
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '01010101-0000-0000-0000-000000000001',
   'pdf', '문서', '01010101-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/x.pdf', 'completed');
insert into nomad_knowflow.source_moments (id, source_id, project_id, organization_id, moment_index, locator, title, description) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '01010101-0000-0000-0000-000000000001', 0, '{"t_start": 12.5, "t_end": 30}', '장면 1', '설명'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '01010101-0000-0000-0000-000000000001', 0, '{"t_start": 5, "t_end": 9}', '장면 2', '설명');

create temp table t_cap (k text primary key, j jsonb);
grant all on t_cap to public;

-- ===== 입력 검증 =====
select public.t_login('aaaaaaaa-0000-0000-0000-00000000000a');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'image/jpeg', 100)$q$, '22023');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'image/png', 2097153)$q$, '22023');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'image/png', 100)$q$, '22023');
-- 다른 자료의 장면 카드
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'image/png', 100)$q$, 'P0002');

-- ===== 영상당 20장, 21장째 거절 =====
insert into t_cap select 'first', nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'image/webp', 1000);
select public.t_eq((select count(*) from t_cap where j ->> 'storage_path' like
  '01010101-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/%.webp'), 1, '경로 = 조직/프로젝트/자료/캡처.webp');
select public.t_eq((select ((j ->> 't_seconds')::numeric * 10)::bigint from t_cap where k = 'first'), 125, '시각 = 장면 카드 t_start');
select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'image/png', 1000)
  from generate_series(2, 20);
select public.t_eq((select count(*) from nomad_knowflow.source_captures), 20, 'A는 20장 조회');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'image/png', 1000)$q$, 'KF429');
select public.t_eq((select count(*) from nomad_knowflow.source_captures), 20, '21장째 거절 후에도 20장');
-- 다른 영상은 따로 센다
insert into t_cap select 'y2', nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'image/png', 1000);

-- Storage: 행 경로에는 업로드 가능, 행 없는 경로는 불가
insert into storage.objects (bucket_id, name, metadata)
select 'knowflow-captures', j ->> 'storage_path', '{"size": 1000, "mimetype": "image/webp"}'::jsonb from t_cap where k = 'first';
select public.t_expect($q$insert into storage.objects (bucket_id, name) values ('knowflow-captures', '01010101-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/99999999-9999-9999-9999-999999999999.png')$q$, '42501');
select public.t_eq((select count(*) from storage.objects where bucket_id = 'knowflow-captures'), 1, 'A는 자기 캡처 객체 조회');

-- ===== viewer C: 읽기만 =====
select public.t_login('cccccccc-0000-0000-0000-00000000000c');
select public.t_eq((select count(*) from nomad_knowflow.source_captures), 21, 'viewer는 조직 캡처 읽기');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'image/png', 1000)$q$, 'P0002');
select public.t_eq((select nomad_knowflow.discard_source_capture((select (j ->> 'capture_id')::uuid from t_cap where k = 'y2'))::int), 0, 'viewer는 캡처 삭제 불가');

-- ===== B(조직 2): 타인 캡처 접근 불가 =====
select public.t_login('bbbbbbbb-0000-0000-0000-00000000000b');
select public.t_eq((select count(*) from nomad_knowflow.source_captures), 0, 'B는 조직 1 캡처를 볼 수 없음');
select public.t_eq((select count(*) from storage.objects where bucket_id = 'knowflow-captures'), 0, 'B는 조직 1 캡처 객체를 볼 수 없음');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'image/png', 1000)$q$, 'P0002');
select public.t_eq((select nomad_knowflow.discard_source_capture((select (j ->> 'capture_id')::uuid from t_cap where k = 'y2'))::int), 0, 'B는 조직 1 캡처 삭제 불가');
select public.t_expect(format($q$insert into storage.objects (bucket_id, name) values ('knowflow-captures', %L)$q$,
  '02020202-0000-0000-0000-000000000002/' || (select j ->> 'storage_path' from t_cap where k = 'y2')), '42501');
select public.t_expect($q$insert into nomad_knowflow.source_captures (source_id, project_id, organization_id, t_seconds, mime_type, byte_size, storage_path, created_by) values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '01010101-0000-0000-0000-000000000001', 0, 'image/png', 1, 'x', 'bbbbbbbb-0000-0000-0000-00000000000b')$q$, '42501');
select public.t_expect($q$select nomad_knowflow.claim_capture_object_trash(10)$q$, '42501');
select public.t_expect($q$select * from nomad_knowflow_private.capture_object_trash$q$, '42501');

-- ===== 업로드 실패 정리: discard → 정리 대기열 =====
select public.t_login('aaaaaaaa-0000-0000-0000-00000000000a');
select public.t_eq((select nomad_knowflow.discard_source_capture((select (j ->> 'capture_id')::uuid from t_cap where k = 'y2'))::int), 1, 'A는 방금 만든 캡처 삭제');

-- ===== 영상 삭제 시 캡처 제거 =====
select nomad_knowflow.delete_sources('10000000-0000-0000-0000-000000000001', array['20000000-0000-0000-0000-000000000001'::uuid]);
reset role;
select public.t_eq((select count(*) from nomad_knowflow.source_captures where source_id = '20000000-0000-0000-0000-000000000001'), 0, '자료 삭제 시 캡처 행 제거');
select public.t_eq((select count(*) from nomad_knowflow_private.capture_object_trash), 21, '지운 캡처 경로 21개 정리 대기(삭제 20 + discard 1)');
-- 고아가 된 객체는 아무도 읽을 수 없다(객체 삭제는 Storage API로 하므로 SQL 검사 밖: 직접 delete는 storage.protect_delete가 막는다)
select public.t_login('aaaaaaaa-0000-0000-0000-00000000000a');
select public.t_eq((select count(*) from storage.objects where bucket_id = 'knowflow-captures'), 0, '행이 지워진 객체는 읽기 불가');
reset role;

-- ===== 비활성(권리자 요청) 시 캡처 제거 =====
select public.t_login('aaaaaaaa-0000-0000-0000-00000000000a');
select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'image/png', 1000);
select public.t_role('service_role');
select nomad_knowflow.takedown_video('bcdefghijkl', '권리자 요청(검사)');
reset role;
select public.t_eq((select count(*) from nomad_knowflow.source_captures), 0, '비활성 시 캡처 행 제거');
select public.t_login('aaaaaaaa-0000-0000-0000-00000000000a');
select public.t_expect($q$select nomad_knowflow.create_source_capture('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'image/png', 1000)$q$, 'KF410');

-- ===== 정리 대기열: service_role만 꺼낸다 =====
select public.t_role('service_role');
select public.t_eq((select cardinality(nomad_knowflow.claim_capture_object_trash(1000))), 22, 'service_role이 정리 대기 경로 22개를 꺼냄');
select public.t_eq((select cardinality(nomad_knowflow.claim_capture_object_trash(1000))), 0, '꺼낸 경로는 다시 나오지 않음');
reset role;

select 'CAPTURES ORG CHECK PASSED' as result;
rollback;
