"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start justify-between gap-4",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {(label || description) && (
        <span className="space-y-0.5">
          {label ? <span className="block text-sm font-medium text-foreground">{label}</span> : null}
          {description ? <span className="block text-xs text-muted">{description}</span> : null}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-foreground bg-foreground" : "border-border-strong bg-surface-3",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full shadow transition-transform",
            checked ? "translate-x-6 bg-background" : "translate-x-1 bg-foreground",
          )}
        />
      </button>
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2.5", disabled && "opacity-60", className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          checked ? "border-foreground bg-foreground text-background" : "border-border-strong bg-surface-2",
        )}
      >
        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </button>
      {label ? <span className="text-sm text-foreground">{label}</span> : null}
    </label>
  );
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string; disabled?: boolean }[];
  name?: string;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const selected = option.value === value;
        const disabled = option.disabled ?? false;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(option.value)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
              disabled
                ? "cursor-not-allowed border-border bg-surface-2/40 opacity-60"
                : selected
                  ? "border-foreground bg-surface-2"
                  : "border-border bg-surface-2/60 hover:border-border-strong",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                selected && !disabled ? "border-foreground" : "border-border-strong",
              )}
            >
              {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              {option.description ? (
                <span className="block text-xs text-muted">{option.description}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
