# 런북: 권리자 삭제 요청 처리 (유튜브 자료)

> 근거: task-029 결정 7, `docs/youtube-mvp-review.md#5`. 신고 창구: 약관(S-16)·개인정보처리방침(S-17)의 `RIGHTS_CONTACT_EMAIL`(주소는 MVP 완성 단계에서 사용자 결정, 전까지 "준비 중").

## 1. 접수
1. 신고 메일을 받으면 접수 시각·신고자 이름·연락처·대상 URL·권리 주장 내용을 기록한다.
2. 대상 영상 ID(11자)를 URL에서 추출한다(`watch?v=<ID>` 또는 `youtu.be/<ID>`).

## 2. 확인
1. 신고자가 권리자 또는 대리인임을 확인한다(요청 내용·연락처 일치). 불명확하면 근거 자료를 회신으로 요청한다.
2. 대상이 우리 서비스에 저장된 영상 자료인지 확인한다(`select id, user_id from public.sources where video_id = '<ID>'`, service_role 또는 운영 DB 접속).
3. 판단이 어려운 요청(법적 쟁점)은 처리 전 사용자(운영 책임자)에게 올린다.

## 3. 실행
service_role로 실행한다(웹·클라이언트 번들 금지):
```sql
select public.takedown_video('<video_id 11자>', '<사유: 신고자·접수일·요지>');
```
- 주의: `reason`(감사 기록에 남는다)에 신고자 연락처·개인정보를 넣지 않는다. 접수 번호·접수일·요지만 쓴다.
- 효과: 모든 사용자의 해당 영상 자료에 `unavailable_at` 설정, 제목·채널·길이 파기, 청크·장면·요약 삭제, `rights_takedowns`에 감사 기록.
- 반환 JSON(`audit_id`, `sources`, `chunks`, `moments`, `summaries`)을 접수 기록에 붙인다.
- 같은 호출은 반복해도 안전하다(두 번째는 삭제 0건으로 감사 기록만 추가).
- 확인: `select * from public.rights_takedowns where video_id = '<ID>' order by created_at desc;`

## 4. 회신
1. 처리 완료 시각과 조치(해당 영상 자료의 비활성·파생 데이터 삭제)를 신고자에게 회신한다.
2. 자료가 없었다면(`sources` = 0) 그 사실을 회신한다.
3. 접수 메일·회신·반환 JSON을 운영 기록으로 보관한다.

## 알려진 한계
- 재등록 차단은 현재 없다. 삭제 후 같은 영상을 다시 등록할 수 있으므로, 유튜브 기능 활성화 전에 별도로 처리해야 한다(차단 목록 등).
