import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-brand border-t-transparent",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shimmer rounded-lg", className)} {...props} />;
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
      <Spinner className="size-7" />
      <p className="text-sm">{label}…</p>
    </div>
  );
}
