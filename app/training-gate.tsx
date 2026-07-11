'use client';

import { useEffect, useState } from 'react';
import { AppNav } from './nav';
import { useAuth } from './auth-context';
import { getFieldReps, getLtiLaunchTicket, FieldRep } from './api';

// The plain Academy (Moodle) home, used as the graceful fallback when a one-time
// LTI launch ticket can't be minted (403/500/network) -- training must never be
// unreachable, the rep may just have to sign in by hand.
const MOODLE_URL = 'https://danielh901.sg-host.com';

// Resolve the CALLER's own field_reps row by matching the signed-in user id
// against the roster from GET /field-reps (reps AND managers have one). Returns:
//   checking === true  -> the lookup hasn't resolved yet
//   ownRep === null    -> resolved, but the caller has no rep profile
//   ownRep === a row   -> the caller's rep row (read .status for the gate)
// Best-effort: a failed/forbidden lookup resolves to null so the caller is NOT
// gated (a page's own guards still apply). Skipped entirely when `enabled` is
// false (no token / role can't open the page).
export function useOwnRep(
  token: string | null,
  userId: string | undefined,
  enabled: boolean,
): { ownRep: FieldRep | null; checking: boolean } {
  const [ownRep, setOwnRep] = useState<FieldRep | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token || !enabled || !userId) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const reps = await getFieldReps(token);
        if (!cancelled) setOwnRep(reps.find((r) => r.userId === userId) ?? null);
      } catch {
        // A forbidden/failed lookup must not gate the page -- leave ownRep null.
        if (!cancelled) setOwnRep(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, userId, enabled]);

  return { ownRep, checking };
}

// The branded holding card shown INSTEAD of the schedule/workspace while a
// newly-approved rep's field_reps.status is 'onboarding'. Reuses the feed-home
// shell + masthead so it reads like the rest of the app; the gold CTA opens the
// external Academy in a new tab. Rendered by My Games and the game workspace.
export function TrainingGate() {
  const { user, token } = useAuth();
  const [launching, setLaunching] = useState(false);
  // Shown when we fell back to the plain Moodle URL (no auto sign-in).
  const [fellBack, setFellBack] = useState(false);

  // Start training via the LTI launch flow. Popup blockers only allow a new tab
  // opened synchronously in the click handler, so open a BLANK tab first, then
  // point it at the one-time launch URL once the ticket resolves. If the ticket
  // can't be minted (403/500/network) fall back to the plain Moodle URL in the
  // same tab so training is never unreachable.
  const startTraining = async () => {
    const tab = window.open('about:blank', '_blank', 'noopener,noreferrer');
    setFellBack(false);
    setLaunching(true);
    try {
      if (!token) throw new Error('no token');
      const { url } = await getLtiLaunchTicket(token);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // Auto sign-in unavailable -- send them to the plain Academy home instead.
      setFellBack(true);
      if (tab) tab.location.href = MOODLE_URL;
      else window.open(MOODLE_URL, '_blank', 'noopener,noreferrer');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <main className="feed-home">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <div className="masthead">
        <span className="masthead-kicker">Onboarding</span>
        <h1 className="masthead-title">Welcome to Sharp Foxx Academy</h1>
        <p className="masthead-standfirst">
          Complete your correspondent training to unlock your games portal.
        </p>
      </div>

      <section className="card game training-gate">
        <span className="game-kicker">Your first step</span>
        <p className="training-gate__copy">
          Complete your correspondent training to unlock your games portal.
        </p>
        <button
          type="button"
          className="btn-inline training-gate__cta"
          onClick={startTraining}
          disabled={launching}
        >
          {launching ? 'Starting…' : 'Start training →'}
        </button>
        {fellBack && (
          <p className="training-gate__note muted">
            Automatic sign-in unavailable — logging in manually may be required.
          </p>
        )}
        <p className="training-gate__note muted">
          Once you finish, your Regional Manager will activate your account.
        </p>
      </section>
    </main>
  );
}
