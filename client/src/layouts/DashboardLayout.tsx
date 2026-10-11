import { Outlet } from "react-router-dom";
import { RequireStudent } from "@/components/require-auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function DashboardLayout() {
  return (
    <RequireStudent>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </RequireStudent>
  );
}
