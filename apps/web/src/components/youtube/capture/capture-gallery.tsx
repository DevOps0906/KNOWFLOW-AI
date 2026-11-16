import { Camera, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp, safeExternalUrl } from "@/components/workspace/viewer/format";
import { cleanUntrustedText } from "../text";
import type { CaptureListItem, CaptureStatus } from "./use-captures";

/** 장면 카드 옆 캡처 버튼(데스크톱 전용, 호출부가 진입을 결정한다) */
export function CaptureMomentButton({
  label,
  busy,
  disabled,
  onCapture,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onCapture: () => void;
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} aria-busy={busy} aria-label={`${label} 화면 캡처`} onClick={onCapture}>
      <Camera aria-hidden className="size-4" />
      {busy ? "캡처 중…" : "화면 캡처"}
    </Button>
  );
}

// L1 캡처 목록: 비공개 저장, 시각·채널·원본 링크를 자동 표기한다. 이미지 주소는 짧은 서명 URL이다(공개 공유 없음).
export function CaptureGallery({
  list,
  status,
  onRetry,
}: {
  list: { kind: "loading" } | { kind: "error" } | { kind: "ok"; limit: number; captures: CaptureListItem[] } | { kind: "off" };
  status: CaptureStatus;
  onRetry: () => void;
}) {
  if (list.kind === "off") return null;
  return (
    <section aria-labelledby="capture-gallery-title" className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="capture-gallery-title" className="font-semibold">
          내 화면 캡처
        </h2>
        <Badge variant="secondary">비공개 · 직접 승인한 탭 캡처</Badge>
        {list.kind === "ok" ? (
          <span className="text-caption text-muted-foreground tabular-nums">
            {list.captures.length} / {list.limit}장
          </span>
        ) : null}
      </div>
      <p role="status" className="text-caption text-muted-foreground">
        {status.kind === "error" ? <span className="text-warning">{status.message}</span> : status.kind === "saved" ? "캡처를 저장했습니다." : null}
      </p>
      {list.kind === "loading" ? (
        <Skeleton aria-hidden className="h-24 w-full rounded-panel" />
      ) : list.kind === "error" ? (
        <div className="flex items-center gap-2 text-caption">
          캡처 목록을 불러오지 못했습니다.
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      ) : list.captures.length === 0 ? (
        <p className="text-caption text-muted-foreground">장면 카드의 &quot;화면 캡처&quot;를 누르고 이 탭 공유를 허용하면 그 장면을 저장합니다.</p>
      ) : (
        <ul className="grid gap-3 desk:grid-cols-2">
          {list.captures.map((c) => {
            const href = safeExternalUrl(c.source_url);
            const time = formatTimestamp(c.t_seconds);
            const channel = c.channel_title ? cleanUntrustedText(c.channel_title) : null;
            return (
              <li key={c.id} className="flex min-w-0 flex-col gap-2 rounded-row border border-border p-2">
                {/* 서명 URL(비공개 버킷)을 그대로 표시한다. next/image 프록시를 쓰지 않는다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt={`${time} 장면 캡처`} loading="lazy" className="aspect-video w-full rounded-row bg-black object-contain" />
                <div className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                  <span className="tabular-nums">{time}</span>
                  {channel ? <span className="break-words">{channel}</span> : null}
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-4">
                      원본에서 이 시각 보기
                      <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
