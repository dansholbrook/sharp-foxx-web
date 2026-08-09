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
//   0. An UNPLAYED Call inside its last day. The only WEEKLY thing in the Arena,
//      so missing it costs one of 52 rather than one of 365 — but only once the
//      window is genuinely closing. See the 'urgent' note below.
//   1. An UNPLAYED, still-open daily. This is the only state that expires, so it
//      always wins. The Oracle leads among equals because it is the older habit
//      and its hook (a team and a confidence) is the stronger single line. An
//      open Call ranks BELOW both of them the rest of the week: its window is
//      two days wide, so it is the one that can most afford to wait.
//   2. Failing that, the most recent thing that HAPPENED — a win, then any other
//      settled result, then a call still riding. A fan who won at 11pm and opens
//      the feed at 11:30 should be told, not shown an empty slot.
//   3. Nothing true to say → no card. Not a skeleton, not "the Arena rests".
//
// THE 'urgent' TONE IS THE ONE NEW PRIORITY RULE, and it is deliberately a TONE
// rather than a branch: the ladder below stays a chain of ?? keyed off a single
// field, which is the whole reason it reads as a ladder and not a decision tree
// with three games in it.
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
  callPhase,
  getCallCurrent,
  getOracleToday,
  getTrailToday,
  points,
  trailSideTeam,
  etTime,
  CallCurrent,
  OracleToday,
  TrailToday,
} from './api';

// How close to kickoff an unfiled Call has to be before it outranks the two
// dailies. A day: inside it, the Call is the thing in the Arena most likely to
// be missed entirely; outside it, the dailies expire first and should lead.
const CALL_URGENT_MS = 24 * 60 * 60 * 1000;

// What the card ends up saying: which game, the headline line, and an optional
// trailing clause (the countdown, or the lock time for a call already made).
//
// `tone` doubles as the PRIORITY KEY — 'urgent' and 'open' are the expiring
// states and win outright, 'win' is the best of the settled ones. Keeping the
// ladder keyed off one field means the cycle below is a chain of ?? rather than
// a decision tree with three games' worth of branches in it.
//
// `note` is the small line under the lead, and it is stated by each BUILDER
// rather than derived from the tone: "Free · once a day" is true of the two
// dailies and false of the Call, and a tone-keyed switch would have had to grow
// a game check anyway.
type Teaser = {
  kicker: string;
  mark: string;
  tone: 'urgent' | 'open' | 'riding' | 'win' | 'quiet';
  lead: React.ReactNode;
  note: string;
  tail: string | null;
};

// "7:10 PM ET" — the lock. Labelled, because it's a deadline a fan acts on.
function lockClock(iso: string | null): string {
  return etTime(iso, { zone: true });
}

function oracleTeaser(today: OracleToday | null, now: number): Teaser | null {
  const day = today?.day ?? null;
  if (!day) return null;
  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';
  // Has this fan ever played the Oracle? lastPlayedDate is null until their
  // first pick, which is the one durable "never" this payload carries — the
  // streak counters are both zero again after a reset, so neither is a test for
  // it. Used ONLY to name the thing on the first-timer's card; see below.
  const neverPlayed = today?.streaks.lastPlayedDate === null;

  // OPEN and uncalled — the only state with an expiry on it.
  if (!graded && !mine && !day.locked) {
    return {
      kicker: "Today's Oracle",
      mark: '🔮',
      tone: 'open',
      note: 'Free · once a day',
      // THE FIRST-TIMER'S LEAD NAMES THE ACTOR, and this is the smallest fix to
      // a real problem: on a phone this card is the FIRST thing under the
      // masthead on the feed (see the mobile `order` block in globals.css), so
      // for a fan who signed up ten minutes ago "Milwaukee · 72% — ride or
      // fade?" is a question whose subject has never been introduced. Naming
      // the Oracle costs four words and answers "who likes Milwaukee?".
      //
      // It retires itself after the fan's first pick, permanently — a returning
      // fan gets the tighter line, which is the better one once you know what
      // it's about.
      lead: neverPlayed ? (
        <>
          The Oracle likes <strong>{day.oracle.team ?? day.matchup}</strong> at{' '}
          {day.oracle.confidence}% — ride with it or fade it?
        </>
      ) : (
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
      note: 'Settled',
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
      note: 'Locked in',
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
      note: 'Free · once a day',
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
      note: 'Settled',
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
      note: 'Locked in',
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

// THE CALL. Three differences from the two above, all of them consequences of
// it being weekly and human-graded:
//
//   * IT ONLY PRODUCES A SETTLED LINE WHEN THERE WAS MONEY IN IT — a share of
//     the pot or the Golden Whistle. Out of the money it sits the rail out, and
//     here the Call genuinely diverges from the Oracle rather than copying it:
//     the Oracle's consolation line survives as a last-resort fallback because
//     there is another pick TOMORROW for it to hand the fan toward. The next
//     Call is Thursday. A consolation line with no adjacent action is the rail's
//     one slot spent on a feeling.
//   * ITS OPEN STATE CAN BE 'urgent'. See CALL_URGENT_MS.
//   * "Free · once a WEEK", and the filed state advertises that the card is
//     still editable — the one thing about this game that isn't true of the
//     other two, and the reason to tap a card the fan has already played.
//
// THE FAN'S OWN NUMBER, NEVER THE POT'S TOTAL. The card keeps the receipt and
// the purse five rows apart so they cannot be subtracted; there is no room to do
// that in a one-line teaser, so only one of the two is ever allowed in it.
function callTeaser(current: CallCurrent | null, now: number): Teaser | null {
  const call = current?.call ?? null;
  if (!call) return null;
  const phase = callPhase(call);

  // A void has no reproach in it and no news either: nothing was scored, and the
  // participation the wash paid is a line for the card, not for the rail.
  if (phase === 'voided') return null;

  if (phase === 'graded') {
    const mine = current?.myEntry ?? null;
    if (!mine || mine.outcome !== 'graded') return null;
    // Gold is for beating the room. Filing always pays, so "was I paid" would
    // put every graded week in the rail.
    if (mine.whistle !== true && mine.band == null) return null;
    const paid = mine.pointsAwarded ?? 0;
    return {
      kicker: "The Correspondent's Call",
      mark: '📻',
      tone: 'win',
      note: 'Graded from the stands',
      lead: mine.whistle ? (
        <>
          The Golden Whistle — <strong>+{points(paid)}</strong> pts
        </>
      ) : (
        <>
          Your card took a share of the pot — <strong>+{points(paid)}</strong>{' '}
          pts
        </>
      ),
      tail: null,
    };
  }

  const filed = current?.myEntry != null;

  if (phase === 'locked') {
    // Locked with a card in: worth a standing reminder, exactly like the
    // Oracle's "you're fading". Locked with nothing in: no line here that isn't
    // a reproach, so the game sits it out.
    if (!filed) return null;
    return {
      kicker: "The Correspondent's Call",
      mark: '📻',
      tone: 'riding',
      note: 'Locked in',
      lead: <>Your card is in the correspondent&apos;s hands</>,
      tail: null,
    };
  }

  // OPEN + already filed. Still a card, because the revisability is news.
  if (filed) {
    return {
      kicker: "The Correspondent's Call",
      mark: '📻',
      tone: 'riding',
      note: 'Filed · editable until kickoff',
      lead: <>Your card is in — change it any time before kickoff</>,
      tail: call.locksAt ? `locks ${lockClock(call.locksAt)}` : null,
    };
  }

  // OPEN + nothing filed. The expiring state, and the only one that can jump
  // the two dailies.
  const msLeft = call.locksAt ? new Date(call.locksAt).getTime() - now : NaN;
  const urgent = Number.isFinite(msLeft) && msLeft > 0 && msLeft <= CALL_URGENT_MS;
  return {
    kicker: "The Correspondent's Call",
    mark: '📻',
    tone: urgent ? 'urgent' : 'open',
    note: urgent ? 'Closes today · free' : 'Free · once a week',
    lead: (
      <>
        {call.questions.length} questions on{' '}
        <strong>{call.event.matchup}</strong> ·{' '}
        {points(call.pot.points)} pts in the pot
      </>
    ),
    tail: call.locksAt ? arenaLockCountdown(call.locksAt, now) : null,
  };
}

export function ArenaTeaser({ token }: { token: string }) {
  const [oracle, setOracle] = useState<OracleToday | null>(null);
  const [trail, setTrail] = useState<TrailToday | null>(null);
  const [call, setCall] = useState<CallCurrent | null>(null);
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
    getCallCurrent(token)
      .then((next) => {
        if (!cancelled) setCall(next);
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
  const callCard = callTeaser(call, now);
  const teaser =
    (callCard?.tone === 'urgent' ? callCard : null) ??
    (oracleCard?.tone === 'open' ? oracleCard : null) ??
    (trailCard?.tone === 'open' ? trailCard : null) ??
    (callCard?.tone === 'open' ? callCard : null) ??
    // A weekly pot share is the rarest and largest thing the Arena pays, so it
    // leads the settled half — but it still ranks BELOW every open state, which
    // is the rail's whole principle: what expires first, then what happened.
    (callCard?.tone === 'win' ? callCard : null) ??
    (oracleCard?.tone === 'win' ? oracleCard : null) ??
    (trailCard?.tone === 'win' ? trailCard : null) ??
    oracleCard ??
    trailCard ??
    callCard;

  // The ticker runs at a MINUTE, not a second: this card shows a coarse
  // countdown, and a per-second timer on a band the fan is scrolling past would
  // be a render a second for no visible change. Only while something is open.
  const ticking = teaser?.tone === 'open' || teaser?.tone === 'urgent';
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
          {teaser.note}
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
