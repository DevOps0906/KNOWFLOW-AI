"use client";

import { useEffect, useState } from "react";
import { EyeOff, PlaySquare } from "lucide-react";
import { ErrorState } from "@/components/states/error-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeExternalUrl } from "@/components/workspace/viewer/format";
import { embedSrc, isValidVideoId } from "./embed";
import { cleanUntrustedText } from "./sanitize";

// S-10 영상 영역: 공식 임베드 플레이어 · 영상 요약(문장별 mm:ss 인용) · 장면 카드(L0, 이미지 없음).
// 시각 이동은 iframe src 교체(IFrame API·postMessage 없음). 요약·장면 텍스트는 React 텍스트 노드로만 렌더한다.

export interface YoutubePanelSource {
  id: string;
  video_id: string | null;
  original_url: string | null;
}

interface Citation {
  chunk_id: string;
  t_start: number;
}
interface SummaryData {
  model: string;
  sentences: Array<{ text: string; citations: Citation[] }>;
}
interface MomentData {
  id: string;
  t_start: number;
  t_end: number;
  title: string;
  description: string;
}
type Loaded =
  | { kind: "disabled" }
  | { kind: "unavailable" }
  | { kind: "ok"; moments: MomentData[]; summary: SummaryData | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function timestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 응답을 화면용으로 다시 거른다(모양 불일치 항목 제외, 텍스트 재정리) */
function parse(body: unknown): Loaded | null {
  const b = body as { enabled?: unknown; unavailable?: unknown; moments?: unknown; summary?: unknown } | null;
  if (!b || typeof b !== "object") return null;
  if (b.enabled === false) return { kind: "disabled" };
  if (b.unavailable === true) return { kind: "unavailable" };
  const moments = (Array.isArray(b.moments) ? b.moments : []).flatMap((m): MomentData[] => {
    const o = m as { id?: unknown; t_start?: unknown; t_end?: unknown; title?: unknown; description?: unknown };
    const t_start = num(o?.t_start);
    const t_end = num(o?.t_end);
    const title = cleanUntrustedText(o?.title);
    return typeof o?.id === "string" && t_start !== null && t_end !== null && t_end > t_start && title
      ? [{ id: o.id, t_start, t_end, title, description: cleanUntrustedText(o.description) }]
      : [];
  });
  let summary: SummaryData | null = null;
  const s = b.summary as { model?: unknown; sentences?: unknown } | null;
  if (s && Array.isArray(s.sentences)) {
    const sentences = s.sentences.flatMap((x): SummaryData["sentences"] => {
      const o = x as { text?: unknown; citations?: unknown };
      const text = cleanUntrustedText(o?.text);
      if (!text) return [];
      const citations = (Array.isArray(o.citations) ? o.citations : []).flatMap((c): Citation[] => {
        const cc = c as { chunk_id?: unknown; t_start?: unknown };
        const t = num(cc?.t_start);
        return typeof cc?.chunk_id === "string" && t !== null ? [{ chunk_id: cc.chunk_id, t_start: t }] : [];
      });
      return citations.length > 0 ? [{ text, citations }] : [];
    });
    if (sentences.length > 0) summary = { model: cleanUntrustedText(s.model), sentences };
  }
  return { kind: "ok", moments, summary };
}

const timeButton =
  "inline-flex items-center rounded-control border border-border bg-card px-2 py-0.5 text-caption tabular-nums text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

export function YoutubePanel({
  source,
  startSeconds,
  enabled,
}: {
  source: YoutubePanelSource;
  startSeconds: number | null;
  enabled: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  // 사용자가 시각을 고르면 autoplay=1로 src를 바꾼다. nonce는 같은 시각을 다시 눌러도 iframe을 새로 만든다.
  const [play, setPlay] = useState<{ start: number; nonce: number } | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sources/${source.id}/moments`, { cache: "no-store" });
        if (!res.ok) throw new Error("moments_failed");
        const parsed = parse(await res.json());
        if (!parsed) throw new Error("moments_shape");
        if (!cancelled) setLoaded(parsed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, source.id, attempt]);

  const seek = (seconds: number) => setPlay((p) => ({ start: seconds, nonce: (p?.nonce ?? 0) + 1 }));

  const sectionProps = {
    "aria-label": "영상 플레이어와 장면 카드",
    "data-slot": "youtube-viewer",
    "data-video-id": source.video_id ?? undefined,
    "data-start-seconds": startSeconds ?? undefined,
  };

  if (!enabled || loaded?.kind === "disabled") {
    return (
      <section {...sectionProps} className="flex items-start gap-3 rounded-panel border border-dashed border-border bg-card p-4 text-muted-foreground">
        <PlaySquare aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>유튜브 기능 준비 중</p>
      </section>
    );
  }

  if (loaded?.kind === "unavailable") {
    return (
      <section {...sectionProps} className="flex items-start gap-3 rounded-panel border border-border bg-card p-4 text-muted-foreground">
        <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>원본 영상을 더 이상 볼 수 없어 요약과 장면 카드를 숨겼습니다.</p>
      </section>
    );
  }

  const src = isValidVideoId(source.video_id)
    ? play
      ? embedSrc(source.video_id, play.start, true)
      : embedSrc(source.video_id, startSeconds, false)
    : null;
  const originalUrl = safeExternalUrl(source.original_url);

  return (
    <section {...sectionProps} className="flex min-w-0 flex-col gap-4">
      {src ? (
        <div className="aspect-video w-full overflow-hidden rounded-panel border border-border bg-muted">
          <iframe
            key={play?.nonce ?? 0}
            src={src}
            title="유튜브 영상 플레이어"
            className="size-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      ) : (
        <p role="status" className="rounded-row bg-warning-soft p-3 text-caption text-warning">
          이 영상은 여기서 재생할 수 없습니다.
          {originalUrl ? " 원본 보기 링크에서 확인해 주세요." : null}
        </p>
      )}

      {failed ? (
        <ErrorState
          title="영상 요약과 장면 카드를 불러오지 못했습니다"
          onRetry={() => {
            setFailed(false);
            setLoaded(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : loaded === null ? (
        <div role="status" aria-busy="true" className="space-y-2 rounded-panel border border-border bg-card p-4">
          <span className="sr-only">영상 요약과 장면 카드를 불러오는 중</span>
          <Skeleton aria-hidden className="h-4 w-full" />
          <Skeleton aria-hidden className="h-4 w-5/6" />
        </div>
      ) : (
        <>
          <section aria-label="영상 요약" className="rounded-panel border border-border bg-card p-4 md:p-6">
            <h2 className="mb-3 flex flex-wrap items-center gap-2 text-h2 font-semibold">
              영상 요약
              <Badge variant="secondary">AI 요약</Badge>
            </h2>
            {loaded.summary ? (
              <ul className="flex flex-col gap-3">
                {loaded.summary.sentences.map((sentence, i) => {
                  const times = [...new Set(sentence.citations.map((c) => Math.floor(c.t_start)))];
                  return (
                    <li key={i} className="flex min-w-0 flex-col gap-1">
                      <p className="break-words">{sentence.text}</p>
                      {times.length > 0 ? (
                        <p className="flex flex-wrap gap-1.5">
                          {times.map((t) => (
                            <button key={t} type="button" className={timeButton} aria-label={`${timestamp(t)}부터 재생`} onClick={() => seek(t)}>
                              {timestamp(t)}
                            </button>
                          ))}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-caption text-muted-foreground">영상 요약이 아직 없습니다.</p>
            )}
          </section>

          <section aria-label="장면 카드" className="rounded-panel border border-border bg-card p-4 md:p-6">
            <h2 className="mb-3 text-h2 font-semibold">장면 카드</h2>
            {loaded.moments.length > 0 ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {loaded.moments.map((m) => (
                  <li key={m.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => seek(m.t_start)}
                      className="flex w-full min-w-0 flex-col gap-1 rounded-row border border-border bg-card p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="text-caption tabular-nums text-primary">
                        {timestamp(m.t_start)} ~ {timestamp(m.t_end)}
                      </span>
                      <span className="font-semibold break-words">{m.title}</span>
                      {m.description ? <span className="text-caption break-words text-muted-foreground">{m.description}</span> : null}
                      <span className="text-caption text-warning">AI가 본 장면, 전사 근거 아님</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted-foreground">이 영상에서 찾은 장면 카드가 없습니다.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
