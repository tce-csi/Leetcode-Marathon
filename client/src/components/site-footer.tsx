import { Link } from "react-router-dom";
import { EVENT_NAME, ORGANIZER } from "@/lib/organizer";

export function SiteFooter({ showAdminLink = false }: { showAdminLink?: boolean }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 text-xs text-muted sm:flex-row sm:px-6">
        <p>© 2026 {ORGANIZER.shortName} · {EVENT_NAME}</p>
        {showAdminLink ? (
          <Link to="/admin/login" className="hover:text-foreground">
            Administrator access
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
