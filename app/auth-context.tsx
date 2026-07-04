'use client';

import { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import type { LoginResponse } from './api';

// Auth state lives in memory only (React state). A full page refresh clears it
// and the dashboard will bounce back to the login page -- that's the deliberate
// minimal choice for this dev prototype.
//
// To persist across refreshes later, swap the useState below for reads/writes to
// sessionStorage (tab-scoped) or localStorage (survives restarts). One spot.

interface AuthState {
  token: string | null;
  user: LoginResponse['user'] | null;
  setSession: (res: LoginResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LoginResponse['user'] | null>(null);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      setSession: (res) => {
        setToken(res.accessToken);
        setUser(res.user);
      },
      logout: () => {
        setToken(null);
        setUser(null);
      },
    }),
    [token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
