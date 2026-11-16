-- check.sh 전용 합성 데이터(옛 public 스키마). 실제 고객 데이터 아님. 사용자 2명(A beta, B 유료 pro) · 익명 0명.
-- 소프트 삭제(프로젝트·자료) · 멱등 키 · 유튜브 자료(영상 시간 차감) · 진행 중 작업 · 사용자 없는 사용량 · Storage 객체 포함.
-- 옛 KNOWFLOW에는 공유 링크 표가 없다.
\set ON_ERROR_STOP on
begin;

insert into public.plans (code, max_projects, max_sources_per_project, monthly_questions, monthly_reports, monthly_source_jobs)
values ('pro', 100, 200, 3000, 300, 1000);

-- 가입(옛 트리거가 profiles·user_quotas(beta)를 만든다)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
        'alice@example.test', '{"display_name":"Alice"}', false, '2026-10-01 09:00+09', '2026-10-01 09:00+09'),
       ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
        'bob@example.test', '{}', false, '2026-10-02 09:00+09', '2026-10-02 09:00+09');

-- 옛 시각 고정(touch 트리거를 피한다)
set local session_replication_role = replica;
update public.profiles set created_at = '2026-10-01 09:00+09', updated_at = '2026-10-03 09:00+09'
 where id = 'a0000000-0000-4000-8000-00000000000a';
update public.profiles set created_at = '2026-10-02 09:00+09', updated_at = '2026-10-02 09:00+09'
 where id = 'b0000000-0000-4000-8000-00000000000b';
update public.user_quotas set period_start = '2026-11-01', used_questions = 7, used_reports = 1, used_source_jobs = 2,
  used_video_seconds = 100, created_at = '2026-10-01 09:00+09', updated_at = '2026-11-10 09:00+09'
 where user_id = 'a0000000-0000-4000-8000-00000000000a';
update public.user_quotas set plan_code = 'pro', period_start = '2026-11-01', used_questions = 3,
  created_at = '2026-10-02 09:00+09', updated_at = '2026-11-11 09:00+09'
 where user_id = 'b0000000-0000-4000-8000-00000000000b';
set local session_replication_role = origin;

insert into public.projects (id, user_id, name, description, deleted_at, created_at, updated_at) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'A 연구', '설명', null, '2026-10-05 10:00+09', '2026-10-06 10:00+09'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'A 삭제됨', null, '2026-10-20 10:00+09', '2026-10-05 11:00+09', '2026-10-20 10:00+09'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'B 연구', null, null, '2026-10-07 10:00+09', '2026-10-08 10:00+09');

insert into public.sources (id, project_id, user_id, source_type, title, original_url, storage_path, content_hash, status,
  deleted_at, video_id, channel_title, duration_seconds, metadata_checked_at, video_seconds_charged, video_seconds_charged_period,
  created_at, updated_at) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'pdf', 'A 문서', null,
   'a0000000-0000-4000-8000-00000000000a/a1000000-0000-4000-8000-000000000001/f1.pdf', repeat('a', 64), 'completed',
   null, null, null, null, null, null, null, '2026-10-05 12:00+09', '2026-10-05 13:00+09'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'youtube', 'A 영상',
   'https://www.youtube.com/watch?v=abcdefghijk', null, null, 'completed',
   null, 'abcdefghijk', '채널', 100, '2026-11-01 09:00+09', 100, '2026-11-01', '2026-11-01 09:00+09', '2026-11-01 10:00+09'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'url', 'A 링크',
   'https://example.test/a', null, null, 'failed',
   '2026-10-20 10:00+09', null, null, null, null, null, null, '2026-10-05 14:00+09', '2026-10-20 10:00+09'),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'pdf', 'B 문서', null,
   'b0000000-0000-4000-8000-00000000000b/b1000000-0000-4000-8000-000000000001/f2.pdf', repeat('b', 64), 'processing',
   null, null, null, null, null, null, null, '2026-10-07 12:00+09', '2026-10-07 13:00+09');

insert into public.source_chunks (id, source_id, project_id, chunk_index, content, locator, created_at) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 0, 'A 본문 하나', '{"page":1}', '2026-10-05 13:00+09'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 1, 'A 본문 둘', '{"page":2}', '2026-10-05 13:00+09'),
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 0, 'B 본문', '{"page":1}', '2026-10-07 13:00+09');

insert into public.source_moments (id, source_id, project_id, user_id, moment_index, locator, title, description, created_at) values
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-00000000000a', 0, '{"t_start":0,"t_end":30}', '장면', '설명', '2026-11-01 10:00+09');

insert into public.conversations (id, project_id, user_id, title, created_at, updated_at) values
  ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'A 대화', '2026-10-06 09:00+09', '2026-10-06 09:05+09'),
  ('b5000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'B 대화', '2026-10-08 09:00+09', '2026-10-08 09:05+09');

insert into public.messages (id, conversation_id, role, content, citation_metadata, created_at) values
  ('a6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'user', '질문', '{}', '2026-10-06 09:01+09'),
  ('a6000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'assistant', '답변', '{"chunks":["a3000000-0000-4000-8000-000000000001"]}', '2026-10-06 09:02+09'),
  ('b6000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'user', 'B 질문', '{}', '2026-10-08 09:01+09');

insert into public.reports (id, project_id, user_id, title, content, status, created_at, updated_at) values
  ('a7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'A 보고서', '# 본문', 'ready', '2026-10-06 10:00+09', '2026-10-06 10:10+09'),
  ('b7000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'B 보고서', '', 'generating', '2026-10-08 10:00+09', '2026-10-08 10:00+09');

insert into public.report_citations (id, report_id, chunk_id, position, created_at) values
  ('a8000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 0, '2026-10-06 10:10+09'),
  ('a8000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', null, 1, '2026-10-06 10:10+09');

insert into public.processing_jobs (id, user_id, source_id, report_id, job_type, status, progress, attempt_count,
  started_at, finished_at, created_at, updated_at) values
  ('a9000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000001', null,
   'source_ingest', 'succeeded', 100, 1, '2026-10-05 12:01+09', '2026-10-05 13:00+09', '2026-10-05 12:00+09', '2026-10-05 13:00+09'),
  ('b9000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', null, 'b7000000-0000-4000-8000-000000000001',
   'report_generate', 'queued', 0, 0, null, null, '2026-10-08 10:00+09', '2026-10-08 10:00+09');

insert into public.usage_events (id, user_id, project_id, event_type, provider, model, input_tokens, output_tokens, estimated_cost, created_at) values
  ('aa000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'question', 'gemini', 'm', 100, 50, 12, '2026-10-06 09:02+09'),
  ('aa000000-0000-4000-8000-000000000002', null, null, 'question', 'gemini', 'm', 10, 5, 1, '2026-10-01 09:00+09');

insert into public.idempotency_keys (user_id, key, request_hash, resource_type, resource_id, created_at) values
  ('a0000000-0000-4000-8000-00000000000a', 'create-a1', md5('a1'), 'project', 'a1000000-0000-4000-8000-000000000001', '2026-10-05 10:00+09'),
  ('b0000000-0000-4000-8000-00000000000b', 'create-b1', md5('b1'), 'project', 'b1000000-0000-4000-8000-000000000001', '2026-10-07 10:00+09');

insert into public.auth_rate_limits (scope, key_hash, window_start, hits) values ('login', md5('ip'), '2026-11-16 09:00+09', 3);

-- 옛 버킷 객체(메타데이터만. 파일 본문은 Storage API 영역)
insert into storage.objects (bucket_id, name, metadata) values
  ('sources', 'a0000000-0000-4000-8000-00000000000a/a1000000-0000-4000-8000-000000000001/f1.pdf', '{"size":1234,"mimetype":"application/pdf"}'),
  ('sources', 'b0000000-0000-4000-8000-00000000000b/b1000000-0000-4000-8000-000000000001/f2.pdf', '{"size":999,"mimetype":"application/pdf"}');

commit;
