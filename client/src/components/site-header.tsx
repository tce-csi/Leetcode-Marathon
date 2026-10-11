import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Code2, ExternalLink, LogOut, Menu, Trophy, X } from "lucide-react";
import { CsiBrand, Logo } from "@/components/brand";
import { useSession } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn, getInitials } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Contest", icon: <Code2 className="size-4" /> },
  { href: "/leaderboard", label: "Leaderboard", icon: <Trophy className="size-4" /> },
];

export function SiteHeader() {
  const { student, loading, signOutStudent } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const handleSignOut = async () => {
    await signOutStudent();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo subtitle="CSI TCE Presents" />
          <span className="hidden h-8 w-px bg-border lg:block" aria-hidden />
          <CsiBrand className="hidden lg:inline-flex" />
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith(item.href)
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-strong hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />

          <div className="hidden items-center gap-2 md:flex">
            {loading ? null : student ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-2.5 text-sm transition-colors hover:border-border-strong"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                    {getInitials(student.full_name)}
                  </span>
                  <span className="max-w-28 truncate text-xs font-medium text-foreground">
                    {student.full_name.split(" ")[0]}
                  </span>
                  <ChevronDown className="size-3.5 text-muted" />
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
                  >
                    <div className="border-b border-border px-4 py-3">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {student.full_name}
                      </p>
                      <p className="truncate font-mono text-xs text-muted">{student.roll_number}</p>
                    </div>
                    <div className="p-1">
                      <Link
                        to="/dashboard"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-strong hover:bg-surface-2 hover:text-foreground"
                        role="menuitem"
                      >
                        <Code2 className="size-4" /> My contest
                      </Link>
                      {student.leetcode_profile_url ? (
                        <a
                          href={student.leetcode_profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-strong hover:bg-surface-2 hover:text-foreground"
                          role="menuitem"
                        >
                          <ExternalLink className="size-4" /> LeetCode profile
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-strong hover:bg-surface-2 hover:text-foreground"
                        role="menuitem"
                      >
                        <LogOut className="size-4" /> Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Register</Button>
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-muted-strong hover:bg-surface-2 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border bg-surface px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
                  pathname.startsWith(item.href)
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-strong hover:bg-surface-2",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
              {student ? (
                <>
                  <span className="flex-1 truncate text-sm text-muted-strong">
                    {student.full_name}
                  </span>
                  <Button variant="secondary" size="sm" onClick={handleSignOut}>
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Link to="/login" className="flex-1" onClick={() => setOpen(false)}>
                    <Button variant="secondary" size="sm" block>
                      Sign in
                    </Button>
                  </Link>
                  <Link to="/register" className="flex-1" onClick={() => setOpen(false)}>
                    <Button size="sm" block>
                      Register
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
