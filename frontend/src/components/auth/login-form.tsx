"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/types/api";
import { getSafeReturnPath } from "@/utils/navigation";

export function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace(getSafeReturnPath(searchParams.get("next")));
  }, [router, searchParams, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login({ username, password });
      toast.success("Secure session established.");
      router.replace(getSafeReturnPath(searchParams.get("next")));
      router.refresh();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <div className="field-group">
        <label htmlFor="username">Username</label>
        <div className="field-control">
          <UserRound size={18} aria-hidden="true" />
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={100}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="field-group">
        <label htmlFor="password">Password</label>
        <div className="field-control">
          <KeyRound size={18} aria-hidden="true" />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      <button className="primary-button" type="submit" disabled={submitting || status === "loading"}>
        {submitting ? <span className="button-spinner" aria-hidden="true" /> : null}
        {submitting ? "Authenticating…" : "Sign in securely"}
      </button>
    </form>
  );
}
