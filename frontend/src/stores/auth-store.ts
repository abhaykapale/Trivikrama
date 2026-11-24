import { create } from "zustand";
import type { AuthStatus, SessionUser } from "@/types/auth";

interface AuthState {
  readonly status: AuthStatus;
  readonly user: SessionUser | null;
  readonly expiresAt: string | null;
  readonly setLoading: () => void;
  readonly setSession: (user: SessionUser, expiresAt: string | null) => void;
  readonly clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  expiresAt: null,
  setLoading: () => set({ status: "loading" }),
  setSession: (user, expiresAt) => set({ status: "authenticated", user, expiresAt }),
  clearSession: () => set({ status: "unauthenticated", user: null, expiresAt: null }),
}));
