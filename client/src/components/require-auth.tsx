import { Navigate } from "react-router-dom";
import { useSession } from "@/components/session-provider";
import { PageLoader } from "@/components/ui/feedback";

export function RequireStudent({ children }: { children: React.ReactNode }) {
  const { student, loading } = useSession();

  if (loading) return <PageLoader label="Checking your session" />;
  if (!student) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useSession();

  if (loading) return <PageLoader label="Checking your session" />;
  if (!admin) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
