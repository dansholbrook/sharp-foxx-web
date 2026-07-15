'use client';

// One shared source of truth for the signed-in fan's points BALANCE, so the ⚡
// chip in the nav and the pick cards on a game page can't disagree. Fetched once
// when a token appears (GET /predictions/my-picks), then moved only by
// applyBalance: both a pick's response and the /picks page's own read carry an
// authoritative balance, so the chip never needs a re-fetch of its own.
//
// Deliberately balance-ONLY. The wallet's other half (lifetimeEarned) lives on
// /picks, which fetches the full report anyway — holding a second copy here
// would just be a thing to get stale, since it only moves when a question
// RESOLVES, which happens courtside and never through this client.
//
// POINTS ONLY: a closed-loop score with no monetary value. Never money.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from './auth-context';
import { getMyPicks } from './api';

interface PointsState {
  // null until the wallet has loaded (or if it failed) — the chip renders
  // nothing rather than flashing a wrong "0 pts" at a fan who has points.
  balance: number | null;
  // Set the balance from an authoritative figure (a pick response, or /picks'
  // own full read).
  applyBalance: (balance: number) => void;
}

const PointsContext = createContext<PointsState | undefined>(undefined);

export function PointsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);

  // Load once per token (login / logout re-runs it).
  useEffect(() => {
    if (!token) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    getMyPicks(token)
      .then((report) => {
        if (!cancelled) setBalance(report.balance);
      })
      .catch(() => {
        // Best-effort: the wallet is an identity garnish, not a gate. A failed
        // load leaves balance null (chip hides) and picking still works — the
        // pick response repairs the balance on its own. The 401 path inside the
        // client tears the session down.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const applyBalance = useCallback((next: number) => setBalance(next), []);

  const value = useMemo<PointsState>(
    () => ({ balance, applyBalance }),
    [balance, applyBalance],
  );

  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>;
}

export function usePoints(): PointsState {
  const ctx = useContext(PointsContext);
  if (!ctx) throw new Error('usePoints must be used within <PointsProvider>');
  return ctx;
}
