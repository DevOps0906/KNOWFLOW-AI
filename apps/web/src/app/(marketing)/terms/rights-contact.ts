// 권리자 신고 이메일(설정값 RIGHTS_CONTACT_EMAIL). 주소는 MVP 완성 단계에서 결정하므로 미설정·잘못된 값이면 null("준비 중").
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function getRightsContactEmail(raw: string | undefined = process.env.RIGHTS_CONTACT_EMAIL): string | null {
  const v = raw?.trim();
  return v && v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}
