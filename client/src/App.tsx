import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "@/layouts/AdminLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import AdminLoginPage from "@/pages/AdminLoginPage";
import LandingPage from "@/pages/LandingPage";
import LeaderboardPage from "@/pages/LeaderboardPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import LevelPage from "@/pages/LevelPage";
import DashboardPage from "@/pages/DashboardPage";
import AdminAuditPage from "@/pages/admin/AdminAuditPage";
import AdminFlagsPage from "@/pages/admin/AdminFlagsPage";
import AdminLevelDetailPage from "@/pages/admin/AdminLevelDetailPage";
import AdminLevelsPage from "@/pages/admin/AdminLevelsPage";
import AdminOverviewPage from "@/pages/admin/AdminOverviewPage";
import AdminReviewsPage from "@/pages/admin/AdminReviewsPage";
import AdminSettingsPage from "@/pages/admin/AdminSettingsPage";
import AdminStudentsPage from "@/pages/admin/AdminStudentsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
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
        <Route path="reviews" element={<AdminReviewsPage />} />
        <Route path="flags" element={<AdminFlagsPage />} />
        <Route path="students" element={<AdminStudentsPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
