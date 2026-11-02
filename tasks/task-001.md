# task-001 W0 랜딩 S-01 + 외부 폼 사전예약

| 항목 | 내용 |
|---|---|
| 웨이브 | W0 |
| 선행 | task-002 (골격 직후, 다른 W1 작업과 병행) |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 (공개 랜딩, 외부 폼 링크) |
| 담당 | builder (+ tester). 착수 전 challenger |
| 근거 | `spec S-01`, `docs/01_PRD.md#8`, `DESIGN.md#2` |
| 쓰기 허용 | `apps/web/src/app/(marketing)/**` |

## 할 것
- 랜딩 S-01을 spec 표대로 구현(반응형 3구간, 토큰만 사용, 한국어 문구)
- 사전예약 CTA는 외부 폼 서비스 링크로 연결(우리 서버로 폼 수신 금지, 이메일 수집 코드 없음)
- CTA는 검증 기간에 외부 폼 사전예약으로 두고, 베타 후 S-03 가입 링크로 교체한다(교체는 별도 작업)
- 금지 문구(`docs/01_PRD.md#6`) 점검, 외부 링크 `rel="noopener noreferrer"`

## 하지 않을 것
- 자체 사전예약 API·DB 저장, 로그인·결제 화면, 분석 스크립트 추가(새 의존성)

## 완료 조건 (실행 가능한 확인)
- [ ] `pnpm lint` · `pnpm typecheck` 통과
- [ ] `pnpm test`: S-01 렌더, 폼 링크 href가 외부 도메인인지, 3구간 렌더 스냅샷 통과
- [ ] `~/.claude/nomad/bin/secscan` 비밀·의존성 이상 없음
