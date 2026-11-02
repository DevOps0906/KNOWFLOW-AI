import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// 알약형 컨트롤. ::after로 터치 영역만 --size-touch까지 넓힌다(겉모습 그대로).
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-body font-semibold whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 after:absolute after:top-1/2 after:left-1/2 after:h-[max(100%,var(--size-touch))] after:w-[max(100%,var(--size-touch))] after:-translate-1/2 after:content-[''] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125rem]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-110",
        destructive: "bg-destructive text-destructive-foreground hover:brightness-110",
        outline:
          "border border-input bg-background text-caption font-medium text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-[1.125rem]",
        xs: "h-6 gap-1 px-2 text-caption",
        sm: "h-8 px-3 text-caption",
        lg: "h-12 px-6",
        icon: "size-9",
        "icon-xs": "size-6",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
