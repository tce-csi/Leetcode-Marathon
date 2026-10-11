"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 max-h-[92dvh] w-full animate-in-up overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-w-lg sm:rounded-2xl",
          className,
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div className="space-y-1">
              {title ? (
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              ) : null}
              {description ? <p className="text-sm text-muted">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="Close dialog"
            >
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-3 border-t border-border p-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
