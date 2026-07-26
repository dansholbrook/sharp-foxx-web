'use client';

// ============================================================================
// /arena/call — THE CORRESPONDENT'S CALL. The third address in the Arena, and
// the only weekly one: one covered local game, a five-question card filed by
// Thursday, answers locked at kickoff, graded from the stands.
//
// ONE READ, AND IT IS THE WHOLE SURFACE. The Oracle page makes three reads and
// the Trail four, because both have history, boards and (for the Trail) a map to
// hang beside the game. This game HAS no other fan routes: no leaderboard, no
// history, and no answer distribution — the last of those is a deliberate
// refusal rather than a gap (see the api.ts header). So there is nothing here to
// fail independently of the card, and no section that could self-hide. One
// gating read, one error box.
//
// ----------------------------------------------------------------------------
// NO POLLING — the one place this surface diverges from its two siblings, and it
// is a divergence with a reason rather than an omission.
//
//   Both daily games poll at 30s BECAUSE THE SPLIT MOVES: the crowd picking is
//   the only live thing on those cards and it is the thing worth watching. This
//   card publishes no split and never will pre-lock. The only figure that moves
//   while it is open is the pot's entrant count, over a window measured in DAYS.
//
//   And there is a cost the daily games do not have: a poll landing mid-answer
//   would replace `current` under a draft that lives only in React state, with
//   no partial save anywhere to recover it from. Re-reading every 30 seconds to
//   watch a number tick up, at the risk of the fan's unsent work, is a bad trade.
//
//   So: one read on mount, myEntry folded from the submit response, and ONE
//   re-read at the moment the countdown crosses the lock — without it the card
//   would sit there with a live submit button over a game that has started.
// ----------------------------------------------------------------------------
//
// NO EARN TOAST, for the same reason the Oracle and the Trail fire none: every
// point this game pays — participation, per-correct, the Golden Whistle, the pot
// — is paid at GRADING, in a transaction this client never observes. A toast at
// file time would promise money nobody has decided yet. Nothing here calls
// applyBalance.
//
// NO STREAK CHIP ANYWHERE. `streaks` is null on this endpoint by design (a
// weekly game cannot use the daily gap arithmetic without burning a fan's
// freezes every Monday), so there is no rail, no chip, and no placeholder.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { CallSheet } from './answer-sheet';
import {
  getCallCurrent,
  submitCallEntry,
  CallCurrent,
  CallEntryInput,
  CallEntryResult,
} from '../../api';

export default function CallPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [current, setCurrent] = useState<CallCurrent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CallEntryResult | null>(null);

  // The countdown clock, ticked here rather than inside the card so this surface
  // runs ONE timer — the same timer that has to notice the lock.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!token) return;
    setCurrent(await getCallCurrent(token));
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await getCallCurrent(token);
        if (!cancelled) {
          setCurrent(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to reach the press box',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  // ---- The clock, and the single re-read at the lock.
  //
  // Runs at 1s while the card is open, because the last minute before kickoff is
  // the one that matters and a minute-granularity clock would sit on "Locks in
  // 1m" for sixty seconds — the same reasoning the Oracle's card uses.
  //
  // The crossing fires ONCE, guarded by a ref rather than by state: a re-read
  // that lands slowly must not let a second tick queue a second one, and the
  // guard must survive the re-render the response causes.
  const call = current?.call ?? null;
  const locksAt = call?.locksAt ?? null;
  const ticking = call !== null && !call.locked && call.status === 'published';
  const crossed = useRef(false);
  useEffect(() => {
    crossed.current = false;
  }, [locksAt]);
  useEffect(() => {
    if (!ticking || !locksAt) return;
    const lockMs = new Date(locksAt).getTime();
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!crossed.current && Number.isFinite(lockMs) && t >= lockMs) {
        crossed.current = true;
        // One re-read, so the card flips to its locked reading instead of
        // leaving a live "Lock in my card" button over a game in progress. A
        // failure here leaves what's on screen; the fan's next visit corrects it.
        void load().catch(() => {});
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [ticking, locksAt, load]);

  async function onSubmit(input: CallEntryInput) {
    if (!token || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitCallEntry(token, input);
      setSaved(result);
      // Fold the filed card in without a round trip — the response carries the
      // authoritative entry, and it is the only thing about the read that
      // changed. The pot's entrant count moved too if this was a FIRST card, so
      // nudge it locally rather than re-reading the whole surface for +5.
      setCurrent((prev) =>
        prev
          ? {
              ...prev,
              myEntry: result.myEntry,
              call:
                prev.call && !result.replaced
                  ? {
                      ...prev.call,
                      pot: {
                        ...prev.call.pot,
                        entrants: prev.call.pot.entrants + 1,
                        projectedPoints:
                          prev.call.pot.projectedPoints +
                          prev.call.pot.perEntrantPoints,
                      },
                    }
                  : prev.call,
            }
          : prev,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not file your card';
      setSubmitError(message);
      // A 409 or 404 means the SCREEN IS STALE, not that the fan did something
      // wrong: kickoff passed between the render and the tap, or the card was
      // graded/voided under them. Re-read so the card catches up instead of
      // leaving a live submit button over a closed one.
      //
      // Their previous entry is untouched either way — the whole write is one
      // transaction, so a fan who tries to change their mind at kickoff keeps
      // the card they had.
      if (message.startsWith('409') || message.startsWith('404')) {
        void load().catch(() => {});
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home call-page">
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

      <div className="masthead masthead-head">
        <div>
          <span className="masthead-kicker">The Arena</span>
          <h1 className="masthead-title">The Correspondent&apos;s Call</h1>
          {/* Deliberately says "each week" rather than "this week" — the read
              can hand back last week's card, and the standfirst is the one line
              on the page that has no dateline to correct it. */}
          <p className="masthead-standfirst">
            Each week one local game, and five questions only someone in the
            building can answer. Beat the room and the pot is yours to split.
          </p>
        </div>
        <div className="masthead-actions">
          <Link href="/arena" className="link-btn">
            ← The Arena
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Raising the press box…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && current && (
        <>
          <CallSheet
            weekStart={current.weekStart}
            call={current.call}
            myEntry={current.myEntry}
            payouts={current.payouts}
            now={now}
            onSubmit={onSubmit}
            submitting={submitting}
            submitError={submitError}
            saved={saved}
          />

          <p className="call-fineprint">
            Points only · no cash value · never redeemable. The Call pays when
            the correspondent grades it, not when you file.
          </p>
        </>
      )}
    </main>
  );
}
