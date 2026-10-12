import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const SUPPORTED_LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["value"];

interface LanguageSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function LanguageSelect({
  value,
  onChange,
  disabled = false,
  className,
  id = "programming-language-select",
}: LanguageSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected =
    SUPPORTED_LANGUAGES.find((lang) => lang.value === value) ?? SUPPORTED_LANGUAGES[0]!;

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((prev) => !prev);
      return;
    }

    if (open) {
      const currentIndex = SUPPORTED_LANGUAGES.findIndex((l) => l.value === value);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % SUPPORTED_LANGUAGES.length;
        onChange(SUPPORTED_LANGUAGES[nextIndex]!.value);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + SUPPORTED_LANGUAGES.length) % SUPPORTED_LANGUAGES.length;
        onChange(SUPPORTED_LANGUAGES[prevIndex]!.value);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Accessible native select kept in sync for screen readers and automated tests */}
      <select
        id={id}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only pointer-events-none absolute opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>

      {/* Styled custom trigger button */}
      <button
        ref={triggerRef}
        type="button"
        id={`${id}-trigger`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        aria-label="Programming Language"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border px-3 py-1.5 text-xs font-mono transition-colors",
          "border-border bg-surface text-foreground shadow-xs",
          "hover:border-border-strong focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-foreground ring-1 ring-foreground",
        )}
      >
        <span className="truncate font-medium">{selected.label}</span>
        <ChevronDown
          className={cn(
            "ml-2 size-3.5 shrink-0 text-muted transition-transform duration-200",
            open && "rotate-180 text-foreground",
          )}
        />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label="Programming Language Options"
          className={cn(
            "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border p-1 shadow-lg",
            "border-border bg-surface text-foreground animate-in-fade",
          )}
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang.value === value;
            return (
              <div
                key={lang.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => {
                  onChange(lang.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(lang.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
                className={cn(
                  "relative flex cursor-pointer select-none items-center justify-between rounded-sm px-2.5 py-1.5 text-xs font-mono transition-colors",
                  "text-foreground hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
                  isSelected && "bg-surface-3 font-semibold",
                )}
              >
                <span>{lang.label}</span>
                {isSelected && <Check className="size-3.5 text-foreground" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
