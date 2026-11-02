import { cn } from "@/lib/utils";

type Tone = "default" | "danger" | "warning";

const TONE: Record<Tone, string> = {
  default: "bg-accent text-accent-foreground",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
};

export function StateCard({
  icon,
  title,
  description,
  tone = "default",
  role,
  headingLevel = 2,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: Tone;
  role?: "alert" | "status";
  headingLevel?: 1 | 2;
  className?: string;
  children?: React.ReactNode;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      role={role}
      className={cn("flex flex-col items-start gap-3 rounded-panel border border-border bg-card p-4", className)}
    >
      <span aria-hidden className={cn("grid size-10 place-items-center rounded-row", TONE[tone])}>
        {icon}
      </span>
      <div>
        <Heading className="font-semibold">{title}</Heading>
        {description ? <p className="mt-1 text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

// 빈 상태: 다음에 할 일을 알려 주고 행동 버튼은 children으로 받는다.
export function EmptyState(props: Omit<React.ComponentProps<typeof StateCard>, "role" | "tone">) {
  return <StateCard {...props} />;
}
