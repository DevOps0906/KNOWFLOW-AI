// 사전예약 외부 폼 설정. 공개 값이라 코드 상수로 둔다(비밀 아님).
// 폼 서비스가 정해지면 아래 두 줄만 바꾼다. 우리 서버로 폼을 받지 않는다.
export const PREORDER_FORM_URL = "";
export const PREORDER_ALLOWED_HOST = "tally.so";

const SOURCE_PARAM = "src";
const SOURCE_VALUE = "knowflow-landing";

/** 폼 URL이 비었거나 https가 아니거나 허용 호스트와 다르거나 사용자 정보·포트가 있으면 null(CTA 비활성). */
export function buildPreorderHref(
  formUrl: string = PREORDER_FORM_URL,
  allowedHost: string = PREORDER_ALLOWED_HOST,
): string | null {
  if (!formUrl) return null;
  let url: URL;
  try {
    url = new URL(formUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== allowedHost) return null;
  if (url.username || url.password || url.port) return null;
  url.searchParams.set(SOURCE_PARAM, SOURCE_VALUE);
  return url.toString();
}
