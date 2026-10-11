import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { EVENT_NAME, ORGANIZER } from "@/lib/organizer";

export function Logo({
  className,
  href = "/",
  showText = true,
  subtitle = ORGANIZER.tagline,
}: {
  className?: string;
  href?: string | null;
  showText?: boolean;
  subtitle?: string;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5 font-bold tracking-tight", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-foreground text-background">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
          <path
            d="m8 6-5 6 5 6M16 6l5 6-5 6M13.5 4l-3 16"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showText ? (
        <span className="flex flex-col leading-none">
          <span className="text-base font-extrabold text-foreground">{EVENT_NAME}</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
            {subtitle}
          </span>
        </span>
      ) : null}
    </span>
  );

  if (!href) return content;
  return (
    <Link to={href} className="transition-opacity hover:opacity-80">
      {content}
    </Link>
  );
}

/**
 * Typographic CSI TCE placeholder. Replace the mark with the official logo when
 * the organizer supplies one — never invent or borrow an unrelated logo.
 */
export function CsiBrand({
  className,
  withLabel = true,
  href,
}: {
  className?: string;
  withLabel?: boolean;
  href?: string;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2 text-[11px] font-extrabold tracking-tight text-foreground">
        CSI
      </span>
      {withLabel ? (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-extrabold tracking-wide text-foreground">
            {ORGANIZER.shortName}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
            Student Chapter
          </span>
        </span>
      ) : null}
    </span>
  );

  if (!href) return content;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-opacity hover:opacity-80"
    >
      {content}
    </a>
  );
}
