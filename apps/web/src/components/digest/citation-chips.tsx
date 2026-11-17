import type { DigestCitation } from "./types";

/** 초 → m:ss(1시간 이상이면 h:mm:ss) */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

/** 칩 글자: 영상은 m:ss, PDF는 p.N. 둘 다 모르면 칩을 만들지 않는다 */
export function citationLabel(c: DigestCitation): string | null {
  if (c.t_start !== null) return formatClock(c.t_start);
  if (c.page !== null) return `p.${c.page}`;
  return null;
}

// 인용 칩(docs/digest-contract.md §1): 11px 회색 글자·옅은 바탕·작은 반경. 누르면 원문(영상 그 시각·PDF 그 쪽)으로 간다.
// 같은 글자의 인용이 여럿이면 첫 인용 하나만 둔다.
export function CitationChips({ citations, onCite }: { citations: DigestCitation[]; onCite: (c: DigestCitation) => void }) {
  const chips = new Map<string, DigestCitation>();
  for (const c of citations) {
    const label = citationLabel(c);
    if (label !== null && !chips.has(label)) chips.set(label, c);
  }
  if (chips.size === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {[...chips].map(([label, c]) => (
        <button
          key={label}
          type="button"
          data-citation
          onClick={() => onCite(c)}
          className="rounded-sm bg-muted px-1.5 text-digest-chip font-normal text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {label}
          <span className="sr-only"> 원문 보기</span>
        </button>
      ))}
    </span>
  );
}
