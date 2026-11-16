# KNOWFLOW nomad DB 전환 절차 (운영 데이터 이관)

옛 `public` 스키마(옛 마이그레이션 17개, `supabase/legacy-migrations/`)의 데이터를 nomad 공용 DB 구조(`nomad_core` + `nomad_knowflow`, 조직안)로 옮기는 1회 절차다.
스키마는 `supabase/migrations/`로만 push하고, 데이터 복사는 사람이 `supabase/nomad-cutover/`의 스크립트로 실행한다. 옛 표·함수·버킷은 지우지 않는다(삭제는 별도 작업).

| 파일 | 내용 |
|---|---|
| `01_freeze.sql` / `01_freeze_undo.sql` | 옛 쓰기 동결 / 기록대로 원상 복구 |
| `02_copy.sql` | 한 트랜잭션 복사. 기본 dry-run, `-v apply=true`일 때만 commit |
| `03_storage_map.sql` · `03_storage_copy.mjs` · `03_storage_verify.sql` | PDF 객체 목록 → Storage API 복사 → 개수·크기 대조 |
| `check.sh` | 일회용 로컬 DB에서 전체 흐름 검사(운영 접속 없음) |

## 0. 결정·전제
- 소유: 옛 `user_id` → 그 사용자의 **개인 조직**(`kind = 'personal'`, `created_by` = 사용자, owner 멤버십). 개인 조직은 새 migrations의 백필(`20261114000100`)이 만든다. 개인 조직이 없거나 여럿인 사용자가 있으면 02가 중단한다.
- 플랜: 옛 `user_quotas.plan_code`(현재 `beta` 1종) → 개인 조직의 `nomad_core.subscriptions`(knowflow, active) 1행. 대응은 실행 때 `-v plan_map=beta:<A|B|C>`로 준다. **beta를 A·B·C 중 무엇으로 옮길지는 결정 필요**(대응표: 이 저장소가 아닌 nomad-supabase-module `products/knowflow/existing.md` "운영 데이터 이관"). 대응 없는 옛 값이 하나라도 있으면 중단.
- 익명 사용자(`auth.users.is_anonymous`) 소유 행이 하나라도 있으면 표별 건수를 보고하고 중단한다(버리지 않는다).
- 코어 시드: `nomad_core.products('knowflow')`와 `nomad_core.plans`(knowflow A/B/C)·`plan_limits`가 02 전에 있어야 한다(없으면 02가 `core_seed_missing`으로 중단).
- 동결 중에는 옛 앱의 모든 쓰기 RPC와 로그인 한도 함수(`consume_auth_rate_limit`)가 막힌다 → **점검 공지 후 진행**. 읽기(select·stable 함수)는 된다.

## 1. 순서
1. **백업**: 대시보드에서 수동 백업(또는 PITR 시점 기록) + `supabase db dump --linked -f backup.sql`·`--data-only -f backup-data.sql`. 옛 버킷 `sources`는 그대로 남으므로 별도 복사 불필요.
2. **노출 스키마 추가(앱 배포 전)**: 대시보드 API 설정 Exposed schemas에 `nomad_knowflow` 추가(`nomad_knowflow_private`·`nomad_cutover`는 추가하지 않는다).
3. **01 freeze**: 옛 워커 중지 → `psql "<DB 주소>" -v ON_ERROR_STOP=1 -f supabase/nomad-cutover/01_freeze.sql`. NOTICE의 회수 건수를 기록한다. 실행 중이던 작업(queued·running)은 그대로 복사되고 새 워커가 임대 만료 뒤 다시 맡는다.
4. **migration 이력 정리(필수)**: 옛 버전 17개를 reverted로 표시한다(이력 표만 바꾸고 스키마·데이터는 그대로).
   ```
   supabase migration repair --linked --status reverted 20261102000100 20261102000200 20261102000300 20261102000400 \
     20261102000500 20261102000600 20261103000100 20261103000200 20261103000300 20261103000400 20261111000100 \
     20261111000200 20261111000300 20261111000400 20261112000100 20261112000200 20261112000300
   ```
   **주의 — 같은 버전 번호**: 옛 `20261112000100_youtube_sources`와 새 `20261112000100_nomad_core`가 같은 버전이다. 이 repair를 빼먹으면 `db push`가 `nomad_core`를 이미 적용된 것으로 보고 건너뛰어 뒤 파일이 모두 실패하거나, 일부만 적용된 상태가 된다. repair 뒤 `supabase migration list --linked`에서 원격 열의 `20261112000100`이 비어 있는지 확인한다.
5. **db push**: `supabase db push --linked` → 새 migrations 적용(개인 조직 백필 포함). 그다음 코어 시드(knowflow 제품·플랜·한도) 적용.
6. **02 dry-run**: `psql "<DB 주소>" -v ON_ERROR_STOP=1 -v plan_map=beta:<결정값> -f supabase/nomad-cutover/02_copy.sql` → 마지막 표(표별 원본·새 표 행 수)와 "dry-run 통과"를 확인. 중단 코드: `not_frozen` · `core_seed_missing` · `anonymous_owned_rows` · `plan_map_required/invalid` · `unmapped_plan` · `personal_org_missing` · `target_not_empty` · `storage_path_unexpected` · `value_mismatch` · `orphan_rows`.
7. **02 apply**: 같은 명령에 `-v apply=true`. 실패하면 트랜잭션 전체가 rollback된다(부분 복사 없음). 성공 뒤 다시 실행하면 `target_not_empty`로 거부된다.
8. **03 Storage**(앱 배포 전 필수 — 02가 `sources.storage_path`를 새 경로로 썼다):
   ```
   psql "<DB 주소>" -v ON_ERROR_STOP=1 -At -f supabase/nomad-cutover/03_storage_map.sql > storage-map.tsv
   node supabase/nomad-cutover/03_storage_copy.mjs storage-map.tsv            # 계획만 출력
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/nomad-cutover/03_storage_copy.mjs storage-map.tsv --apply
   psql "<DB 주소>" -v ON_ERROR_STOP=1 -f supabase/nomad-cutover/03_storage_verify.sql   # storage_ok 확인
   ```
   service_role 키는 셸 env로만 넣고 파일·로그에 남기지 않는다. 복사는 재실행해도 안전(이미 있는 대상은 건너뜀). `missing_legacy_objects` NOTICE 건수는 옛 버킷에 파일이 이미 없던 자료다(기록만).
9. **새 앱 배포·확인**: 웹·워커를 새 스키마 버전으로 배포 → 로그인, 프로젝트·자료 목록, PDF 열기(서명 URL), 대화·보고서 열람, 새 질문 1건을 내부 계정으로 확인.
10. **쓰기 재개**: 점검 해제. 옛 표는 동결 상태로 남긴다(`nomad_cutover` 기록도 남김). 옛 표·버킷 삭제는 안정화 뒤 별도 작업.

## 2. 되돌리기
- **되돌릴 수 없는 지점 = 10. 쓰기 재개**. 그 뒤에는 새 표에만 쓰기가 쌓이므로 옛 앱으로 돌아가면 그 데이터를 잃는다(이후 문제는 앞으로 고치는 수정으로 처리).
- 3~9 사이(쓰기 재개 전)에는 다음으로 되돌린다.
  1. 새 앱을 배포했으면 옛 앱 버전으로 다시 배포.
  2. 02를 apply했으면 새 표를 비운다: `truncate nomad_knowflow.processing_jobs, nomad_knowflow.report_citations, nomad_knowflow.reports, nomad_knowflow.messages, nomad_knowflow.conversations, nomad_knowflow.source_moments, nomad_knowflow.source_chunks, nomad_knowflow.sources, nomad_knowflow.projects, nomad_knowflow.usage_events, nomad_knowflow.org_quotas, nomad_knowflow_private.idempotency_keys, nomad_knowflow_private.auth_rate_limits;` + `delete from nomad_core.subscriptions where product_code = 'knowflow';` (profiles는 원본 값으로 덮인 상태라 그대로 둬도 된다). 새 버킷 `knowflow-sources`에 복사한 객체는 남겨도 무해하다(다음 02·03이 같은 경로를 다시 쓴다).
  3. `psql ... -f supabase/nomad-cutover/01_freeze_undo.sql` → 회수한 권한과 옛 가입 트리거 함수가 정확히 원상 복구된다.
  4. 새 스키마(`nomad_core`·`nomad_knowflow`)는 옛 앱과 충돌하지 않으므로 남겨 둔다. 이력을 옛 상태로 돌려야 하면 repair를 반대로(`--status applied` 옛 버전) 한다.
- 01 freeze만 하고 멈춘 경우: `01_freeze_undo.sql`만 실행.

## 3. 검사
`bash supabase/nomad-cutover/check.sh` — 같은 로컬 컨테이너(`supabase_db_nomad-supabase-module`, 변경은 `NOMAD_CUTOVER_CONTAINER`) 안에 일회용 DB `cutover_knowflow`를 만들어 legacy 적용 → 합성 seed → 01(쓰기 차단·읽기 유지·옛 가입 트리거 무력화) → 새 migrations → 02 플랜 누락 거부·dry-run 무변경·apply·값/RLS 대조·재실행 거부·익명 중단 → 03 목록·복사 스크립트 단위 검사(fetch 대역)·대조 → 01 undo 원상 확인 → DB 삭제. 마지막 줄 `PASS`.
- 검사 DB는 auth·storage·vault 구조를 같은 컨테이너의 postgres DB에서 복제한다. Storage API 자체(객체 본문 복사)는 검사하지 않는다 — 운영 전 스테이징에서 `--apply` 1회 확인 권장.
