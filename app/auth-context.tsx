'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { LoginResponse } from './api';
import { setUnauthorizedHandler } from './api';

// Auth state is persisted to localStorage so a hard refresh or a pasted deep
// link (e.g. /athletes/[id]) keeps the user signed in -- the whole point of the
// shareable profile/team/article pages. On load the session is rehydrated from
// storage behind a brief "restoring" gate, so deep links neither bounce to the
// login page nor render authed content before the token is ready.
//
// SECURITY: localStorage is readable by any script on the origin, so a token
// stored here is exposed to XSS. That's an accepted trade-off for this v1 -- no
// untrusted third-party scripts run in this app. The launch-hardening path is
// httpOnly, SameSite cookies + short-lived access tokens with a refresh token,
// which keeps the token out of JS entirely. TODO(launch): move to that. Nothing
// beyond the token + basic user object (+ the must-change-password flag) is ever
// persisted here.

const STORAGE_KEY = 'sf_session';
// Breadcrumb of where the user was when a mid-session 401 signed them out, so a
// future version could return them there after re-login. We only store it; there
// is no full redirect-back flow yet.
const INTENDED_PATH_KEY = 'sf_intended_path';

// The only shape we persist: token + basic user + the two must-flags.
interface PersistedSession {
  accessToken: string;
  user: LoginResponse['user'];
  mustChangePassword: boolean;
  // Optional on read: a session persisted before the 18+ gate shipped has no
  // such key, and those are exactly the accounts that owe an attestation. Absent
  // reads as false, which is the SAFE direction -- the gate's 403 still catches
  // them, we just don't get to open the prompt a beat early.
  mustAttestAge?: boolean;
}

interface AuthState {
  token: string | null;
  user: LoginResponse['user'] | null;
  // Mirrors the login response. Persisted so a reload mid-forced-change still
  // routes the user to set their real password instead of escaping the flow.
  mustChangePassword: boolean;
  // Mirrors the login response. DELIBERATELY NOT A REDIRECT, unlike the flag
  // above: reads are ungated on purpose, so a fan who only follows and watches
  // is never interrupted. The 18+ gate prompt opens at the eight entry surfaces
  // and nowhere else -- this flag only lets it open a beat BEFORE the doomed
  // call instead of after its 403. See age-gate.tsx.
  mustAttestAge: boolean;
  // True only while the initial localStorage rehydration is in flight. Pages
  // never see this directly -- the provider renders a loader until it clears --
  // but it's exposed for completeness.
  restoring: boolean;
  setSession: (res: LoginResponse) => void;
  logout: () => void;
  // Called after a successful password change so the persisted forced-change
  // flag doesn't re-trigger the flow on the next reload.
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// Read the `exp` claim out of a JWT WITHOUT verifying the signature -- the
// backend still enforces the token; this is only a client-side "is it already
// stale?" check so we don't restore a dead session. Returns true (treat as
// expired) for anything unparseable. A token with no exp claim is treated as
// non-expiring so it survives (dev-minted tokens still get server-checked).
function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const claims = JSON.parse(atob(b64 + pad));
    if (typeof claims.exp !== 'number') return false;
    return claims.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// A minimal branded placeholder shown for the one tick it takes to rehydrate the
// session, in place of the real page. Reuses existing feed styles -- no new CSS.
function SessionRestoring() {
  return (
    <main className="feed-home">
      <div className="header-row">
        <span className="wordmark">Sharp Foxx</span>
      </div>
      <div className="card muted">Restoring your session…</div>
    </main>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LoginResponse['user'] | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustAttestAge, setMustAttestAge] = useState(false);
  const [restoring, setRestoring] = useState(true);

  // Rehydrate once on mount (client only -- localStorage/atob don't exist during
  // SSR). Both the server render and the first client render see restoring=true,
  // so the loader hydrates cleanly with no mismatch; this effect then flips it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedSession;
        if (parsed?.accessToken && !isTokenExpired(parsed.accessToken)) {
          setToken(parsed.accessToken);
          setUser(parsed.user);
          setMustChangePassword(!!parsed.mustChangePassword);
          // Restored, NOT acted on -- there is no attestation redirect by
          // design. See the field comment on AuthState.
          setMustAttestAge(!!parsed.mustAttestAge);
          // Respect the forced-change flow across reloads: if the restored user
          // still owes a password change, route them there (unless already on it).
          if (
            parsed.mustChangePassword &&
            !pathname.startsWith('/account/password')
          ) {
            router.replace('/account/password?first=1');
          }
        } else {
          // Expired or malformed -> drop it and land on login, as before.
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // Corrupt JSON / storage unavailable -- start clean.
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing we can do */
      }
    }
    setRestoring(false);
    // Mount-only: capture the initial pathname/router and rehydrate exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the central 401 handler: an authed call that 401s (expired or
  // invalidated token mid-session) tears the session down HERE, in one place,
  // and bounces to login -- leaving a breadcrumb of where the user was.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      try {
        const here = window.location.pathname;
        if (here && here !== '/') localStorage.setItem(INTENDED_PATH_KEY, here);
      } catch {
        /* ignore storage failures */
      }
      setToken(null);
      setUser(null);
      setMustChangePassword(false);
      setMustAttestAge(false);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.replace('/');
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      mustChangePassword,
      mustAttestAge,
      restoring,
      // Also the token swap after POST /auth/attest-age: that response is
      // login-shaped and carries mustAttestAge:false, so affirming clears the
      // flag and installs the att:true token through this one path.
      setSession: (res) => {
        const mcp = res.mustChangePassword ?? false;
        const maa = res.mustAttestAge ?? false;
        setToken(res.accessToken);
        setUser(res.user);
        setMustChangePassword(mcp);
        setMustAttestAge(maa);
        try {
          const persisted: PersistedSession = {
            accessToken: res.accessToken,
            user: res.user,
            mustChangePassword: mcp,
            mustAttestAge: maa,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
        } catch {
          /* storage unavailable -- session stays in memory for this tab */
        }
      },
      logout: () => {
        setToken(null);
        setUser(null);
        setMustChangePassword(false);
        setMustAttestAge(false);
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(INTENDED_PATH_KEY);
        } catch {
          /* ignore */
        }
      },
      clearMustChangePassword: () => {
        setMustChangePassword(false);
        // Re-persist the existing session sans the flag so a later reload doesn't
        // re-force the change. No-op if there's nothing stored.
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as PersistedSession;
            parsed.mustChangePassword = false;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          }
        } catch {
          /* ignore */
        }
      },
    }),
    [token, user, mustChangePassword, mustAttestAge, restoring],
  );

  return (
    <AuthContext.Provider value={value}>
      {restoring ? <SessionRestoring /> : children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
