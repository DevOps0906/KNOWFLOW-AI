import Link from "next/link";
import { PlayCircle } from "lucide-react";

/** 초 → mm:ss(1시간 이상은 h:mm:ss) */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function spoken(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h ? `${h}시간` : "", m ? `${m}분` : "", `${s}초`].filter(Boolean).join(" ");
}

/** 유튜브 시각 칩: locator.t_start를 mm:ss로 보여 주고 S-10 원문 뷰어의 그 청크로 이동한다. */
export function TimestampChip({ sourceId, chunkId, tStart }: { sourceId: string; chunkId: string; tStart: number }) {
  return (
    <Link
      href={`/sources/${encodeURIComponent(sourceId)}?chunk=${encodeURIComponent(chunkId)}`}
      aria-label={`${spoken(tStart)} 지점 원문 보기`}
      className="inline-flex h-6 items-center gap-1 rounded-control border border-input px-2 text-caption font-semibold tabular-nums outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <PlayCircle aria-hidden className="size-3.5" />
      {formatTimestamp(tStart)}
    </Link>
  );
}
