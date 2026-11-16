# 런북: 권리자 삭제 요청 처리

> 근거: [task-029 구현 결정 7](../../tasks/task-029.md) · [유튜브 검토 1·2장](../youtube-mvp-review.md) · 마이그레이션 `supabase/migrations/20261112000500_rights_takedown.sql`
> 대상: 유튜브 영상 자료(video_id 단위). PDF·웹 자료 요청은 이 런북 범위 밖이다(확인 필요).

## 1. 접수
- 창구: 이용약관(S-16)·개인정보처리방침(S-17)에 표시되는 이메일. 주소는 배포 설정 `RIGHTS_CONTACT_EMAIL`(사용자 결정, 비우면 화면에 "준비 중").
- 받을 것: 영상 주소, 권리자(또는 대리인) 이름·연락처, 권리를 확인할 수 있는 자료, 요청 내용.
- 접수 즉시 접수 번호(예: `RT-20261112-01`)를 정하고 접수 확인 회신을 보낸다. 처리 기한은 확인 필요.

## 2. 권리 확인
- 영상 주소에서 video_id(11자)를 뽑는다. `https://www.youtube.com/watch?v=<video_id>` 형식으로 맞춘다.
- 요청자가 해당 영상의 권리자(채널 소유자 또는 대리인)인지 제출 자료로 확인한다. 판단이 어려우면 실행하지 않고 법무 확인으로 넘긴다(기준은 확인 필요).
- 영향 범위를 먼저 본다(SQL 편집기, postgres 권한).

```sql
select count(*) as sources, count(*) filter (where unavailable_at is null) as active
  from public.sources where video_id = '<video_id>';
```

## 3. 실행
- `takedown_video`는 service_role 전용이다. SQL 편집기에서 역할을 바꿔 실행한다. 사유에는 접수 번호를 넣고 개인정보(요청자 이름·이메일)는 넣지 않는다.

```sql
begin;
set local role service_role;
select public.takedown_video('<video_id>', 'RT-20261112-01 권리자 요청');
commit;
```

- 결과 `{sources, chunks_deleted, moments_deleted, summaries_deleted, active_jobs}`를 접수 기록에 옮긴다.
- 하는 일: 모든 사용자의 해당 video_id 자료(삭제된 자료 포함)에 `unavailable_at` 설정, 청크·장면·요약 삭제, `rights_takedowns`에 기록. 제목·채널·길이는 다음 재확인 스윕이 파기한다.
- `active_jobs`가 0보다 크면: 진행 중이던 수집 작업은 비활성 자료에 청크·장면을 쓰지 못한다(`replace_source_chunks`·`replace_source_moments`가 거부). 확인을 위해 작업이 끝난 뒤(아래 쿼리 0건) 같은 명령을 한 번 더 실행해 삭제 건수가 0인지 본다.

```sql
select count(*) from public.processing_jobs j join public.sources s on s.id = j.source_id
 where s.video_id = '<video_id>' and j.job_type = 'source_ingest' and j.status in ('queued', 'running');
```

- 확인: 아래가 모두 0이어야 한다.

```sql
select (select count(*) from public.source_chunks c join public.sources s on s.id = c.source_id where s.video_id = '<video_id>') as chunks,
       (select count(*) from public.source_moments m join public.sources s on s.id = m.source_id where s.video_id = '<video_id>') as moments,
       (select count(*) from public.sources where video_id = '<video_id>' and unavailable_at is null) as active;
```

- 되돌리기는 지원하지 않는다(삭제한 청크·장면은 복구하지 않는다).

## 4. 회신
- 처리 완료, 처리 시각, 대상 영상 주소를 요청자에게 회신한다. 몇 명의 이용자가 등록했는지 같은 이용자 정보는 알리지 않는다.
- 거절·보류하면 사유와 추가로 필요한 자료를 회신한다.

## 5. 기록 보존
- `rights_takedowns`(video_id·사유·처리 건수·시각)는 사용자·Worker가 읽을 수 없고 postgres 권한으로만 조회한다.

```sql
select * from public.rights_takedowns where video_id = '<video_id>' order by created_at;
```

- 접수 메일과 확인 자료는 DB 밖(운영 메일함)에 접수 번호로 보관한다. 보존 기간은 확인 필요.
- `rights_takedowns`에 기록된 video_id는 어느 사용자도 다시 등록할 수 없다(`register_youtube_source`가 KF451 `video_taken_down`으로 거부, 화면 문구 "권리자 요청으로 삭제된 영상이라 등록할 수 없습니다."). 기록 행을 지우면 차단도 풀리므로 보존 기간 정책과 함께 정한다.
