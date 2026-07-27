'use client';

// One shared source of truth for the signed-in fan's points BALANCE, so the ⚡
// chip in the nav and the pick cards on a game page can't disagree. Fetched once
// when a token appears (GET /predictions/my-picks), then moved only by
// applyBalance: both a pick's response and the /picks page's own read carry an
// authoritative balance, so the chip never needs a re-fetch of its own.
//
// Primarily the balance. The wallet's other half — lifetimeEarned, the score —
// rides along because the one read this provider already makes
// (GET /predictions/my-picks) returns it in the same body: exposing it costs
// nothing and spares the feed's points hero a fourth copy of this exact fetch.
// It moves when a question RESOLVES (courtside, never through this client) AND
// on every engagement earn (a check-in, an article read), so like the balance
// it's refreshed by whatever authoritative figure the /picks read next hands
// back — not polled. That second mover is why it is "earned", not "won"; see
// the note on the field below.
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
  // The public score (lifetime points EARNED), loaded alongside the balance.
  // null on the same terms — not yet loaded / load failed.
  //
  // "EARNED", NOT "WON": this is fan_points.lifetime_earned, which is raised by
  // every positive earn — engagement verbs (daily_checkin, national_pick, ...)
  // as well as real winnings. Anything rendering it must say "earned"; the feed
  // hero says "pts earned all-time" for exactly this reason. See the header of
  // app/leaderboard/page.tsx.
  //
  // Only ever set by the provider's own read: unlike the balance, no pick
  // response carries it, so applyBalance leaves it untouched. Note that it CAN
  // move without this provider noticing — an engagement earn raises it
  // server-side — so treat it as last-loaded, not live. Refreshed on the next
  // full load (login re-run).
  lifetimeEarned: number | null;
  // Set the balance from an authoritative figure (a pick response, or /picks'
  // own full read).
  applyBalance: (balance: number) => void;
}

const PointsContext = createContext<PointsState | undefined>(undefined);

export function PointsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [lifetimeEarned, setLifetimeEarned] = useState<number | null>(null);

  // Load once per token (login / logout re-runs it).
  useEffect(() => {
    if (!token) {
      setBalance(null);
      setLifetimeEarned(null);
      return;
    }
    let cancelled = false;
    getMyPicks(token)
      .then((report) => {
        if (!cancelled) {
          setBalance(report.balance);
          setLifetimeEarned(report.lifetimeEarned);
        }
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
    () => ({ balance, lifetimeEarned, applyBalance }),
    [balance, lifetimeEarned, applyBalance],
  );

  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>;
}

export function usePoints(): PointsState {
  const ctx = useContext(PointsContext);
  if (!ctx) throw new Error('usePoints must be used within <PointsProvider>');
  return ctx;
}
