import { Outlet } from "react-router-dom";
import { AdminShell } from "@/components/admin/admin-shell";
import { RequireAdmin } from "@/components/require-auth";

export function AdminLayout() {
  return (
    <RequireAdmin>
      <AdminShell>
        <Outlet />
      </AdminShell>
    </RequireAdmin>
  );
}
