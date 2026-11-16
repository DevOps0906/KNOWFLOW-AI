# Worker의 service_role 키 보유 — 위험 수용 메모 (task-030)

캡처 이미지 정리(`apps/worker/src/captures/cleanup.ts`)는 지운 캡처 행의 Storage 객체를 Supabase Storage REST로 지운다.
이를 위해 Worker가 `SUPABASE_SERVICE_ROLE_KEY`를 가진다.

## 1. 위험과 수용 근거
- 위험: service_role 키는 RLS를 우회한다. Worker가 침해되면 이 키로 모든 테이블·버킷을 읽고 쓸 수 있다.
- 수용 근거(현 단계): Worker는 이미 DB에 `service_role` 역할로 붙는다(`WORKER_DB_ROLE`). 외부 출구는 egress 프록시의 정확한 host 허용 목록뿐이고,
  키는 셸 환경 변수로만 넘기며 로그·이미지·파일에 남기지 않는다(`verify:secrets`).
- 코드 방어: `SUPABASE_URL`은 `https://<ref>.supabase.co` origin(로컬 DB일 때만 loopback·`kong`)이 아니면 기동을 거부한다(다른 호스트로 키를 보내지 않음).
  삭제 대상은 `<uuid>/<uuid>/<uuid>/<uuid>.(png|webp)` 형식만 보내고, 리다이렉트는 따르지 않는다.

## 2. 최소 권한 대안 (도입 시 이 메모를 갱신)
| 대안 | 내용 | 비고 |
|---|---|---|
| 삭제 전용 Edge Function | Worker는 함수 전용 비밀(HMAC 등)만 갖고, 함수가 서버 측 service_role로 `knowflow-captures` 버킷 객체만 지운다 | Worker에서 service_role 키 제거. 함수 배포·비밀 관리가 늘어난다 |
| 버킷 한정 자격 | Storage S3 호환 접근 키 등 `knowflow-captures` 삭제만 되는 자격을 쓴다 | 버킷 단위로 제한할 수 있는지 Supabase 기능 확인 필요 |

## 3. egress allowlist 추가 (운영)
1. 운영 프로젝트 ref를 확인한다(대시보드 Project Settings → API의 URL `https://<ref>.supabase.co`).
2. `apps/worker/docker/egress-proxy/allowlist.txt`에 **정확한 host:port 한 줄**만 추가한다. 예: `<ref>.supabase.co:443`
   - 와일드카드(`*.supabase.co`)·상위 도메인(`supabase.co`)·다른 프로젝트 ref는 넣지 않는다.
3. 프록시를 다시 띄우고 `pnpm --filter worker verify:egress`로 허용 목록 외 호스트가 막히는지 확인한다.
4. Worker 기동 로그에 `capture_cleanup` 이벤트가 `outcome: "done"`으로 남는지 본다(경로·키는 로그에 없다).

## 4. 키 회전 절차
1. Supabase 대시보드에서 새 service_role(secret) 키를 만든다(구 키는 아직 유지).
2. Worker 배포 비밀 저장소의 `SUPABASE_SERVICE_ROLE_KEY`를 새 키로 바꾸고 Worker를 재기동한다. 웹 서버 등 같은 키를 쓰는 곳도 함께 바꾼다.
3. `capture_cleanup` 로그에 `http_401`·`http_403` 실패가 없는지 확인한 뒤 구 키를 폐기한다.
4. 키 노출이 의심되면 1~3을 즉시 하고, 노출 기간의 Storage·DB 감사 로그를 확인한다.
