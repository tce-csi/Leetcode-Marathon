import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-2 text-muted-strong",
        brand: "border-foreground/30 bg-foreground/10 text-foreground",
        success: "border-foreground/40 bg-foreground/10 text-foreground",
        warning: "border-border-strong bg-surface-3 text-foreground",
        danger: "border-foreground/70 bg-transparent text-foreground",
        info: "border-border-strong bg-surface-2 text-muted-strong",
        accent: "border-foreground/30 bg-foreground/10 text-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
