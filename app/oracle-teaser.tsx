'use client';

// ============================================================================
// THE ORACLE TEASER — the feed's daily-habit hook.
//
// One rail card, one job: get the fan to /oracle before they've decided to go
// there. It is the only band on the feed that is time-sensitive by design — a
// call that expires at kickoff — so it leads the rail.
//
// IT DOES NOT HIDE ONCE PICKED, and that is the whole point. The obvious build
// is "show the prompt, disappear when they've played", which optimises for the
// tap and throws away the reason the fan opens the app tomorrow. A picked card
// showing "You're fading · locks 7:10" is a standing reminder that something of
// theirs is riding tonight. It hides only when there is nothing true to say:
// no day scheduled, or the read failed.
//
// A GRADED day also stays up, showing what it paid — the fan who wins at 11pm
// and opens the feed at 11:30 should be told, not shown an empty slot.
//
// SELF-FETCHING, best-effort, no polling. Same contract as the feed's other
// bands (ContestsBand, OpenGamesBand): one read on mount, a failure renders
// nothing. The countdown ticks locally off the already-fetched locksAt rather
// than re-reading, so the card stays honest for the life of the page without
// costing a request.
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getOracleToday,
  oracleLockCountdown,
  points,
  OracleToday,
} from './api';

export function OracleTeaser({ token }: { token: string }) {
  const [today, setToday] = useState<OracleToday | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    getOracleToday(token)
      .then((next) => {
        if (!cancelled) setToday(next);
      })
      .catch(() => {
        // Best-effort, same as the bands beside it: a failed read renders
        // nothing rather than an error in the rail.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const day = today?.day ?? null;
  // The ticker runs at a MINUTE, not a second: this card shows "locks 7:10" and
  // a coarse countdown, and a per-second timer on a page the fan is scrolling
  // past would be a wasted render every second for no visible change.
  const ticking = day !== null && !day.locked && day.status === 'open';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [ticking]);

  // Nothing scheduled (or nothing loaded) — no slot, no skeleton. The Oracle
  // resting is a real state, but it is not a state worth a card on the feed.
  if (!day) return null;

  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';

  return (
    <section className="row oracle-teaser">
      <div className="oracle-teaser__head">
        <h2 className="row-title">
          <span className="oracle-teaser__mark" aria-hidden="true">
            🦊🔮
          </span>
          Today&apos;s Oracle
        </h2>
      </div>

      <Link href="/oracle" className="oracle-teaser__card">
        <span className="oracle-teaser__call">
          <strong className="oracle-teaser__team">
            {day.oracle.team ?? day.matchup}
          </strong>
          <span className="oracle-teaser__conf">
            {day.oracle.confidence}% confident
          </span>
        </span>

        {/* THREE readings, in the order they stop being true: settled, called,
            open. Each one is the most useful thing the card can say at that
            moment — and only the last is a question. */}
        {graded ? (
          <span
            className={`oracle-teaser__state oracle-teaser__state--${
              mine ? mine.outcome : 'none'
            }`}
          >
            {mine
              ? mine.outcome === 'win' && mine.pointsAwarded !== null
                ? `+${points(mine.pointsAwarded)} · you won`
                : mine.outcome === 'void'
                  ? 'Pushed — streaks safe'
                  : mine.outcome === 'loss'
                    ? 'Settled — see how it went'
                    : 'Settled'
              : 'Settled — you sat this one out'}
          </span>
        ) : mine ? (
          <span
            className={`oracle-teaser__state oracle-teaser__state--${mine.choice}`}
          >
            {mine.choice === 'fade' ? "You're fading" : "You're riding"}
            {!day.locked && (
              <span className="oracle-teaser__when">
                {' · locks '}
                {new Date(day.locksAt).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
          </span>
        ) : (
          <span className="oracle-teaser__state oracle-teaser__state--open">
            Ride or fade?
            <span className="oracle-teaser__when">
              {' · '}
              {oracleLockCountdown(day.locksAt, now)}
            </span>
          </span>
        )}
      </Link>
    </section>
  );
}
