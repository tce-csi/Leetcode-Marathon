import { Link } from "react-router-dom";
import { CsiBrand } from "@/components/brand";
import { EVENT_NAME, ORGANIZER } from "@/lib/organizer";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <CsiBrand />
          <p className="max-w-md text-xs leading-relaxed text-muted">
            Organized by {ORGANIZER.fullName}.
          </p>
          <p className="text-xs text-muted">{ORGANIZER.college}</p>
        </div>
        <div className="flex flex-col gap-2 text-xs text-muted md:items-end">
          {ORGANIZER.links.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ORGANIZER.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
          <p>
            © {new Date().getFullYear()} {ORGANIZER.shortName} · {EVENT_NAME} — {ORGANIZER.tagline}
          </p>
          <Link to="/admin/login" className="hover:text-foreground">
            Administrator access
          </Link>
        </div>
      </div>
    </footer>
  );
}
