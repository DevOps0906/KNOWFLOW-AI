// 유튜브 메타데이터 재확인(task-027d, 05#8·검토 5장): 일일 스윕 + source_recheck 작업 핸들러.
// 판정: 비공개 전환·업로드 삭제/거절은 즉시 비활성(unavailable_at, 즉시 파기), 결과 없음은 2회 연속일 때만(DB가 센다).
// 쿼터 초과·장애·길이 해석 불가는 판정 불가로 재시도, 요청 거절(키 권한 등)은 영구 실패.
// 웹이 등록 때 준 duration_seconds는 실제 길이와 대조해 다르면 갱신하고 숫자만 로그로 남긴다(차감한 영상 시간은 그대로).
// 자료 상태(sources.status)·사용자 쿼터는 건드리지 않는다(DB 함수가 보장). 제목·채널명은 로그에 남기지 않는다.
import type { Logger } from "../log.js";
import { PermanentError, StaleAttemptError, type Handler } from "../runner.js";
import type { RecheckVideo, VideoMetadataProvider } from "./metadata.js";
import { RECHECK_SETTINGS, VIDEO_ID_RE, YOUTUBE_ERROR_CODES } from "./settings.js";
import type { RecheckResult, RecheckStore } from "./store.js";

/** 판정 불가(쿼터 초과·장애·해석 불가). runner가 재시도하고, 시도를 다 쓰면 다음 스윕이 다시 만든다 */
export class RecheckUndeterminedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RecheckUndeterminedError";
  }
}

/** 비활성으로 보는 업로드 상태(삭제·거절). 그 밖의 공개 범위·제한 변화는 비활성으로 보지 않는다 */
const REMOVED_UPLOAD_STATUSES = new Set(["deleted", "rejected"]);

/** 조회 결과 → 반영할 결과. 길이를 해석하지 못하면(null) 다른 값으로 대체하지 않고 판정 불가 */
export function judgeRecheck(video: RecheckVideo | null): RecheckResult {
  if (!video) return { kind: "missing" };
  if (video.privacyStatus === "private" || REMOVED_UPLOAD_STATUSES.has(video.uploadStatus)) return { kind: "unavailable" };
  const duration = video.durationSeconds;
  if (duration === null || !Number.isInteger(duration) || duration < 1) throw new RecheckUndeterminedError("duration_unknown");
  return { kind: "available", title: video.title, channel_title: video.channelTitle, duration_seconds: duration };
}

export interface RecheckDeps {
  provider: VideoMetadataProvider;
  store: RecheckStore;
  log?: Logger;
}

export function createRecheckHandler({ provider, store, log }: RecheckDeps): Handler {
  return async ({ job, signal }) => {
    if (!job.source_id) throw new PermanentError(YOUTUBE_ERROR_CODES.invalidVideo);
    const target = await store.loadRecheckTarget(job.source_id);
    // 삭제·비활성 자료는 조회하지 않는다(파기는 스윕이 맡는다). runner가 작업만 완료한다
    if (!target || target.deleted || target.unavailable) {
      log?.({ event: "recheck_skipped", jobId: job.id, reason: target ? (target.deleted ? "deleted" : "unavailable") : "missing" });
      return;
    }
    if (!target.video_id || !VIDEO_ID_RE.test(target.video_id)) throw new PermanentError(YOUTUBE_ERROR_CODES.invalidVideo);

    const lookup = await provider.lookup(target.video_id, signal);
    signal.throwIfAborted();
    if (!lookup.ok) throw new RecheckUndeterminedError(lookup.reason);
    const result = judgeRecheck(lookup.video);

    if (result.kind === "available" && target.duration_seconds !== null && result.duration_seconds !== target.duration_seconds) {
      log?.({ event: "recheck_duration_changed", jobId: job.id, previousDurationSeconds: target.duration_seconds, durationSeconds: result.duration_seconds });
    }
    if (!(await store.applyRecheckAndComplete(job.id, job.attempt_count, result))) throw new StaleAttemptError();
    log?.({ event: "recheck_result", jobId: job.id, outcome: result.kind });
    return { completed: true };
  };
}

/** 스윕 한 번: 파기 + 재확인 작업 생성. 실패해도 Worker를 멈추지 않고 로그만 남긴다(다음 주기에 다시) */
export async function runRecheckSweep(store: RecheckStore, log: Logger, limit: number = RECHECK_SETTINGS.sweepBatchLimit): Promise<void> {
  try {
    const r = await store.sweep(limit);
    log({ event: "recheck_sweep", outcome: "done", enqueued: r.enqueued, purged: r.purged, cleaned: r.cleaned });
    // 재확인 작업이 하루 넘게 밀려 있으면 경고(숫자만). 30일 갱신 기한을 놓칠 수 있다
    if (r.stale_queued > 0) log({ event: "recheck_backlog_warning", staleQueued: r.stale_queued });
  } catch (e) {
    log({ event: "recheck_sweep", outcome: "failed", errorName: e instanceof Error ? e.name : "unknown" });
  }
}
