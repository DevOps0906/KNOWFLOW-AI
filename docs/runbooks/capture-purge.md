# 런북: 캡처 삭제 대기열 처리

> 근거: [task-030 구현 결정 5](../../tasks/task-030.md) · 마이그레이션 `supabase/migrations/20261117000100_source_captures.sql` · 웹 `apps/web/src/server/captures/service.ts`(`purgeCaptures`)
> 대상: 유튜브 장면 캡처(L1) Storage 객체(버킷 `captures`).

## 1. 동작
- 자료 소프트 삭제(`delete_sources`)·비활성(`takedown_video`·재확인 스윕)·행 삭제(프로젝트·사용자 삭제 cascade 포함) 시 `sources` 트리거가 그 자료의 캡처 행을 지우고 경로를 `capture_purge_queue`에 넣는다. 자료를 복구해도 캡처는 돌아오지 않는다.
- 프로젝트 소프트 삭제(`delete_project`) 시 `projects` 트리거가 그 프로젝트 모든 자료의 캡처를 같은 대기열에 넣는다(reason `project_deleted`). 프로젝트를 복구해도 캡처는 돌아오지 않는다.
- 사용자 캡처 삭제(A-11 DELETE)·업로드 실패·확정(confirm) 오류는 `discard_capture`가 같은 대기열에 넣는다(실패 보상은 pending 행만 지운다).
- 확정 직전에 자료·프로젝트가 삭제돼 서버가 객체를 직접 지우다 실패하면 `enqueue_capture_purge`가 경로를 대기열에 다시 넣는다(reason `upload_failed`).
- 업로드가 끝나지 않은 채 10분 지난 pending 행은 다음 `reserve_capture` 때 대기열로 옮겨 지운다(reason `pending_expired`).
- 실제 객체 삭제는 웹 서버 `purgeCaptures()`가 한다: 대기열 경로를 Storage에서 지운 뒤 대기열 행을 지운다. A-11 DELETE·업로드 실패·자료 삭제(A-04 DELETE)·프로젝트 삭제(A-03 DELETE) 직후에 실행된다.
- 삭제 API 직후의 처리가 실패해도 삭제 응답은 성공이다. 서버 로그에 `capture_purge_failed <오류 코드>`(`purge_queue_read_failed`·`purge_remove_failed`·`purge_queue_delete_failed`)만 남고, 경로는 대기열에 남아 다음 삭제 API 실행 때 다시 처리된다.
- 미연결(확인 필요): 정기 실행. service_role 설정이 없는 환경과 반복 실패는 아래 수동 절차로 비운다.

## 2. 대기열 확인 (SQL 편집기, postgres 권한)

```sql
select reason, count(*), min(queued_at) as oldest from public.capture_purge_queue group by reason;
```

## 3. 수동 처리
- 경로 목록을 뽑는다.

```sql
select storage_path from public.capture_purge_queue order by queued_at limit 100;
```

- 각 경로의 객체를 지운다(대시보드 Storage > `captures` 또는 Supabase CLI `supabase storage rm ss:///captures/<storage_path> --experimental`, CLI 옵션은 확인 필요). 없는 객체는 이미 지워진 것으로 본다.
- 지운 경로만 대기열에서 뺀다.

```sql
delete from public.capture_purge_queue where storage_path = any (array['<storage_path>', '...']);
```

## 4. 확인
- 2의 쿼리 결과가 0건이고, 지운 자료의 경로 `{user_id}/{source_id}/`가 버킷에 남아 있지 않다.
- 법무 판정이 "불가"면 이 절차로 모든 객체를 지운 뒤 drop 마이그레이션을 적용한다(task-030 사용자 결정 ①).
