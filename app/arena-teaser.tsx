'use client';

// ============================================================================
// THE ARENA TEASER — the feed's daily-habit hook, now that the Arena has more
// than one game in it.
//
// ONE CARD, NOT ONE PER GAME. The rail is a column of bands and the Arena is
// going to keep adding games; a band per game would push the points hero off the
// first screen by the third one, and would ask the fan to triage. So the teaser
// picks ONE thing to say and says it well.
//
// THE PRIORITY IS URGENCY, NOT ORDER OF RELEASE:
//   1. An UNPLAYED, still-open daily. This is the only state that expires, so it
//      always wins. The Oracle leads among equals because it is the older habit
//      and its hook (a team and a confidence) is the stronger single line.
//   2. Failing that, the most recent thing that HAPPENED — a win, then any other
//      settled result, then a call still riding. A fan who won at 11pm and opens
//      the feed at 11:30 should be told, not shown an empty slot.
//   3. Nothing true to say → no card. Not a skeleton, not "the Arena rests".
//
// IT DOES NOT HIDE ONCE PLAYED, and that is the point. The obvious build shows
// the prompt and disappears when the fan taps, which optimises for today's tap
// and throws away tomorrow's. "You're fading · locks 7:10" is a standing
// reminder that something of theirs is riding tonight.
//
// IT LINKS TO /arena, NEVER STRAIGHT TO THE GAME. The hub is the door, and
// sending a fan past it would hide the game they haven't found yet — which is
// the whole reason the hub exists.
//
// SELF-FETCHING, best-effort, no polling — same contract as the feed's other
// bands (ContestsBand, OpenGamesBand). Both today-endpoints fire together and
// either may fail; the teaser renders on whichever came back. The countdown
// ticks locally off the already-fetched locksAt rather than re-reading.
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  arenaLockCountdown,
  getOracleToday,
  getTrailToday,
  points,
  trailSideTeam,
  OracleToday,
  TrailToday,
} from './api';

// What the card ends up saying: which game, the headline line, and an optional
// trailing clause (the countdown, or the lock time for a call already made).
//
// `tone` doubles as the PRIORITY KEY — 'open' is the expiring state and wins
// outright, 'win' is the best of the settled ones. Keeping the ladder keyed off
// one field means the cycle below is a chain of ?? rather than a decision tree
// with two games' worth of branches in it.
type Teaser = {
  kicker: string;
  mark: string;
  tone: 'open' | 'riding' | 'win' | 'quiet';
  lead: React.ReactNode;
  tail: string | null;
};

// "7:10" — the lock, in the fan's own zone.
function lockClock(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function oracleTeaser(today: OracleToday | null, now: number): Teaser | null {
  const day = today?.day ?? null;
  if (!day) return null;
  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';

  // OPEN and uncalled — the only state with an expiry on it.
  if (!graded && !mine && !day.locked) {
    return {
      kicker: "Today's Oracle",
      mark: '🔮',
      tone: 'open',
      lead: (
        <>
          <strong>{day.oracle.team ?? day.matchup}</strong> ·{' '}
          {day.oracle.confidence}% — ride or fade?
        </>
      ),
      tail: arenaLockCountdown(day.locksAt, now),
    };
  }

  if (graded && mine) {
    return {
      kicker: "Today's Oracle",
      mark: '🔮',
      tone: mine.outcome === 'win' ? 'win' : 'quiet',
      lead:
        mine.outcome === 'win' && mine.pointsAwarded !== null ? (
          <>
            <strong>+{points(mine.pointsAwarded)}</strong> ·{' '}
            {mine.choice === 'fade' ? 'you beat the Oracle' : 'you rode it home'}
          </>
        ) : mine.outcome === 'void' ? (
          <>Pushed — streaks safe</>
        ) : (
          <>Settled — see how it went</>
        ),
      tail: null,
    };
  }

  if (mine) {
    return {
      kicker: "Today's Oracle",
      mark: '🔮',
      tone: 'riding',
      lead: <>You&apos;re {mine.choice === 'fade' ? 'fading' : 'riding'}</>,
      tail: day.locked ? null : `locks ${lockClock(day.locksAt)}`,
    };
  }

  // Locked and never called. Nothing expiring, nothing riding, nothing settled
  // — there is no line here that isn't a reproach, so the game sits it out.
  return null;
}

function trailTeaser(today: TrailToday | null, now: number): Teaser | null {
  const day = today?.day ?? null;
  // A rest stop is a real state but not a card: nothing to do, nothing
  // expiring, nothing at risk. The rail is for things that want the fan.
  if (!day || day.restStop) return null;
  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';

  if (!graded && !mine && !day.locked) {
    return {
      kicker: 'The Foxx Trail',
      mark: '🚌',
      tone: 'open',
      lead: (
        <>
          The bus is in <strong>{day.town.name}</strong> — pick today&apos;s game
        </>
      ),
      tail: day.locksAt ? arenaLockCountdown(day.locksAt, now) : null,
    };
  }

  if (graded && mine) {
    return {
      kicker: 'The Foxx Trail',
      mark: '🚌',
      tone: mine.outcome === 'win' ? 'win' : 'quiet',
      lead:
        mine.outcome === 'win' ? (
          <>
            {mine.pointsAwarded !== null && (
              <strong>+{points(mine.pointsAwarded)} · </strong>
            )}
            pennant claimed: {day.town.name} 🏁
          </>
        ) : mine.outcome === 'void' ? (
          <>Rest stop — streaks safe</>
        ) : (
          <>The bus waits in {day.town.name}</>
        ),
      tail: null,
    };
  }

  if (mine) {
    return {
      kicker: 'The Foxx Trail',
      mark: '🚌',
      tone: 'riding',
      lead: (
        <>
          You&apos;re riding <strong>{trailSideTeam(day, mine.side)}</strong>
        </>
      ),
      tail: day.locked || !day.locksAt ? null : `locks ${lockClock(day.locksAt)}`,
    };
  }

  return null;
}

export function ArenaTeaser({ token }: { token: string }) {
  const [oracle, setOracle] = useState<OracleToday | null>(null);
  const [trail, setTrail] = useState<TrailToday | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    // Fired together, settled independently: a dead Trail must not cost the fan
    // their Oracle hook, and vice versa.
    getOracleToday(token)
      .then((next) => {
        if (!cancelled) setOracle(next);
      })
      .catch(() => {
        /* best-effort, same as the bands beside it */
      });
    getTrailToday(token)
      .then((next) => {
        if (!cancelled) setTrail(next);
      })
      .catch(() => {
        /* best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ---- THE CYCLE. Expiring first, then what actually happened.
  const oracleCard = oracleTeaser(oracle, now);
  const trailCard = trailTeaser(trail, now);
  const teaser =
    (oracleCard?.tone === 'open' ? oracleCard : null) ??
    (trailCard?.tone === 'open' ? trailCard : null) ??
    (oracleCard?.tone === 'win' ? oracleCard : null) ??
    (trailCard?.tone === 'win' ? trailCard : null) ??
    oracleCard ??
    trailCard;

  // The ticker runs at a MINUTE, not a second: this card shows a coarse
  // countdown, and a per-second timer on a band the fan is scrolling past would
  // be a render a second for no visible change. Only while something is open.
  const ticking = teaser?.tone === 'open';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [ticking]);

  // Nothing true to say — no slot, no skeleton.
  if (!teaser) return null;

  return (
    <section className="row arena-teaser">
      <div className="arena-teaser__head">
        <h2 className="row-title">
          <span className="arena-teaser__mark" aria-hidden="true">
            🦊{teaser.mark}
          </span>
          {teaser.kicker}
        </h2>
      </div>

      <Link href="/arena" className="arena-teaser__card">
        <span className="arena-teaser__lead">{teaser.lead}</span>

        <span
          className={`arena-teaser__state arena-teaser__state--${teaser.tone}`}
        >
          {teaser.tone === 'open'
            ? 'Free · once a day'
            : teaser.tone === 'riding'
              ? 'Locked in'
              : 'Settled'}
          {teaser.tail && (
            <span className="arena-teaser__when">
              {' · '}
              {teaser.tail}
            </span>
          )}
        </span>
      </Link>
    </section>
  );
}
