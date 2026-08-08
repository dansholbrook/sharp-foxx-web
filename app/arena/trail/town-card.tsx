'use client';

// ============================================================================
// TODAY'S TOWN — the whole of the Foxx Trail's daily ask, on one card.
//
// THE TOWN IS THE HERO, NOT THE GAME. That inversion is the entire difference
// between this card and the Oracle's: the Oracle leads with a matchup and an
// opinion, and the Trail leads with a PLACE. "🚌 THE TRAIL STOPS IN Hutchinson,
// KS" is the headline, the correspondent's line is the standfirst, and the game
// is what you do while you're there. Lead with the fixture and the Trail becomes
// a second daily pick with a decorative dateline; lead with the town and it's a
// road trip.
//
// SEVEN STATES, one component, for the same reason the Oracle's card holds five:
// they are one card at seven moments of its life, and splitting them would
// duplicate the town, the intro and the split half a dozen times.
//
//   NO SEASON  — nothing is running. Not an error; the streak rail still stands.
//   NO DAY     — a season with nothing on today's calendar.
//   REST STOP  — the bus parked. v1 auto-voids it, so streaks are SAFE, and
//                saying so is the only job this state has.
//   OPEN       — the two team buttons, the live split, the countdown.
//   PICKED     — buttons collapse to the frozen call + the streak celebration.
//   LOCKED     — first pitch passed, nothing actionable, score if there is one.
//   GRADED     — pennant claimed, or the bus waits.
//
// THE LOSS COPY IS NOT THE ORACLE'S. A wrong call here does not cost the fan
// their place — the bus simply doesn't move — so "The bus waits. Same town, new
// chance tomorrow" is both kinder AND more accurate than any variant of "you
// lost". See trailOutcomeCopy in api.ts.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  arenaLockCountdown,
  points,
  trailOutcomeCopy,
  trailSideTeam,
  trailStreakCopy,
  etTime,
  EntryRefusal,
  TrailDay,
  TrailPickResult,
  TrailProgress,
  TrailSeason,
  TrailSide,
} from '../../api';
import { EntryAdvisoryNotice } from '../../entry-advisory';

// The live split, home vs away. Renders at zero picks too — an empty bar that
// says nobody has called it yet is the honest first state and the most inviting
// one. Same component logic as the Oracle's, in the Trail's two-team terms.
function SplitBar({ day }: { day: TrailDay }) {
  const total = day.split.total;
  const awayPct = total > 0 ? (day.split.away / total) * 100 : 50;

  return (
    <div className="trail-split">
      <div className="trail-split__labels">
        <span className="trail-split__label">
          <strong>{points(day.split.away)}</strong> on{' '}
          {trailSideTeam(day, 'away')}
        </span>
        <span className="trail-split__label trail-split__label--home">
          <strong>{points(day.split.home)}</strong> on{' '}
          {trailSideTeam(day, 'home')}
        </span>
      </div>
      <div
        className={`trail-split__bar${total === 0 ? ' trail-split__bar--empty' : ''}`}
        role="img"
        aria-label={
          total === 0
            ? 'Nobody has called it yet'
            : `${day.split.away} on ${trailSideTeam(day, 'away')}, ${
                day.split.home
              } on ${trailSideTeam(day, 'home')}`
        }
      >
        <div
          className="trail-split__fill"
          style={{ ['--away-pct' as string]: `${awayPct}%` }}
        />
      </div>
      {total === 0 && (
        <p className="trail-split__none">
          Nobody has called it yet. Be the first off the bus.
        </p>
      )}
    </div>
  );
}

// The live or final score. Only when the event carries both numbers — a
// scheduled game with nulls shows nothing rather than "0–0", which reads as a
// scoreless tie in progress.
function ScoreLine({ day, live }: { day: TrailDay; live: boolean }) {
  if (!day.event) return null;
  const { homeScore, awayScore } = day.event;
  if (homeScore === null || awayScore === null) return null;
  return (
    <div className={`trail-score${live ? ' trail-score--live' : ''}`}>
      {live && <span className="trail-score__live">Live</span>}
      <span className="trail-score__side">
        <span className="trail-score__team">{trailSideTeam(day, 'away')}</span>
        <span className="trail-score__num">{awayScore}</span>
      </span>
      <span className="trail-score__at">at</span>
      <span className="trail-score__side">
        <span className="trail-score__team">{trailSideTeam(day, 'home')}</span>
        <span className="trail-score__num">{homeScore}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE CARD
// ---------------------------------------------------------------------------
export function TownCard({
  season,
  day,
  progress,
  date,
  justPicked,
  onPick,
  picking,
  pickError,
  // The conflict-of-interest refusal, or null on the normal case. A
  // correspondent covering the town's game rides along; they don't call it.
  covering,
}: {
  season: TrailSeason | null;
  day: TrailDay | null;
  progress: TrailProgress | null;
  date: string;
  // The pick response that just landed, held by the page so the celebration
  // survives the poll behind it. null for a fan returning to a day they already
  // called — the moment has passed, and re-firing it would be a lie about when.
  justPicked: TrailPickResult | null;
  onPick: (side: TrailSide) => void;
  picking: TrailSide | null;
  pickError: string | null;
  covering: EntryRefusal | null;
}) {
  // The countdown ticker. One second, because the last minute before first
  // pitch is the one that matters. Torn down the moment the day locks.
  const [now, setNow] = useState(() => Date.now());
  const ticking =
    day !== null && !day.restStop && !day.locked && day.status === 'open';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // ---- NO SEASON ----------------------------------------------------------
  if (!season) {
    return (
      <section className="trail-card trail-card--quiet">
        <div className="trail-mark" aria-hidden="true">
          🚌
        </div>
        <p className="trail-kicker">{friendlyDate(date)}</p>
        <h2 className="trail-quiet__title">The bus is between seasons.</h2>
        <p className="trail-quiet__sub">
          A new route is being laid. Your pennants keep — check the book below.
        </p>
      </section>
    );
  }

  // ---- NO DAY -------------------------------------------------------------
  if (!day) {
    return (
      <section className="trail-card trail-card--quiet">
        <div className="trail-mark" aria-hidden="true">
          🚌
        </div>
        <p className="trail-kicker">
          {friendlyDate(date)} · {season.name}
        </p>
        <h2 className="trail-quiet__title">The bus is on the highway.</h2>
        <p className="trail-quiet__sub">
          No stop today. Your streak is safe until the next town.
        </p>
      </section>
    );
  }

  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';
  // "Locked" as this card means it: first pitch has passed but nothing has
  // graded. A graded day is past locked and gets the reveal instead.
  const locked = day.locked && !graded;
  // COVERING GREYS THE CARD BUT IS NOT `locked` — that flag drives the foot's
  // first-pitch sentence, and a covered day is usually still counting down.
  // Held as the refusal itself so the render needs no non-null assertion, and
  // dropped once graded, where the result has replaced the question.
  const covered = graded ? null : covering;
  const canPick =
    day.status === 'open' && !day.restStop && !day.locked && !mine && !covered;

  return (
    <section
      className={`trail-card${graded ? ' trail-card--graded' : ''}${
        locked || covered !== null ? ' trail-card--locked' : ''
      }${day.restStop ? ' trail-card--rest' : ''}`}
    >
      {/* ---- THE TOWN. The headline of the whole surface. ---- */}
      <header className="trail-town">
        <p className="trail-kicker">
          {friendlyDate(date)} · {season.name}
        </p>
        <p className="trail-town__lede">
          <span className="trail-town__bus" aria-hidden="true">
            🚌
          </span>
          The Trail stops in
        </p>
        <h2 className="trail-town__name">{day.town.name}</h2>
        <span className="trail-town__region">{day.town.region}</span>

        {/* THE CORRESPONDENT'S LINE, in editorial italics — the one piece of
            authored copy on the card, and the thing that makes this a place
            rather than a fixture. Self-hides: a town with no intro gets no
            empty quote marks. */}
        {day.town.intro && (
          <p className="trail-town__intro">{day.town.intro}</p>
        )}

        {/* The school, when the route pinned one. A quiet line — the town is
            the subject, the program is context. */}
        {day.town.school && (
          <p className="trail-town__school">
            {day.town.school.name}
            {day.town.school.mascot ? ` ${day.town.school.mascot}` : ''}
          </p>
        )}
      </header>

      {/* ---- REST STOP. No game, no pick, and the only thing worth saying is
          that nothing was lost by it. ---- */}
      {day.restStop ? (
        <div className="trail-rest">
          <span className="trail-rest__icon" aria-hidden="true">
            ☕
          </span>
          <p className="trail-rest__headline">Rest stop — streaks safe.</p>
          <p className="trail-rest__sub">
            No game in town today. Nothing counted against you; the bus rolls
            again tomorrow.
          </p>
        </div>
      ) : (
        <>
          {/* ---- THE MATCHUP. Second billing, under the town. ---- */}
          {day.matchup && <p className="trail-matchup">{day.matchup}</p>}

          {/* ---- GRADED: the reveal. Leads the lower half on a settled day —
              the result is what the fan came back for. ---- */}
          {graded && (
            <div
              className={`trail-reveal trail-reveal--${mine ? mine.outcome : 'none'}`}
            >
              {mine ? (
                <>
                  {mine.outcome === 'win' && mine.pointsAwarded !== null && (
                    <span className="trail-reveal__points">
                      +{points(mine.pointsAwarded)}
                    </span>
                  )}
                  <p className="trail-reveal__headline">
                    {trailOutcomeCopy(mine.outcome, day.town.name, progress).headline}
                  </p>
                  <p className="trail-reveal__sub">
                    {trailOutcomeCopy(mine.outcome, day.town.name, progress).sub}
                  </p>
                </>
              ) : (
                <>
                  <p className="trail-reveal__headline">
                    {day.status === 'voided'
                      ? 'This one was washed.'
                      : 'This one is settled.'}
                  </p>
                  <p className="trail-reveal__sub">
                    You sat this stop out. The bus pulls in somewhere new
                    tomorrow.
                  </p>
                </>
              )}

              {/* Which side actually took it. null on a void — a washed day has
                  no answer, and inventing one would be a lie. */}
              {day.winnerSide && (
                <p className="trail-reveal__result">
                  Winner:{' '}
                  <strong>{trailSideTeam(day, day.winnerSide)}</strong>
                </p>
              )}

              <ScoreLine day={day} live={false} />
            </div>
          )}

          {/* ---- OPEN + uncalled: THE TWO BUTTONS. Team names, thumb-sized,
              nothing else competing for the tap. ---- */}
          {canPick && (
            <div className="trail-actions">
              <button
                type="button"
                className={`trail-btn${picking === 'away' ? ' trail-btn--picking' : ''}`}
                disabled={picking !== null}
                onClick={() => onPick('away')}
              >
                <span className="trail-btn__team">
                  {trailSideTeam(day, 'away')}
                </span>
                <span className="trail-btn__hint">visiting</span>
              </button>
              <button
                type="button"
                className={`trail-btn${picking === 'home' ? ' trail-btn--picking' : ''}`}
                disabled={picking !== null}
                onClick={() => onPick('home')}
              >
                <span className="trail-btn__team">
                  {trailSideTeam(day, 'home')}
                </span>
                <span className="trail-btn__hint">at home</span>
              </button>
            </div>
          )}

          {/* ---- COVERING: where the two buttons would have been. The town,
              the correspondent's line and the split all stay — someone working
              tonight's game has more reason to read those than anyone. ---- */}
          {covered && <EntryAdvisoryNotice refusal={covered} />}

          {/* ---- CALLED (still open, or locked): the frozen state. ---- */}
          {mine && !graded && (
            <div className="trail-locked-in">
              <span className="trail-locked-in__badge" aria-hidden="true">
                🎟️
              </span>
              <span className="trail-locked-in__text">
                You&apos;re riding{' '}
                <strong>{trailSideTeam(day, mine.side)}</strong>
              </span>
              <span className="trail-locked-in__pay">
                A pennant for {day.town.name} if it lands
              </span>
            </div>
          )}

          {/* The streak celebration, inline, where the buttons were. Only for a
              pick made in THIS session. 'already_recorded' is deliberately still
              shown — it fires when the fan played the Oracle earlier the same
              day, and "play streak 4" is true and worth seeing. */}
          {justPicked && (
            <div className="trail-celebrate" role="status">
              <span className="trail-celebrate__streak">
                {trailStreakCopy(
                  justPicked.streakOutcome,
                  justPicked.streaks,
                  justPicked.freezesConsumed,
                )}
              </span>
              {justPicked.freezeEarned && (
                <span className="trail-celebrate__freeze">
                  ❄️ You earned a freeze
                </span>
              )}
              {/* THE SCENIC ROUTE CHEST, announced the moment it fires. It is
                  paid inside the pick's own transaction, so this is the one
                  and only read that will ever carry it — a fan who misses this
                  render never learns the seventh day paid. */}
              {justPicked.scenicRoute.chest && (
                <span className="trail-celebrate__chest">
                  🧳 Scenic Route — all seven days
                  {justPicked.scenicRoute.chest.points > 0 &&
                    ` · +${points(justPicked.scenicRoute.chest.points)}`}
                  {justPicked.scenicRoute.chest.freezeGranted && ' · ❄️ +1'}
                </span>
              )}
            </div>
          )}

          {pickError && <div className="error trail-error">{pickError}</div>}

          {/* ---- The crowd. Live while the day is open, called or locked;
              dropped once graded, where the result replaced the question. ---- */}
          {!graded && <SplitBar day={day} />}

          {/* ---- The clock. ---- */}
          {!graded && (
            <footer className="trail-foot">
              {locked ? (
                <>
                  <p className="trail-foot__locked">
                    {mine
                      ? 'The bus idles while the game plays out.'
                      : 'Locked at first pitch — you sat this stop out.'}
                  </p>
                  <ScoreLine day={day} live={day.event?.status === 'live'} />
                </>
              ) : (
                day.locksAt && (
                  <p className="trail-foot__clock">
                    <span className="trail-foot__tick" aria-hidden="true">
                      ⏳
                    </span>
                    {arenaLockCountdown(day.locksAt, now)}
                    <span className="trail-foot__at">
                      {' · '}
                      {kickoffLabel(day.locksAt)}
                    </span>
                  </p>
                )
              )}
            </footer>
          )}
        </>
      )}
    </section>
  );
}

// "Friday, July 25". The ET calendar date arrives as a bare YYYY-MM-DD, so it is
// parsed as LOCAL noon: `new Date('2026-07-25')` is UTC midnight, which renders
// as the 24th for every fan west of Greenwich — including the whole ET audience
// this game's day boundary is built around.
function friendlyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// "7:10 PM ET" — first pitch, which is also the lock. A real timestamp, so it
// renders in ET and says so, like every other time on the site.
function kickoffLabel(iso: string): string {
  return etTime(iso, { zone: true });
}
