'use client';

// ============================================================================
// THE TODAY CARD — the whole of Beat the Oracle on one screen.
//
// FIVE STATES, one component, because they are the same card at five moments of
// its life and splitting them would duplicate the matchup, the dial and the
// split three times over:
//
//   NO DAY   — day === null. "The Oracle rests." The streak rail still renders
//              (that lives on the page, not here) because the streak is why the
//              fan opened the app.
//   OPEN     — the two big buttons, live split, countdown to kickoff.
//   PICKED   — same card, buttons collapsed into the chosen state.
//   LOCKED   — kickoff passed. The pick freezes, live score appears if the
//              event carries one.
//   GRADED   — the reveal: result side, final score, what it paid.
//
// WHAT THE CARD NEVER DOES: derive "graded" or "won" from parts. The backend
// hands down myPick.outcome as one of pending/win/loss/void and the day's own
// status; both are read, neither is reconstructed. See api.ts's Oracle header.
//
// THE PAYOUTS LIVE ON THE BUTTONS. Not in a legend, not in a tooltip: RIDE +10
// and FADE +24 are the entire decision, and the backend pre-computes both at
// today's confidence so the number on the button is the number that lands.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  OracleChoice,
  OracleDay,
  OraclePickResult,
  oracleChoiceLabel,
  oracleLockCountdown,
  oracleOutcomeCopy,
  points,
  streakOutcomeCopy,
} from '../../api';

// The dial and the split bar both animate; both stop dead under reduced motion
// (see globals.css). Nothing here branches on the preference — the CSS owns it,
// so there is one place to look and no chance of the two disagreeing.

// ---------------------------------------------------------------------------
// The confidence dial. A conic-gradient ring, not an SVG arc: one element, one
// custom property, and the value is legible in the DOM as a number rather than
// as a stroke-dasharray nobody can read.
//
// The ring is drawn to `--pct` of a full turn and the centre is punched out by
// a radial mask, so the gold is a genuine arc rather than a pie slice.
// ---------------------------------------------------------------------------
function ConfidenceDial({ confidence }: { confidence: number }) {
  return (
    <div
      className="oracle-dial"
      style={{ ['--pct' as string]: String(confidence) }}
      role="img"
      aria-label={`The Oracle is ${confidence}% confident`}
    >
      <div className="oracle-dial__ring" aria-hidden="true" />
      <div className="oracle-dial__hub" aria-hidden="true">
        <span className="oracle-dial__pct">{confidence}</span>
        <span className="oracle-dial__unit">%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The live split. Proportional, and it renders even at zero picks — an empty
// bar that says "nobody has called it yet" is the honest first state, and it is
// also the most inviting one.
//
// The bar is the crowd, not the fan: it shows what everyone did, so a lone fade
// against 83% riding FEELS like the brave call it is. That pressure is the
// feature, which is why it polls while the day is open.
// ---------------------------------------------------------------------------
function SplitBar({ split }: { split: OracleDay['split'] }) {
  const total = split.total;
  // Guard the divide, and give a one-sided split a floor so the minority sliver
  // is still visible rather than a hairline nobody can see.
  const ridePct = total > 0 ? (split.ride / total) * 100 : 50;

  return (
    <div className="oracle-split">
      <div className="oracle-split__labels">
        <span className="oracle-split__label oracle-split__label--ride">
          <strong>{points(split.ride)}</strong> riding
        </span>
        <span className="oracle-split__label oracle-split__label--fade">
          <strong>{points(split.fade)}</strong> fading
        </span>
      </div>
      <div
        className={`oracle-split__bar${total === 0 ? ' oracle-split__bar--empty' : ''}`}
        role="img"
        aria-label={
          total === 0
            ? 'Nobody has made a call yet'
            : `${split.ride} riding, ${split.fade} fading`
        }
      >
        <div
          className="oracle-split__fill"
          style={{ ['--ride-pct' as string]: `${ridePct}%` }}
        />
      </div>
      {total === 0 && (
        <p className="oracle-split__none">
          Nobody has called it yet. Be the first.
        </p>
      )}
    </div>
  );
}

// The final (or live) score line. Only rendered when the event actually carries
// both numbers — a scheduled game with nulls shows nothing rather than "0–0",
// which would read as a scoreless tie in progress.
function ScoreLine({ day, live }: { day: OracleDay; live: boolean }) {
  const { homeScore, awayScore } = day.event;
  if (homeScore === null || awayScore === null) return null;
  return (
    <div className={`oracle-score${live ? ' oracle-score--live' : ''}`}>
      {live && <span className="oracle-score__live">Live</span>}
      <span className="oracle-score__side">
        <span className="oracle-score__team">{day.awayTeam ?? 'Away'}</span>
        <span className="oracle-score__num">{awayScore}</span>
      </span>
      <span className="oracle-score__at">at</span>
      <span className="oracle-score__side">
        <span className="oracle-score__team">{day.homeTeam ?? 'Home'}</span>
        <span className="oracle-score__num">{homeScore}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE CARD
// ---------------------------------------------------------------------------
export function TodayCard({
  day,
  date,
  // The just-landed pick response, held by the page so the celebration survives
  // the poll that follows it. null until the fan picks in THIS session — a fan
  // returning to a day they already called sees the locked-in state with no
  // celebration, which is right: the moment has passed.
  justPicked,
  onPick,
  picking,
  pickError,
}: {
  day: OracleDay | null;
  date: string;
  justPicked: OraclePickResult | null;
  onPick: (choice: OracleChoice) => void;
  // The choice currently in flight — drives the optimistic selection state, so
  // the button the fan hit looks chosen before the response lands.
  picking: OracleChoice | null;
  pickError: string | null;
}) {
  // The countdown ticker. One second, because the last minute before kickoff is
  // the one that matters and a minute-granularity clock would sit on "Locks in
  // 1m" for sixty seconds. Torn down the moment the day locks.
  const [now, setNow] = useState(() => Date.now());
  const ticking = day !== null && !day.locked && day.status === 'open';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // ---- NO DAY -------------------------------------------------------------
  // Not an error state and not styled like one. The Oracle is a character; a
  // day with no game is that character resting, and the card says so.
  if (!day) {
    return (
      <section className="oracle-card oracle-card--rests">
        <div className="oracle-mark oracle-mark--rests" aria-hidden="true">
          <span className="oracle-mark__fox">🦊</span>
          <span className="oracle-mark__orb">🔮</span>
        </div>
        <p className="oracle-kicker">{friendlyDate(date)}</p>
        <h2 className="oracle-rests__title">The Oracle rests.</h2>
        <p className="oracle-rests__sub">
          No call today. Return tomorrow — your streak is safe until then.
        </p>
      </section>
    );
  }

  const graded = day.status === 'graded' || day.status === 'voided';
  const mine = day.myPick;
  // "Locked" as the card means it: kickoff has passed but the result hasn't
  // landed. A graded day is past locked and gets the reveal instead.
  const locked = day.locked && !graded;
  const canPick = day.status === 'open' && !day.locked && !mine;

  return (
    <section
      className={`oracle-card${graded ? ' oracle-card--graded' : ''}${
        locked ? ' oracle-card--locked' : ''
      }`}
    >
      {/* ---- The Oracle's presence. Composed from two glyphs and a ring of
          CSS rather than an image asset: no build step, no 404, and it scales
          with the type. ---- */}
      <header className="oracle-head">
        <div className="oracle-mark" aria-hidden="true">
          <span className="oracle-mark__fox">🦊</span>
          <span className="oracle-mark__orb">🔮</span>
        </div>
        <p className="oracle-kicker">{friendlyDate(date)}</p>
        <h2 className="oracle-proclaim">The Oracle has spoken</h2>
        <p className="oracle-matchup">{day.matchup}</p>
      </header>

      {/* ---- The call itself: the team, big, beside the dial. ---- */}
      <div className="oracle-call">
        <ConfidenceDial confidence={day.oracle.confidence} />
        <div className="oracle-call__text">
          <span className="oracle-call__label">The call</span>
          <span className="oracle-call__team">
            {day.oracle.team ?? (day.oracle.side === 'home' ? 'Home' : 'Away')}
          </span>
          <span className="oracle-call__conf">
            {day.oracle.confidence}% confident
          </span>
        </div>
      </div>

      {/* ---- GRADED: the reveal. Leads the lower half, because on a settled
          day the result is the only thing the fan came for. ---- */}
      {graded && (
        <div
          className={`oracle-reveal oracle-reveal--${
            mine ? mine.outcome : 'none'
          }`}
        >
          {mine ? (
            <>
              {mine.outcome === 'win' && mine.pointsAwarded !== null && (
                <span className="oracle-reveal__points">
                  +{points(mine.pointsAwarded)}
                </span>
              )}
              <p className="oracle-reveal__headline">
                {oracleOutcomeCopy(mine.choice, mine.outcome).headline}
              </p>
              <p className="oracle-reveal__sub">
                {oracleOutcomeCopy(mine.choice, mine.outcome).sub}
              </p>
            </>
          ) : (
            <>
              <p className="oracle-reveal__headline">
                {day.status === 'voided'
                  ? 'This one was washed.'
                  : 'This one is settled.'}
              </p>
              <p className="oracle-reveal__sub">
                You sat this call out. There is another tomorrow.
              </p>
            </>
          )}

          {/* Which side actually covered, in team terms. null on a void —
              a washed day has no answer, and inventing one would be a lie. */}
          {day.resultSide && (
            <p className="oracle-reveal__result">
              Result:{' '}
              <strong>
                {day.resultSide === 'home'
                  ? day.homeTeam ?? 'Home'
                  : day.awayTeam ?? 'Away'}
              </strong>
              {day.resultSide === day.oracle.side
                ? ' — the Oracle was right'
                : ' — the Oracle was wrong'}
            </p>
          )}

          <ScoreLine day={day} live={false} />
        </div>
      )}

      {/* ---- OPEN + unpicked: THE TWO BUTTONS. The biggest tap targets on the
          site, and the payouts ride ON them. ---- */}
      {canPick && (
        <div className="oracle-actions">
          <button
            type="button"
            className={`oracle-btn oracle-btn--ride${
              picking === 'ride' ? ' oracle-btn--picking' : ''
            }`}
            disabled={picking !== null}
            onClick={() => onPick('ride')}
          >
            <span className="oracle-btn__verb">Ride</span>
            <span className="oracle-btn__pay">+{points(day.payouts.ride)}</span>
            <span className="oracle-btn__hint">with the Oracle</span>
          </button>
          <button
            type="button"
            className={`oracle-btn oracle-btn--fade${
              picking === 'fade' ? ' oracle-btn--picking' : ''
            }`}
            disabled={picking !== null}
            onClick={() => onPick('fade')}
          >
            <span className="oracle-btn__verb">Fade</span>
            <span className="oracle-btn__pay">+{points(day.payouts.fade)}</span>
            <span className="oracle-btn__hint">against it</span>
          </button>
        </div>
      )}

      {/* ---- PICKED (still open, or locked): the buttons collapse into the
          chosen state. The un-chosen side is stated too, so the fan can see
          what they passed up — that's the story they tell tomorrow. ---- */}
      {mine && !graded && (
        <div className={`oracle-locked-in oracle-locked-in--${mine.choice}`}>
          <span className="oracle-locked-in__badge" aria-hidden="true">
            {mine.choice === 'fade' ? '⚔️' : '🤝'}
          </span>
          <span className="oracle-locked-in__text">
            {oracleChoiceLabel(mine.choice)}
          </span>
          <span className="oracle-locked-in__pay">
            Pays +
            {points(
              mine.choice === 'fade' ? day.payouts.fade : day.payouts.ride,
            )}{' '}
            if it lands
          </span>
        </div>
      )}

      {/* The streak celebration, inline, right where the buttons were. Only for
          a pick made in THIS session — see `justPicked`. 'already_recorded' is
          deliberately still shown: it happens when a fan plays a second Arena
          game the same day, and "Play streak: 4" is true and worth seeing. */}
      {justPicked && (
        <div className="oracle-celebrate" role="status">
          <span className="oracle-celebrate__streak">
            {streakOutcomeCopy(
              justPicked.streakOutcome,
              justPicked.streaks,
              justPicked.freezesConsumed,
            )}
          </span>
          {justPicked.freezeEarned && (
            <span className="oracle-celebrate__freeze">
              ❄️ You earned a freeze
            </span>
          )}
        </div>
      )}

      {pickError && <div className="error oracle-error">{pickError}</div>}

      {/* ---- The crowd. Shown while the day is live in any sense — open,
          picked or locked — and dropped once graded, where the result has
          replaced the question. ---- */}
      {!graded && <SplitBar split={day.split} />}

      {/* ---- The clock. Counting down while open; a statement once locked. */}
      {!graded && (
        <footer className="oracle-foot">
          {locked ? (
            <>
              {/* Two locked readings. "Await the final" is a line about a fan
                  with something riding; a fan who never picked has nothing
                  awaiting, and telling them otherwise would be a small lie in
                  the most atmospheric sentence on the card. */}
              <p className="oracle-foot__locked">
                {mine
                  ? 'The machine and the crowd await the final.'
                  : 'Locked at kickoff — you sat this one out.'}
              </p>
              <ScoreLine day={day} live={day.event.status === 'live'} />
            </>
          ) : (
            <p className="oracle-foot__clock">
              <span className="oracle-foot__tick" aria-hidden="true">
                ⏳
              </span>
              {oracleLockCountdown(day.locksAt, now)}
              <span className="oracle-foot__at">
                {' · '}
                {kickoffLabel(day.locksAt)}
              </span>
            </p>
          )}
        </footer>
      )}
    </section>
  );
}

// "Friday, July 25" — the day as a masthead line. The ET calendar date arrives
// as a bare YYYY-MM-DD, so it is parsed as LOCAL noon rather than handed to
// Date directly: `new Date('2026-07-25')` is UTC midnight, which renders as the
// 24th for every fan west of Greenwich — including the whole ET audience this
// game's day boundary is built around.
function friendlyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// "7:10 PM" — kickoff, which is also the lock. A real timestamp, so it converts
// to the fan's own zone the way every other time on the site does.
function kickoffLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
