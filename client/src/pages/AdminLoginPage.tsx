import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, isApiError } from "@/lib/api-client";
import type { PublicAdmin } from "@/lib/types";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post<{ admin: PublicAdmin }>("/api/auth/admin/login", { email, password }, "admin");
      await refresh();
      toast.success("Administrator signed in.");
      navigate("/admin");
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to sign in right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Administrator sign in" description="Restricted access to the contest console.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="admin@college.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" block size="lg" loading={submitting}>
          Sign in to console
        </Button>
      </form>
    </AuthShell>
  );
}
