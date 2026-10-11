import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted-strong">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="font-semibold text-foreground">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
