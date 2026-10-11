import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, isApiError } from "@/lib/api-client";
import type { PublicStudent } from "@/lib/types";

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [rollNumber, setRollNumber] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post<{ student: PublicStudent }>("/api/auth/login", { rollNumber, password });
      await refresh();
      toast.success("Signed in. Good luck!");
      navigate("/dashboard");
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to sign in right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in with the roll number you registered."
      footer={
        <>
           New here?{" "}
           <Link to="/register" className="font-semibold text-foreground underline-offset-4 hover:underline">
             Create an account
           </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Roll number" htmlFor="rollNumber">
          <Input
            id="rollNumber"
            autoComplete="username"
            placeholder="21CS1042"
            value={rollNumber}
            onChange={(e) => setRollNumber(e.target.value)}
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
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
