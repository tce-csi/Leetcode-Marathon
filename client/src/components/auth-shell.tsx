import { Link } from "react-router-dom";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ORGANIZER } from "@/lib/organizer";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-6 flex flex-col items-center gap-2">
        <Logo />
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
          by {ORGANIZER.shortName}
        </p>
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}
      <Link to="/" className="mt-6 text-xs text-muted hover:text-foreground">
        ← Back to home
      </Link>
    </div>
  );
}
