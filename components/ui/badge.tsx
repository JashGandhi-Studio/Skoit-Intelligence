import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] leading-5 tracking-tight",
  {
    variants: {
      tone: {
        neutral: "border-hairline bg-surface-2 text-muted-foreground",
        primary: "border-primary/35 bg-primary-soft text-primary-strong",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/35 bg-warning/12 text-warning",
        danger: "border-danger/35 bg-danger/10 text-danger",
        info: "border-info/30 bg-info/10 text-info",
        ink: "border-transparent bg-ink text-background",
      },
      mono: { true: "font-mono text-[10.5px]", false: "" },
    },
    defaultVariants: { tone: "neutral", mono: false },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, mono, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, mono }), className)} {...props} />;
}

export function Dot({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block size-1.5 rounded-full bg-current", className)} />
  );
}
