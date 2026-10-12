import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "@/layouts/AdminLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { PageLoader } from "@/components/ui/feedback";
import AdminLoginPage from "@/pages/AdminLoginPage";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";

// Route-level code splitting keeps the initial bundle small. The public entry
// routes stay eager; the heavier authenticated and admin screens load on demand.
const LevelPage = lazy(() => import("@/pages/LevelPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const AdminAuditPage = lazy(() => import("@/pages/admin/AdminAuditPage"));
const AdminFlagsPage = lazy(() => import("@/pages/admin/AdminFlagsPage"));
const AdminLevelDetailPage = lazy(() => import("@/pages/admin/AdminLevelDetailPage"));
const AdminLevelsPage = lazy(() => import("@/pages/admin/AdminLevelsPage"));
const AdminOverviewPage = lazy(() => import("@/pages/admin/AdminOverviewPage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/AdminSettingsPage"));
const AdminStudentsPage = lazy(() => import("@/pages/admin/AdminStudentsPage"));
const AdminStudentReviewProfilePage = lazy(
  () => import("@/pages/admin/AdminStudentReviewProfilePage"),
);
const AdminFinishersPage = lazy(() => import("@/pages/admin/AdminFinishersPage"));

export function App() {
  return (
    <Suspense fallback={<PageLoader label="Loading" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/progress" element={<Navigate to="/dashboard" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="level/:levelId" element={<LevelPage />} />
        </Route>

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminOverviewPage />} />
          <Route path="levels" element={<AdminLevelsPage />} />
          <Route path="levels/:id" element={<AdminLevelDetailPage />} />
          <Route path="finishers" element={<AdminFinishersPage />} />
          <Route path="reviews" element={<Navigate to="/admin/finishers" replace />} />
          <Route path="flags" element={<AdminFlagsPage />} />
          <Route path="students" element={<AdminStudentsPage />} />
          <Route path="students/:studentId" element={<AdminStudentReviewProfilePage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
