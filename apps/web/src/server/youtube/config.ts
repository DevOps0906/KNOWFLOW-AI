import "server-only";

// 기능 플래그·공급자 선택(task-027 구현 결정 전제). 기본은 꺼짐·스텁.
// 스텁은 YOUTUBE_ALLOW_STUB=1(로컬·테스트)일 때만 허용한다. NODE_ENV에 기대지 않는다.
export type MetadataProviderName = "stub" | "youtube";

export interface YoutubeConfig {
  enabled: boolean;
  provider: MetadataProviderName;
  apiKey: string | undefined;
  allowStub: boolean;
  /** 등록 RPC에 필요한 서버 설정(Supabase URL·service_role 키)이 있는지. 값은 service.ts만 읽는다. */
  registerConfigured: boolean;
}

type Env = Record<string, string | undefined>;

export function readYoutubeConfig(env: Env, registerConfigured: boolean): YoutubeConfig {
  const apiKey = env.YOUTUBE_API_KEY?.trim();
  return {
    enabled: env.YOUTUBE_ENABLED === "true",
    provider: env.YOUTUBE_METADATA_PROVIDER === "youtube" ? "youtube" : "stub",
    apiKey: apiKey ? apiKey : undefined,
    allowStub: env.YOUTUBE_ALLOW_STUB === "1",
    registerConfigured,
  };
}

/** 켜진 설정이 쓸 수 없는 상태면 사유, 아니면 null. 외부 호출(videos.list) 전에 검사한다. 스텁은 명시 허용이 있어야 한다. */
export function youtubeConfigProblem(
  config: YoutubeConfig,
): "stub_not_allowed" | "api_key_missing" | "register_not_configured" | null {
  if (!config.enabled) return null;
  if (!config.registerConfigured) return "register_not_configured";
  if (config.provider === "stub" && !config.allowStub) return "stub_not_allowed";
  if (config.provider === "youtube" && !config.apiKey) return "api_key_missing";
  return null;
}

/** 화면(S-09 탭)용 판정. 설정이 쓸 수 없는 상태면 꺼진 것으로 본다. */
export function youtubeUsable(config: YoutubeConfig) {
  return config.enabled && youtubeConfigProblem(config) === null;
}
