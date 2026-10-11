import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setCsrfToken } from "@/lib/api-client";
import type { PublicAdmin, PublicStudent } from "@/lib/types";

interface SessionState {
  student: PublicStudent | null;
  admin: PublicAdmin | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOutStudent: () => Promise<void>;
  signOutAdmin: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [student, setStudent] = useState<PublicStudent | null>(null);
  const [admin, setAdmin] = useState<PublicAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [studentRes, adminRes] = await Promise.allSettled([
      api.get<{ student: PublicStudent | null; csrfToken: string | null }>("/api/auth/session"),
      api.get<{ admin: PublicAdmin | null; csrfToken: string | null }>("/api/auth/admin/session"),
    ]);

    if (studentRes.status === "fulfilled") {
      setStudent(studentRes.value.student);
      setCsrfToken("student", studentRes.value.csrfToken);
    } else {
      setStudent(null);
    }

    if (adminRes.status === "fulfilled") {
      setAdmin(adminRes.value.admin);
      setCsrfToken("admin", adminRes.value.csrfToken);
    } else {
      setAdmin(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signOutStudent = useCallback(async () => {
    await api.post("/api/auth/logout", undefined, "student").catch(() => undefined);
    setCsrfToken("student", null);
    setStudent(null);
  }, []);

  const signOutAdmin = useCallback(async () => {
    await api.post("/api/auth/admin/session", undefined, "admin").catch(() => undefined);
    setCsrfToken("admin", null);
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({ student, admin, loading, refresh, signOutStudent, signOutAdmin }),
    [student, admin, loading, refresh, signOutStudent, signOutAdmin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within a SessionProvider.");
  return context;
}
