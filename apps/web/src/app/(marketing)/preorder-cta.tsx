import { buildPreorderHref } from "./preorder";

const CTA_CLASS =
  "relative inline-flex h-12 items-center justify-center rounded-control px-6 text-body font-semibold whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function PreorderCta({ href = buildPreorderHref() }: { href?: string | null }) {
  if (!href) {
    return (
      <button type="button" disabled className={`${CTA_CLASS} bg-muted text-muted-foreground`}>
        사전예약 준비 중
      </button>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${CTA_CLASS} bg-primary text-primary-foreground hover:brightness-110`}
    >
      사전예약
    </a>
  );
}
