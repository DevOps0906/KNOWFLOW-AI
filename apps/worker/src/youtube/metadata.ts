// 메타데이터 재확인용 videos.list 공급자(task-027d). 기본은 스텁(네트워크 없음), 실제 호출은 YOUTUBE_METADATA_PROVIDER=youtube일 때만.
// 키(YOUTUBE_WORKER_API_KEY)는 헤더로만 보내고 URL·로그·오류에 넣지 않는다. 응답의 제목·채널명은 신뢰하지 않는 데이터다.
// 판정은 recheck.ts가 한다. 여기서는 조회 결과를 정리해 돌려주거나, 판정 불가(ok:false + 고정 사유)만 알린다.
import { PermanentError } from "../runner.js";
import { readCapped } from "./gemini.js";
import { RECHECK_SETTINGS, YOUTUBE_ERROR_CODES } from "./settings.js";

export interface RecheckVideo {
  title: string;
  channelTitle: string;
  /** ISO 8601 기간을 해석한 초(1 이상). 해석 못 하면(빈 값·형식 오류·0·라이브·상한 초과) null */
  durationSeconds: number | null;
  privacyStatus: string;
  uploadStatus: string;
}

/**
 * ok:true + video:null은 "결과 없음"(삭제 등). ok:false는 판정 불가(쿼터 초과·장애).
 * 다시 해도 같은 요청 거절(400·401·키 권한 403 등)은 PermanentError(recheck_request_rejected)를 던진다.
 */
export type MetadataLookup = { ok: true; video: RecheckVideo | null } | { ok: false; reason: string };

export interface VideoMetadataProvider {
  readonly name: "stub" | "youtube";
  lookup(videoId: string, signal: AbortSignal): Promise<MetadataLookup>;
}

/** sources.duration_seconds(integer) 상한 */
const MAX_DURATION_SECONDS = 2_147_483_647;

/**
 * ISO 8601 기간(P#DT#H#M#S) → 초. 빈 값·형식 오류·"P"·"PT"·0초·정수 상한 초과는 null(판정 불가, 0으로 대체하지 않는다).
 */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^P(?:(\d{1,10})D)?(?:T(?=\d)(?:(\d{1,10})H)?(?:(\d{1,10})M)?(?:(\d{1,10})S)?)?$/.exec(value);
  if (!m || value === "P") return null;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  const total = d! * 86400 + h! * 3600 + min! * 60 + s!;
  return Number.isSafeInteger(total) && total >= 1 && total <= MAX_DURATION_SECONDS ? total : null;
}

/** 403 중 쿼터·요청 한도 초과(판정 불가로 재시도). 그 밖의 403은 키 권한 등 영구 거절 */
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

async function isQuota403(res: Response): Promise<boolean> {
  try {
    const body = JSON.parse(await readCapped(res, RECHECK_SETTINGS.maxResponseBytes)) as { error?: { errors?: { reason?: unknown }[] } };
    const errors = Array.isArray(body?.error?.errors) ? body.error.errors : [];
    return errors.some((e) => typeof e?.reason === "string" && QUOTA_REASONS.has(e.reason));
  } catch {
    // 본문을 못 읽으면 영구 거절로 단정하지 않는다(판정 불가)
    return true;
  }
}

/** 제어 문자는 공백으로, 양방향 제어·폭 없는 문자는 제거하고 300자로 자른다(웹 cleanText와 같은 규칙) */
export function cleanText(value: unknown, fallback: string): string {
  const text =
    typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").trim()
      : "";
  return Array.from(text || fallback).slice(0, RECHECK_SETTINGS.maxTextChars).join("");
}

/** 로컬·검증 기본값. 외부 호출 없이 공개 상태의 10분짜리 영상으로 답한다(웹 스텁과 같은 값) */
export function createStubMetadataProvider(): VideoMetadataProvider {
  return {
    name: "stub",
    async lookup(videoId, signal) {
      signal.throwIfAborted();
      return {
        ok: true,
        video: { title: `스텁 영상 ${videoId}`, channelTitle: "스텁 채널", durationSeconds: 600, privacyStatus: "public", uploadStatus: "processed" },
      };
    },
  };
}

interface ApiItem {
  snippet?: { title?: unknown; channelTitle?: unknown };
  contentDetails?: { duration?: unknown };
  status?: { privacyStatus?: unknown; uploadStatus?: unknown };
}

export interface YoutubeApiOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** YouTube Data API v3 videos.list(part=snippet,contentDetails,status). 상태 코드와 무관하게 실패는 판정 불가다 */
export function createYoutubeDataApiProvider(opts: YoutubeApiOptions): VideoMetadataProvider {
  if (!opts.apiKey) throw new Error("YOUTUBE_WORKER_API_KEY가 필요합니다");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? RECHECK_SETTINGS.requestTimeoutMs;
  return {
    name: "youtube",
    async lookup(videoId, signal) {
      const url = new URL(RECHECK_SETTINGS.apiUrl);
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("id", videoId);
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { "x-goog-api-key": opts.apiKey, accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
      } catch (e) {
        // 임대 상실은 그대로 올려 runner가 stale로 처리하게 한다
        if (signal.aborted) throw e;
        return { ok: false, reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error" };
      }
      if (res.status === 403) {
        // 쿼터 초과만 판정 불가. 키 권한 등은 다시 해도 같으므로 영구 실패(본문은 reason만 보고 로그에 남기지 않는다)
        if (await isQuota403(res)) return { ok: false, reason: "http_403_quota" };
        throw new PermanentError(YOUTUBE_ERROR_CODES.recheckRequestRejected);
      }
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: `http_${res.status}` };
      }
      if (!res.ok) {
        // 400·401·404 등: 요청 자체가 거절됐다(재시도해도 같다)
        await res.body?.cancel().catch(() => {});
        throw new PermanentError(YOUTUBE_ERROR_CODES.recheckRequestRejected);
      }
      let data: { items?: unknown };
      try {
        data = JSON.parse(await readCapped(res, RECHECK_SETTINGS.maxResponseBytes)) as { items?: unknown };
      } catch (e) {
        if (signal.aborted) throw e;
        return { ok: false, reason: "invalid_response" };
      }
      if (!data || !Array.isArray(data.items)) return { ok: false, reason: "invalid_response" };
      const item = data.items[0] as ApiItem | undefined;
      if (!item) return { ok: true, video: null };
      return {
        ok: true,
        video: {
          title: cleanText(item.snippet?.title, "제목 없음"),
          channelTitle: cleanText(item.snippet?.channelTitle, "채널 정보 없음"),
          durationSeconds: parseIsoDuration(item.contentDetails?.duration),
          privacyStatus: String(item.status?.privacyStatus ?? ""),
          uploadStatus: String(item.status?.uploadStatus ?? ""),
        },
      };
    },
  };
}
