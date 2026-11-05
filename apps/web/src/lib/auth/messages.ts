// 사용자에게 보이는 인증 문구(한국어). 내부 정보·원인 상세는 담지 않는다.
export const AUTH_MESSAGES = {
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  invalidEmail: "이메일 형식이 올바르지 않습니다.",
  weakPassword:
    "비밀번호가 너무 약합니다. 10자 이상, 문자와 숫자·기호를 함께 쓰고 이메일과 비슷하거나 흔한 비밀번호는 피해 주세요.",
  invalidCredentials: "이메일 또는 비밀번호가 일치하지 않습니다.",
  alreadyRegistered: "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해 주세요.",
  rateLimited: "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  unauthorized: "로그인이 필요합니다.",
  resetSent: "입력하신 주소로 가입된 계정이 있다면 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.",
  confirmEmail: "가입 확인 메일을 보냈습니다. 메일의 링크를 눌러 가입을 마쳐 주세요.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;
