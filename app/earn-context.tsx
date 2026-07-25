'use client';

// ============================================================================
// THE EARN MOMENT — one place that reports an engagement action, moves the ⚡
// chip, and says "+25 ⚡" quietly in the corner.
//
// Every hook in the app (check-in, article dwell, game watch, national pick,
// team follow) goes through useEngagementEarn() rather than calling
// earnEngagement() itself, because the interesting part isn't the POST — it's
// what happens to the three possible answers:
//
//   * A REAL EARN   -> push the returned balance at points-context (the chip
//                      updates without a refetch, same idiom as a pick) and
//                      show the toast.
//   * capped        -> SILENCE. The fan hit today's limit. Reading a 6th
//   * skipped          article is not a failure and an admin having turned an
//                      action off is not the fan's business. Nagging about a
//                      limit turns a reward into a scold, so these are
//                      indistinguishable from nothing having happened.
//   * a thrown error -> also silence. An engagement earn is a garnish on
//                      whatever page fired it; it must never surface an error
//                      box on a page the fan came to for something else. (The
//                      401 path inside the client still tears the session down.)
//
// The provider also owns the toast STACK, because two hooks can land within a
// second of each other (a fan who follows a team while a watch timer matures)
// and two independently-positioned toasts would overlap.
//
// POINTS ONLY: a closed-loop score, never money.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from './auth-context';
import { usePoints } from './points-context';
import { earnEngagement, points, formatMultiplier, ClientEarnAction } from './api';

// How long a toast sits before it retires itself.
const TOAST_MS = 3000;
// Never stack more than this many at once — beyond three the corner stops being
// a garnish and starts being a wall. Oldest falls off.
const MAX_TOASTS = 3;

interface EarnToast {
  id: number;
  points: number;
  promotion: { name: string; multiplier: number } | null;
}

interface EarnState {
  // Report an action. Resolves to true only when points actually landed —
  // useful to a caller that wants to chain (nothing does today), harmless to
  // ignore, which is what every hook does. NEVER rejects.
  earn: (actionType: ClientEarnAction) => Promise<boolean>;
}

const EarnContext = createContext<EarnState | undefined>(undefined);

// ---------------------------------------------------------------------------
// DAILY CHECK-IN — fires once on the first authed page load of a tab session.
//
// The BACKEND is the real guard: check-in is enforced once per CALENDAR DAY (ET)
// in the ledger regardless of what daily_cap says, so a fan who reloads all
// afternoon earns exactly once. The sessionStorage flag below is only about
// NOISE — without it every route change that remounts the provider would fire a
// POST the server would answer `capped`.
//
// It is keyed by user AND by local date, and it is sessionStorage rather than
// localStorage, so both ways it can be wrong are the harmless way: a new tab, or
// a session that runs past midnight, fires one redundant no-op call. A flag that
// outlived its day would do the opposite and suppress a REAL check-in, which is
// the fan losing points. The client's local date and the ledger's ET day can
// disagree by a few hours; that disagreement costs exactly one no-op POST.
// ---------------------------------------------------------------------------
function localDay(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function checkinKey(userId: string): string {
  return `sf.checkin.${userId}.${localDay()}`;
}

function alreadyCheckedIn(userId: string): boolean {
  try {
    return sessionStorage.getItem(checkinKey(userId)) === '1';
  } catch {
    // Private mode / storage disabled: fall through and let the server dedupe.
    return false;
  }
}

function markCheckedIn(userId: string): void {
  try {
    sessionStorage.setItem(checkinKey(userId), '1');
  } catch {
    /* nothing to do — the server is still the guard */
  }
}

export function EarnProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const { applyBalance } = usePoints();
  const [toasts, setToasts] = useState<EarnToast[]>([]);
  // Monotonic toast ids. A counter, not Date.now(), so two toasts fired in the
  // same millisecond can't collide on a React key.
  const nextId = useRef(0);
  // Guards a toast landing after the provider unmounts (a hook can resolve
  // mid-navigation).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const earn = useCallback(
    async (actionType: ClientEarnAction): Promise<boolean> => {
      if (!token) return false;
      try {
        const result = await earnEngagement(token, actionType);
        // Both no-op answers carry a null balance. Silence, as above.
        if (result.capped || result.skipped || result.points === null) return false;
        // The response's balance is the server's own post-write figure — the
        // chip moves from that, no refetch.
        if (result.balance !== null) applyBalance(result.balance);
        if (mounted.current) {
          const id = nextId.current++;
          setToasts((prev) =>
            [...prev, { id, points: result.points as number, promotion: result.promotion }].slice(
              -MAX_TOASTS,
            ),
          );
        }
        return true;
      } catch {
        // An earn never breaks the page it fired from.
        return false;
      }
    },
    [token, applyBalance],
  );

  // The check-in. Fires as soon as a token exists, wherever the fan happens to
  // have landed — the provider wraps the whole app, so "first authed page load"
  // needs no cooperation from any individual page.
  useEffect(() => {
    if (!token || !user?.id) return;
    if (alreadyCheckedIn(user.id)) return;
    // Marked BEFORE the call, not after: React 18 StrictMode double-invokes
    // effects in dev, and two in-flight check-ins would both toast (the second
    // would come back capped, but the first would already have shown). The flag
    // is only a noise filter, so claiming it optimistically is the right shape.
    markCheckedIn(user.id);
    void earn('daily_checkin');
  }, [token, user?.id, earn]);

  const value = useMemo<EarnState>(() => ({ earn }), [earn]);

  return (
    <EarnContext.Provider value={value}>
      {children}
      <EarnToasts toasts={toasts} onDismiss={dismiss} />
    </EarnContext.Provider>
  );
}

// The hook every earn surface uses. Returns the reporter, nothing else — a
// caller that needs to know what an action is WORTH reads the earn menu
// (ways-to-earn.tsx); this is only for firing one.
export function useEngagementEarn(): (actionType: ClientEarnAction) => Promise<boolean> {
  const ctx = useContext(EarnContext);
  if (!ctx) throw new Error('useEngagementEarn must be used within <EarnProvider>');
  return ctx.earn;
}

// ---------------------------------------------------------------------------
// THE TOAST STRIP. Bottom-right on desktop, bottom-center on mobile (see the
// .earntoast-* block in globals.css). aria-live="polite" on the CONTAINER, which
// is why it renders even when empty: a live region has to exist before its
// contents change for a screen reader to announce the change.
// ---------------------------------------------------------------------------
function EarnToasts({
  toasts,
  onDismiss,
}: {
  toasts: EarnToast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="earntoast-strip" role="status" aria-live="polite">
      {toasts.map((t) => (
        <EarnToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function EarnToastCard({
  toast,
  onDismiss,
}: {
  toast: EarnToast;
  onDismiss: (id: number) => void;
}) {
  // Each toast owns its own retirement timer, so a second one arriving late
  // doesn't reset (or inherit) the first one's clock.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="earntoast">
      <span className="earntoast__amount">
        +{points(toast.points)}
        <span className="earntoast__bolt" aria-hidden="true">
          ⚡
        </span>
      </span>
      {/* The promotion is the whole reason the number is bigger than usual —
          naming it is what turns a boosted earn into a promotion the fan
          noticed, rather than an unexplained larger number. */}
      {toast.promotion && (
        <span className="earntoast__promo">
          {formatMultiplier(toast.promotion.multiplier)}x: {toast.promotion.name}
        </span>
      )}
    </div>
  );
}
