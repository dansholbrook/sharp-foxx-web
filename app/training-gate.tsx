'use client';

import { useEffect, useState } from 'react';
import { AppNav } from './nav';
import { useAuth } from './auth-context';
import { getFieldReps, FieldRep } from './api';

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
  const { user } = useAuth();

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
        <a
          className="btn-inline training-gate__cta"
          href="https://danielh901.sg-host.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Start training →
        </a>
        <p className="training-gate__note muted">
          Once you finish, your Regional Manager will activate your account.
        </p>
      </section>
    </main>
  );
}
