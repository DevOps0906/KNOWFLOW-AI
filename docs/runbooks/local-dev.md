# 로컬 실행 (웹 + Supabase + Worker)

> 2026-11-17 확인. 로컬 전용이다. 스텁(유튜브·요약)은 실제 YouTube·Gemini를 부르지 않는다.

## 1. Supabase (Docker 필요)
```bash
npx -y supabase@3.2.0 start      # 저장소 루트. 처음엔 이미지 내려받기로 몇 분 걸린다
```
- 프로젝트 이름 `knowflow-ai-dev`, 포트 API 56521 · DB 56522 · Studio 56523 · 메일(Mailpit) 56524 (`supabase/config.toml`).
- 마이그레이션은 시작할 때 자동 적용된다. 초기화: `npx supabase@3.2.0 db reset`.
- 예전 `knowflow-ai` 스택(웹 :3110, API :56421)은 이전 스키마라 쓰지 않는다.

## 2. 환경 변수 (커밋 금지, `.gitignore`의 `.env.*`)
- `apps/web/.env.development.local`: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`(값은 `npx supabase status`), `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `AUTH_RATE_LIMIT_SECRET`(무작위), 로컬 화면 확인용 `YOUTUBE_ENABLED=true`·`YOUTUBE_METADATA_PROVIDER=stub`·`YOUTUBE_ALLOW_STUB=1`·`CAPTURE_ENABLED=true`.
- `apps/worker/.env.local`: `DATABASE_URL=postgresql://knowflow_worker:<비밀번호>@127.0.0.1:56522/postgres`, `WORKER_DB_ROLE=service_role`, `WORKER_SOURCE_READER=storage`, `SUPABASE_URL=http://127.0.0.1:56521`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_SUMMARY_PROVIDER=stub`, `YOUTUBE_ENABLED=1`·`YOUTUBE_ANALYZER=stub`·`YOUTUBE_METADATA_PROVIDER=stub`.
- 실제 AI 요약(유료): `apps/worker/.env.local`에 `WORKER_SUMMARY_PROVIDER=gemini`, `GEMINI_API_KEY=<키>`(선택 `GEMINI_SUMMARY_MODEL`, 기본 gemini-3.5-flash). 호출당 출력 2048토큰·60초 상한, 재시도 없음. 키는 사용자가 직접 넣는다.
- Worker 역할 비밀번호(DB를 초기화할 때마다): `docker exec supabase_db_knowflow-ai-dev psql -U postgres -c "alter role knowflow_worker password '<비밀번호>'"`.

## 3. 실행
```bash
pnpm dev                                                   # 웹 http://localhost:3000
cd apps/worker && pnpm build && node --env-file=.env.local dist/main.js   # Worker(별도 터미널)
```
Worker가 없으면 업로드한 자료는 "대기"에서 넘어가지 않는다.

## 4. 확인 순서
1. `/signup` 가입(메일 확인 없음) → `/dashboard`
2. 새 프로젝트 → 자료 추가 → PDF 업로드 → 몇 초 뒤 목록에서 "완료", 자료를 누르면 원문 뷰어
3. 대시보드 "자료부터 시작하기"에 PDF나 유튜브 주소 → 자료 이름으로 새 프로젝트가 만들어지고 그 화면으로 이동
4. 자료 추가 → 유튜브 탭에 영상 주소 → "완료" 뒤 자료 화면(S-10)에서 플레이어·영상 요약·장면 카드·화면 캡처
5. Storage 리더 실검증: `cd apps/worker && pnpm build && node --env-file=.env.local scripts/verify-storage.mjs`

## 아직 없는 기능
질의응답(채팅)·리포트·URL 가져오기·계정 설정은 task-009, W3~W4(task-013~020)에서 구현한다. 화면의 "질문하기" 패널은 자리만 있다.
