import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ClipboardCheck,
  Flag,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Users,
  X,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { useSession } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, getInitials } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/levels", label: "Levels", icon: ListChecks },
  { href: "/admin/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/admin/flags", label: "Flags", icon: Flag },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { admin, signOutAdmin } = useSession();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOutAdmin();
    navigate("/admin/login");
  };

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive(item)
                ? "bg-brand/15 text-brand-soft"
                : "text-muted-strong hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface/60 p-4 lg:flex">
        <div className="mb-6 px-1">
          <Logo />
        </div>
        {nav}
        <div className="mt-auto space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand-soft">
              {admin ? getInitials(admin.name) : "AD"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{admin?.name ?? "Administrator"}</p>
              <p className="truncate text-xs text-muted">{admin?.email}</p>
            </div>
          </div>
          <Button variant="secondary" block size="sm" onClick={handleSignOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-muted-strong hover:bg-surface-2 lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <Badge variant="brand">Admin console</Badge>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="lg:hidden"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        {open ? (
          <div className="border-b border-border bg-surface/95 p-4 lg:hidden">{nav}</div>
        ) : null}

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
