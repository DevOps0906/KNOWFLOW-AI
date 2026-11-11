import "server-only";
import { createHash } from "node:crypto";
import type { YoutubeRegisterInput, YoutubeRegisterOutcome, YoutubeSources } from "@/lib/storage/handlers";
import { youtubeConfigProblem, type YoutubeConfig } from "./config";
import { rejectionFor, type VideoMetadataProvider, type YoutubeRejection } from "./metadata";
import { parseYoutubeVideoId } from "./url";

// A-04 유튜브 분기(task-027b): 플래그 → URL → 소유 → videos.list 동기 거절 → register_youtube_source(service_role).
export interface RegisterRpcInput {
  userId: string;
  projectId: string;
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  idempotencyKey: string;
  requestHash: string;
}

export type RegisterRpcResult =
  | { ok: true; sourceId: string; jobId: string | null; duplicate: boolean }
  | { ok: false; error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null };

export interface YoutubeSourcesDeps {
  /** 요청마다 읽는다(플래그를 끄면 바로 막힌다). */
  config: () => YoutubeConfig;
  /** 플래그·설정 검사를 통과한 뒤에만 부른다(키를 읽기 전 거절). */
  provider: (config: YoutubeConfig) => VideoMetadataProvider;
  register: (input: RegisterRpcInput) => Promise<RegisterRpcResult>;
}

export const YOUTUBE_MESSAGES = {
  disabled: "유튜브 등록은 아직 사용할 수 없습니다.",
  suspended: "유튜브 신규 등록이 잠시 중단되었습니다. 나중에 다시 시도해 주세요.",
  invalidUrl: "유튜브 영상 1건의 주소를 넣어 주세요. 재생목록·채널 주소는 지원하지 않습니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  notFound: "프로젝트를 찾을 수 없습니다.",
  metadataUnavailable: "영상 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  video_unavailable: "공개된 영상만 등록할 수 있습니다. 비공개·미등록·삭제된 영상은 등록할 수 없습니다.",
  video_not_embeddable: "퍼가기(임베드)가 허용되지 않은 영상입니다.",
  video_restricted: "연령 또는 지역 제한이 있는 영상은 등록할 수 없습니다.",
  video_live: "라이브·예정된 방송은 등록할 수 없습니다. 방송이 끝난 뒤 다시 시도해 주세요.",
  video_made_for_kids: "어린이용으로 지정된 영상은 등록할 수 없습니다.",
  video_too_long: "허용된 길이를 넘는 영상입니다.",
  duplicateVideo: "이 프로젝트에 이미 같은 영상이 있습니다.",
  conflict: "같은 요청이 다른 입력으로 들어왔습니다. 새로 시도해 주세요.",
  sourceLimit: "자료 수 또는 이번 달 처리 한도에 도달했습니다.",
  videoLimit: "이번 달 영상 처리 시간 한도에 도달했습니다.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const satisfies Record<YoutubeRejection, string> & Record<string, string>;

const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;

const failure = (status: number, code: string, message: string, reason = code): YoutubeRegisterOutcome => ({
  ok: false,
  status,
  code,
  message,
  reason,
});

/** register_youtube_source 오류(SQLSTATE) → 응답. KF429 quota_exceeded는 HINT(source_jobs|video_seconds)로 한도 종류를 구분하고, source_limit_exceeded는 HINT가 없다. */
export function classifyRegisterError(error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null): YoutubeRegisterOutcome {
  switch (error?.code) {
    case "23505": // message duplicate_video: 같은 프로젝트에 같은 영상
      return failure(409, "duplicate_video", YOUTUBE_MESSAGES.duplicateVideo);
    case "KF409":
    case "KF410":
      return failure(409, "conflict", YOUTUBE_MESSAGES.conflict);
    case "KF413":
      return failure(422, "video_too_long", YOUTUBE_MESSAGES.video_too_long);
    case "KF429": {
      return error.hint === "video_seconds"
        ? failure(429, "limit_exceeded", YOUTUBE_MESSAGES.videoLimit, "video_seconds")
        : failure(429, "limit_exceeded", YOUTUBE_MESSAGES.sourceLimit, error.hint === "source_jobs" ? "source_jobs" : "source_limit");
    }
    case "P0002":
      return failure(404, "not_found", YOUTUBE_MESSAGES.notFound);
    case "22023":
      return failure(422, "invalid_input", YOUTUBE_MESSAGES.invalidRequest);
    default:
      return failure(500, "server_error", YOUTUBE_MESSAGES.server);
  }
}

/** 멱등 request_hash는 (project_id, video_id)만으로 만든다(같은 영상의 같은 키 재요청은 같은 입력). */
export function youtubeRequestHash(projectId: string, videoId: string) {
  return createHash("sha256").update(JSON.stringify([projectId, videoId])).digest("hex");
}

export function createYoutubeSources(deps: YoutubeSourcesDeps): YoutubeSources {
  return {
    async register({ userId, projectId, body, idempotencyKey, projectExists }: YoutubeRegisterInput) {
      const config = deps.config();
      if (!config.enabled) return failure(422, "youtube_disabled", YOUTUBE_MESSAGES.disabled);
      const problem = youtubeConfigProblem(config);
      if (problem) return failure(503, "youtube_unavailable", YOUTUBE_MESSAGES.suspended, problem);

      const videoId = parseYoutubeVideoId(body.url);
      if (!videoId) return failure(422, "invalid_youtube_url", YOUTUBE_MESSAGES.invalidUrl);
      const key = idempotencyKey;
      if (typeof key !== "string" || !KEY.test(key)) return failure(400, "bad_request", YOUTUBE_MESSAGES.invalidRequest);

      // 남의 프로젝트로 외부 쿼터를 쓰지 않도록 세션(RLS)으로 먼저 확인한다. 함수가 한 번 더 확인한다.
      if (!(await projectExists(projectId))) return failure(404, "not_found", YOUTUBE_MESSAGES.notFound);

      const lookup = await deps.provider(config).lookup(videoId);
      if (!lookup.ok) return failure(502, "metadata_unavailable", YOUTUBE_MESSAGES.metadataUnavailable);
      const rejection = rejectionFor(lookup.video);
      if (rejection || !lookup.video) {
        const code = rejection ?? "video_unavailable";
        return failure(422, code, YOUTUBE_MESSAGES[code]);
      }

      const result = await deps.register({
        userId,
        projectId,
        videoId,
        title: lookup.video.title,
        channelTitle: lookup.video.channelTitle,
        durationSeconds: lookup.video.durationSeconds,
        idempotencyKey: key,
        requestHash: youtubeRequestHash(projectId, videoId),
      });
      if (!result.ok) return classifyRegisterError(result.error);
      return { ok: true, sourceId: result.sourceId, jobId: result.jobId, duplicate: result.duplicate };
    },
  };
}
