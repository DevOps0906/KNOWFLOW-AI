# task-001 W0 랜딩 S-01 + 외부 폼 사전예약

| 항목 | 내용 |
|---|---|
| 웨이브 | W0 |
| 선행 | task-002 (골격 직후, 다른 W1 작업과 병행) |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 (공개 랜딩, 외부 폼 링크) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-01`, `docs/01_PRD.md#8`, `DESIGN.md#2` |
| 쓰기 허용 | `apps/web/src/app/(marketing)/**`, `apps/web/src/app/page.tsx`(삭제만), `docs/claims-ledger.md`(신규) |

## 할 것
- 랜딩 S-01을 spec 표대로 구현(반응형 3구간, 토큰만 사용, 한국어 문구)
- 사전예약 CTA는 외부 폼 서비스 링크로 연결(우리 서버로 폼 수신 금지, 이메일 수집 코드 없음)
- CTA는 검증 기간에 외부 폼 사전예약으로 두고, 베타 후 S-03 가입 링크로 교체한다(교체는 별도 작업)
- 금지 문구(`docs/01_PRD.md#6`) 점검, 외부 링크 `rel="noopener noreferrer"`

## 착수 전 challenger 반영 (팀장 결정, 사용자 변경 가능)
- "/" 충돌: 골격의 `app/page.tsx` 삭제. `(marketing)/layout`은 html·body를 다시 그리지 않는다(루트 layout 유지).
- 폼 URL은 공개 값이라 코드 상수 1개(`(marketing)/preorder.ts`)로 둔다. 비었거나 `https:`가 아니거나 허용 호스트 1개와 다르면 CTA를 "준비 중" 비활성으로. 현재 값은 빈 문자열(폼 서비스 미정, 사용자 결정 후 한 줄 교체).
- CTA href에 고정 출처 파라미터 `?src=knowflow-landing`을 붙여 응답과 클릭을 잇는다. 방문 수는 호스팅(Vercel) 측정 — 켜는 일은 사용자 작업.
- 문구: CTA는 "사전예약", "무료로 시작" 금지. 기능은 "만들고 있는 기능"으로 표시하고 정확도·속도 같은 수치·우월 주장 금지. 게시 문장은 `docs/claims-ledger.md`(주장 | 상태: 예정·검증 | 근거)에 먼저 등록.
- 개인정보: 랜딩 하단에 "사전예약 개인정보 수집 안내"(수집 항목 이메일·목적·보관: 검증 종료 후 30일 안 파기·거부권) 절을 두고 CTA 근처에 링크. 폼 안 동의 문구는 폼 서비스 설정(사용자 작업).
- 로그인 링크는 W0에서 뺀다(S-02 미구현). 3구간은 `~/.claude/nomad/bin/shot`으로 확인, Vitest는 CTA href·rel·비활성 분기만.

## 하지 않을 것
- 자체 사전예약 API·DB 저장, 로그인·결제 화면, 분석 스크립트 추가(새 의존성)

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm lint` · `pnpm typecheck` 통과
- [ ] `pnpm test`: S-01 렌더, CTA 비활성(빈 값·http·다른 호스트)·활성(허용 호스트 https + src 파라미터·rel) 분기
- [ ] `pnpm build` 통과, `shot`으로 375·768·1280 캡처 확인(가로 스크롤 없음)
- [ ] claims-ledger의 모든 게시 문장이 랜딩 문구와 일치, 금지 문구(PRD#6) 0건
- [ ] `~/.claude/nomad/bin/secscan` 비밀·의존성 이상 없음
