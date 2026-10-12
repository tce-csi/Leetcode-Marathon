import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ContestCompleted } from "@/components/contest-completed";
import { RequireStudent } from "@/components/require-auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { api } from "@/lib/api-client";
import type { ProgressSummary } from "@/lib/services/progression";
import type { PublicStudent } from "@/lib/types";

interface DashboardRoadmap {
  student: PublicStudent;
  summary: ProgressSummary;
}

export function DashboardLayout() {
  // Shares the ["student","roadmap"] cache with DashboardPage. Once the student
  // has submitted their contest for review, every dashboard route (including
  // level pages) is replaced by the completion screen. The backend independently
  // rejects all mutating calls, so this is a presentation layer over an
  // already-enforced lock.
  const { data } = useQuery<DashboardRoadmap>({
    queryKey: ["student", "roadmap"],
    queryFn: () => api.get<DashboardRoadmap>("/api/student/roadmap"),
    refetchInterval: 12000,
  });

  const finalized = Boolean(data?.summary.finalizedAt);

  return (
    <RequireStudent>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {finalized && data ? (
            <ContestCompleted studentName={data.student.full_name} summary={data.summary} />
          ) : (
            <Outlet />
          )}
        </main>
        <SiteFooter />
      </div>
    </RequireStudent>
  );
}
