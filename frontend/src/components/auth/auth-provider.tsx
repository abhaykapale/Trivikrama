"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { getCurrentUser, login as loginRequest, logout as logoutRequest, refreshSession } from "@/services/api/auth";
import { setUnauthorizedHandler } from "@/services/api/client";
import type { LoginRequest } from "@/services/api/schemas";
import { useAuthStore } from "@/stores/auth-store";
import type { AuthStatus, SessionUser } from "@/types/auth";
import { calculateRefreshDelay } from "@/utils/session";

interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: SessionUser | null;
  readonly login: (credentials: LoginRequest) => Promise<void>;
  readonly logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const { status, user, expiresAt, setSession, clearSession } = useAuthStore();
  const refreshPromise = useRef<Promise<void> | null>(null);
  const bootstrapStarted = useRef(false);

  const handleUnauthorized = useCallback(() => {
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    if (!bootstrapStarted.current) {
      bootstrapStarted.current = true;
      void getCurrentUser()
        .then((currentUser) => setSession(currentUser, null))
        .catch(() => clearSession());
    }

    return () => setUnauthorizedHandler(null);
  }, [clearSession, handleUnauthorized, setSession]);

  const refresh = useCallback(async () => {
    if (refreshPromise.current) return refreshPromise.current;

    const operation = refreshSession()
      .then(({ expiresAt: nextExpiry }) => {
        const currentUser = useAuthStore.getState().user;
        if (currentUser) setSession(currentUser, nextExpiry);
      })
      .catch(() => {
        clearSession();
        toast.error("Your session has expired. Please sign in again.");
        router.replace("/login");
      })
      .finally(() => {
        refreshPromise.current = null;
      });

    refreshPromise.current = operation;
    return operation;
  }, [clearSession, router, setSession]);

  useEffect(() => {
    if (status !== "authenticated" || !expiresAt) return;
    const delay = calculateRefreshDelay(expiresAt);
    if (delay === null) {
      clearSession();
      return;
    }

    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [clearSession, expiresAt, refresh, status]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const session = await loginRequest(credentials);
      setSession(session.user, session.expiresAt);
    },
    [setSession],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Local session removal is mandatory even when the server is unavailable.
    } finally {
      clearSession();
      router.replace("/login");
      router.refresh();
    }
  }, [clearSession, router]);

  const value = useMemo(() => ({ status, user, login, logout }), [login, logout, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
