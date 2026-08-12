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
// TWO NUMBERS, NOT A PERCENTAGE. The card used to lead with "New York Mets —
// 68% confident", which asks a fan to know what a confidence percentage BUYS
// them before they can tell whether fading is worth it. It buys 21 instead of
// 10, so the card says that: the team, then "Ride it → win 10" over "Back the
// Marlins → win 21", with the percentage demoted to small print underneath. One
// number roughly double the other makes the bolder call obvious to someone who
// has never thought about implied odds.
//
// The matching push notification opens with the same sentence, so a fan tapping
// through lands on the words they were just shown.
//
// BOTH PAYOUTS ARE RENDERED VERBATIM. The backend pre-computes them for this day
// at this confidence, with the same function that grades the pick — neither is
// recomputed here and the fade figure is never derived from the confidence, so
// an admin retuning the reward (or the confidence ceiling, 95 → 80) moves the
// card without touching it. Nothing here knows a maximum.
//
// TWO THINGS THE API PUSHES TO THIS CLIENT ON PURPOSE:
//
//   NULL TEAM NAMES. oracle.team and fadeTeam are both null when an event has no
//   linked team row (a rep-created game). The raw null comes down because
//   fan-facing copy lives here — see sideName().
//
//   A PAYOUT OF 0. That is an admin having DISABLED the reward, a config state
//   rather than a prize of nothing, so the promise clause is suppressed rather
//   than rendered as "win 0". The button stays: a 0-point fade is still a pick,
//   and it still moves the play streak and the crowd split.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  EntryRefusal,
  OracleChoice,
  OracleDay,
  OraclePickResult,
  OracleSide,
  oracleChoiceLabel,
  oracleLockCountdown,
  oracleOutcomeCopy,
  points,
  streakOutcomeCopy,
  etTime,
} from '../../api';
import { EntryAdvisoryNotice } from '../../entry-advisory';

// The mark and the split bar both animate; both stop dead under reduced motion
// (see globals.css). Nothing here branches on the preference — the CSS owns it,
// so there is one place to look and no chance of the two disagreeing.

// ---------------------------------------------------------------------------
// A team name for the middle of a sentence. Both sides are nullable and the API
// sends the raw null rather than a placeholder, because this string is copy.
//
// "the home side" rather than "Home": it lands mid-sentence ("The Oracle likes
// the home side", "Back the away side"), not in a score-line column, where the
// bare word is right and stays — see ScoreLine.
// ---------------------------------------------------------------------------
function sideName(team: string | null, side: OracleSide): string {
  return team ?? (side === 'home' ? 'the home side' : 'the away side');
}

// ---------------------------------------------------------------------------
// ONE OFFER — "Ride it → win 10". The same body renders inside a button while
// the day is pickable and inside a static line once it isn't, so a locked or
// covered card says exactly what the pickable one said.
//
// `pay` of 0 drops the whole promise clause and leaves the action naked. See the
// header: zero is a disabled reward, and "win 0" would read as an insult.
// ---------------------------------------------------------------------------
function OfferBody({ act, pay }: { act: string; pay: number }) {
  return (
    <>
      <span className="oracle-offer__act">{act}</span>
      {pay > 0 && (
        <span className="oracle-offer__win">
          <span className="oracle-offer__arrow" aria-hidden="true">
            →
          </span>
          win <strong className="oracle-offer__pay">{points(pay)}</strong>
        </span>
      )}
    </>
  );
}

// The button's spoken label. The arrow is decoration; a screen reader gets the
// sentence it stands for, and the same suppression rule at 0.
function offerLabel(act: string, pay: number): string {
  return pay > 0 ? `${act} to win ${points(pay)} points` : act;
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
  // The conflict-of-interest refusal, or null on the normal case. A
  // correspondent covering today's game reads this card; they don't call it.
  covering,
}: {
  day: OracleDay | null;
  date: string;
  justPicked: OraclePickResult | null;
  onPick: (choice: OracleChoice) => void;
  // The choice currently in flight — drives the optimistic selection state, so
  // the button the fan hit looks chosen before the response lands.
  picking: OracleChoice | null;
  pickError: string | null;
  covering: EntryRefusal | null;
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
  // COVERING GREYS THE CARD BUT IS NOT `locked`. That flag drives the foot's
  // kickoff sentence ("Locked at kickoff — you sat this one out"), and a covered
  // day is usually still counting down to a game that hasn't started. It borrows
  // the locked card's dimming and nothing else.
  // Held as the refusal itself rather than a boolean so the render below needs
  // no non-null assertion. Dropped once graded: the result is the story then,
  // and an advisory about entering a settled day is stale news.
  const covered = graded ? null : covering;
  const canPick = day.status === 'open' && !day.locked && !mine && !covered;

  // The two sides, in fan terms. The fade side is the one the Oracle didn't
  // take, and its name arrives on the day rather than being joined here.
  const rideName = sideName(day.oracle.team, day.oracle.side);
  const fadeName = sideName(
    day.fadeTeam,
    day.oracle.side === 'home' ? 'away' : 'home',
  );
  const rideAct = 'Ride it';
  const fadeAct = `Back ${fadeName}`;
  // The read-only reading of the offers: a fan who arrived after kickoff, or a
  // correspondent covering the game. Only sides that actually promise something
  // survive here — with no button under it, an offer of nothing is just noise.
  const showStaticOffers =
    !canPick &&
    !mine &&
    !graded &&
    (day.payouts.ride > 0 || day.payouts.fade > 0);

  return (
    <section
      className={`oracle-card${graded ? ' oracle-card--graded' : ''}${
        locked || covered !== null ? ' oracle-card--locked' : ''
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
        <p className="oracle-matchup">{day.matchup}</p>
        {/* THE LINE THE SCREEN EXISTS TO DELIVER, and the one the push
            notification opens with. Past tense once the day has settled — the
            Oracle's opinion is history by then, and "likes" would read as a tip
            on a game that already finished. */}
        <h2 className="oracle-likes">
          The Oracle {graded ? 'liked' : 'likes'} {rideName}.
        </h2>
      </header>

      {/* ---- THE OFFER. Two rows, stacked so the numbers sit in a column and
          the difference between them is a glance rather than a comparison.
          Buttons while the day is pickable, and the biggest tap targets on the
          site; the same sentences, static, once it isn't. ---- */}
      {canPick && (
        <div className="oracle-offers">
          <button
            type="button"
            className={`oracle-offer oracle-offer--ride${
              picking === 'ride' ? ' oracle-offer--picking' : ''
            }`}
            aria-label={offerLabel(rideAct, day.payouts.ride)}
            disabled={picking !== null}
            onClick={() => onPick('ride')}
          >
            <OfferBody act={rideAct} pay={day.payouts.ride} />
          </button>
          <button
            type="button"
            className={`oracle-offer oracle-offer--fade${
              picking === 'fade' ? ' oracle-offer--picking' : ''
            }`}
            aria-label={offerLabel(fadeAct, day.payouts.fade)}
            disabled={picking !== null}
            onClick={() => onPick('fade')}
          >
            <OfferBody act={fadeAct} pay={day.payouts.fade} />
          </button>
        </div>
      )}

      {showStaticOffers && (
        <div className="oracle-offers">
          {day.payouts.ride > 0 && (
            <p className="oracle-offer oracle-offer--ride oracle-offer--static">
              <OfferBody act={rideAct} pay={day.payouts.ride} />
            </p>
          )}
          {day.payouts.fade > 0 && (
            <p className="oracle-offer oracle-offer--fade oracle-offer--static">
              <OfferBody act={fadeAct} pay={day.payouts.fade} />
            </p>
          )}
        </div>
      )}

      {/* ---- The confidence, as small print. It is context for the two numbers
          above, not a thing a fan has to understand before they can play. ---- */}
      <p className="oracle-conf">{day.oracle.confidence}% confident.</p>

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
              {/* The same rule the offer rows follow: a win worth 0 (the reward
                  was disabled) shows the headline and no badge, rather than
                  celebrating "+0". */}
              {mine.outcome === 'win' &&
                mine.pointsAwarded !== null &&
                mine.pointsAwarded > 0 && (
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

      {/* ---- COVERING: where the two buttons would have been. The call, the
          matchup and the split above are untouched — a correspondent working
          tonight's game still wants to see what the room thinks of it; they
          just aren't calling it. Rendered even when `mine` exists (they were
          assigned after picking), where it explains the frozen card. ---- */}
      {covered && <EntryAdvisoryNotice refusal={covered} />}

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
          {/* Suppressed at 0, like the offer rows — "Pays +0 if it lands" is a
              promise of nothing dressed as a promise. */}
          {(mine.choice === 'fade' ? day.payouts.fade : day.payouts.ride) >
            0 && (
            <span className="oracle-locked-in__pay">
              Pays +
              {points(
                mine.choice === 'fade' ? day.payouts.fade : day.payouts.ride,
              )}{' '}
              if it lands
            </span>
          )}
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

// "7:10 PM ET" — kickoff, which is also the lock. A real timestamp, so it
// renders in ET and says so, the way every other time on the site does.
function kickoffLabel(iso: string): string {
  return etTime(iso, { zone: true });
}
