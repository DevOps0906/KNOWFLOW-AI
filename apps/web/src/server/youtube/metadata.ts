import "server-only";

// videos.list 공급자(task-027b). 기본은 스텁, 실제 호출은 YOUTUBE_METADATA_PROVIDER=youtube일 때만.
export interface VideoMetadata {
  title: string;
  channelTitle: string;
  durationSeconds: number;
  privacyStatus: string;
  uploadStatus: string;
  embeddable: boolean;
  madeForKids: boolean;
  ageRestricted: boolean;
  /** 서비스 지역(KR)에서 재생할 수 없음 */
  regionBlocked: boolean;
  liveBroadcastContent: string;
}

export type MetadataResult = { ok: true; video: VideoMetadata | null } | { ok: false };

export interface VideoMetadataProvider {
  lookup(videoId: string): Promise<MetadataResult>;
}

export type YoutubeRejection =
  | "video_unavailable"
  | "video_not_embeddable"
  | "video_restricted"
  | "video_live"
  | "video_made_for_kids";

const SERVICE_REGION = "KR";
const TEXT_MAX = 300;

/** 검토 #5 동기 거절. 길이 초과는 요금제 한도를 아는 DB(KF413)가 판정한다. */
export function rejectionFor(video: VideoMetadata | null): YoutubeRejection | null {
  if (!video) return "video_unavailable";
  if (video.privacyStatus !== "public" || video.uploadStatus !== "processed") return "video_unavailable";
  if (video.liveBroadcastContent !== "none") return "video_live";
  if (!video.embeddable) return "video_not_embeddable";
  if (video.ageRestricted || video.regionBlocked) return "video_restricted";
  if (video.madeForKids) return "video_made_for_kids";
  if (!Number.isInteger(video.durationSeconds) || video.durationSeconds < 1) return "video_live";
  return null;
}

/** ISO 8601 기간(P#DT#H#M#S) → 초. 해석 못 하면 0. */
export function parseIsoDuration(value: unknown): number {
  if (typeof value !== "string") return 0;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  return d! * 86400 + h! * 3600 + min! * 60 + s!;
}

function cleanText(value: unknown, fallback: string) {
  // 제어 문자는 공백으로, 양방향 제어(U+202A–202E·U+2066–2069)와 폭 없는 문자(U+200B–200F·U+FEFF)는 제거
  const text =
    typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").trim()
      : "";
  return Array.from(text || fallback).slice(0, TEXT_MAX).join("");
}

/** 로컬·테스트 기본값. 외부 호출 없이 공개·임베드 가능한 10분짜리 영상으로 답한다. */
export function createStubMetadataProvider(): VideoMetadataProvider {
  return {
    async lookup(videoId) {
      return {
        ok: true,
        video: {
          title: `스텁 영상 ${videoId}`,
          channelTitle: "스텁 채널",
          durationSeconds: 600,
          privacyStatus: "public",
          uploadStatus: "processed",
          embeddable: true,
          madeForKids: false,
          ageRestricted: false,
          regionBlocked: false,
          liveBroadcastContent: "none",
        },
      };
    },
  };
}

interface ApiItem {
  snippet?: { title?: unknown; channelTitle?: unknown; liveBroadcastContent?: unknown };
  contentDetails?: {
    duration?: unknown;
    contentRating?: { ytRating?: unknown };
    regionRestriction?: { allowed?: unknown; blocked?: unknown };
  };
  status?: { privacyStatus?: unknown; uploadStatus?: unknown; embeddable?: unknown; madeForKids?: unknown };
}

function toMetadata(item: ApiItem): VideoMetadata {
  const region = item.contentDetails?.regionRestriction;
  const allowed = Array.isArray(region?.allowed) ? region.allowed : null;
  const blocked = Array.isArray(region?.blocked) ? region.blocked : [];
  return {
    title: cleanText(item.snippet?.title, "제목 없음"),
    channelTitle: cleanText(item.snippet?.channelTitle, "채널 정보 없음"),
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
    privacyStatus: String(item.status?.privacyStatus ?? ""),
    uploadStatus: String(item.status?.uploadStatus ?? ""),
    embeddable: item.status?.embeddable === true,
    madeForKids: item.status?.madeForKids === true,
    ageRestricted: item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted",
    regionBlocked: blocked.includes(SERVICE_REGION) || (allowed !== null && !allowed.includes(SERVICE_REGION)),
    liveBroadcastContent: String(item.snippet?.liveBroadcastContent ?? ""),
  };
}

/** YouTube Data API v3 videos.list. 키는 헤더로만 보내 URL·로그에 남지 않게 한다. */
export function createYoutubeDataApiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): VideoMetadataProvider {
  return {
    async lookup(videoId) {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("id", videoId);
      try {
        const response = await fetchImpl(url, {
          headers: { "X-Goog-Api-Key": apiKey, Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return { ok: false };
        const data = (await response.json()) as { items?: unknown };
        if (!Array.isArray(data.items)) return { ok: false };
        const item = data.items[0] as ApiItem | undefined;
        return { ok: true, video: item ? toMetadata(item) : null };
      } catch {
        return { ok: false };
      }
    },
  };
}
