'use client';

// ============================================================================
// THE ARENA HUB'S GAME CARDS — one live status tile per game.
//
// A CARD IS A MINIATURE OF ITS GAME, NOT A MENU ITEM. "Beat the Oracle →" is a
// link; "The Oracle takes Brewers · 71% — ride or fade?" is a reason to tap. The
// whole value of the hub is that a fan can see, without opening anything, which
// of their games still wants something from them today — so every card states
// TODAY'S state in the game's own voice, and the unplayed state is the only one
// phrased as a question.
//
// EACH CARD OWNS ITS OWN READ. The page fires both today-endpoints in parallel
// and hands each card its own slice plus its own loading/error flag: a Trail
// read that 500s must not blank the Oracle card beside it. A card that failed
// says so quietly and still links through — the game itself may well be fine.
//
// THE STATE LADDER IS THE SAME ON BOTH CARDS, and it is ordered by which reading
// stops being true first: settled → called → open → nothing scheduled. The
// backend hands down `outcome` pre-collapsed, so no card re-derives "graded"
// from a status plus a nullable correct.
// ============================================================================

import Link from 'next/link';
import {
  arenaLockCountdown,
  points,
  trailSideTeam,
  OracleToday,
  TrailToday,
} from '../api';

// "7:10" — the lock, in the fan's own zone. The hub says the TIME rather than a
// countdown for a day already called: a fan who has picked wants to know when
// it goes live, not how many minutes they have left to do a thing they've done.
function lockClock(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// The shell every card shares: mark, name, tagline, then whatever status line
// the game computed. `href` null renders the tile as a dead panel rather than a
// link — that's the "coming soon" case, and a link that goes nowhere is worse
// than no link.
function GameTile({
  href,
  tone,
  mark,
  name,
  tagline,
  children,
}: {
  href: string | null;
  tone: 'oracle' | 'trail' | 'soon';
  mark: React.ReactNode;
  name: string;
  tagline: string;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <div className="arena-tile__head">
        <span className={`arena-tile__mark arena-tile__mark--${tone}`} aria-hidden="true">
          {mark}
        </span>
        <span className="arena-tile__names">
          <span className="arena-tile__name">{name}</span>
          <span className="arena-tile__tagline">{tagline}</span>
        </span>
      </div>
      <div className="arena-tile__body">{children}</div>
    </>
  );

  if (!href) {
    return (
      <section className={`arena-tile arena-tile--${tone} arena-tile--dead`}>
        {body}
      </section>
    );
  }
  return (
    <Link href={href} className={`arena-tile arena-tile--${tone}`}>
      {body}
    </Link>
  );
}

// A card whose read hasn't landed (or landed badly). Deliberately the same
// height and shape as the loaded card so the hub doesn't reflow under the
// thumb as the two fetches resolve at different moments.
function TilePlaceholder({ text }: { text: string }) {
  return <p className="arena-tile__placeholder">{text}</p>;
}

// ---------------------------------------------------------------------------
// THE ORACLE CARD
//
// Four readings, all in the Oracle's register. The open one names the TEAM and
// the confidence, because that pair is the entire decision — "there's a game
// today" is not a hook, "the Oracle takes Brewers at 71%" is.
// ---------------------------------------------------------------------------
export function OracleGameCard({
  today,
  loading,
  failed,
}: {
  today: OracleToday | null;
  loading: boolean;
  failed: boolean;
}) {
  const day = today?.day ?? null;

  return (
    <GameTile
      href="/arena/oracle"
      tone="oracle"
      mark={
        <>
          <span className="arena-tile__glyph">🦊</span>
          <span className="arena-tile__glyph arena-tile__glyph--sub">🔮</span>
        </>
      }
      name="Beat the Oracle"
      tagline="One call a day from the house engine"
    >
      {loading && <TilePlaceholder text="Consulting the Oracle…" />}
      {!loading && failed && (
        <TilePlaceholder text="Couldn't reach the Oracle — tap to try." />
      )}

      {!loading && !failed && !day && (
        <p className="arena-tile__state arena-tile__state--quiet">
          The Oracle rests.
        </p>
      )}

      {!loading && !failed && day && <OracleState day={day} />}
    </GameTile>
  );
}

function OracleState({ day }: { day: NonNullable<OracleToday['day']> }) {
  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';

  // SETTLED. The number leads when there is one — a fan who won at 11pm and
  // opened the hub at 11:30 came for exactly that.
  if (graded) {
    if (!mine) {
      return (
        <p className="arena-tile__state arena-tile__state--quiet">
          Settled — you sat this one out.
        </p>
      );
    }
    if (mine.outcome === 'win') {
      return (
        <p className="arena-tile__state arena-tile__state--win">
          {mine.pointsAwarded !== null && (
            <strong className="arena-tile__pts">+{points(mine.pointsAwarded)}</strong>
          )}
          {mine.choice === 'fade' ? 'you beat the Oracle' : 'you rode it home'}
        </p>
      );
    }
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        {mine.outcome === 'void'
          ? 'Pushed — streaks safe.'
          : 'Settled — see how it went.'}
      </p>
    );
  }

  // CALLED. Their side, and when it goes live.
  if (mine) {
    return (
      <p className={`arena-tile__state arena-tile__state--${mine.choice}`}>
        You&apos;re {mine.choice === 'fade' ? 'FADING' : 'RIDING'}
        {!day.locked && day.locksAt && (
          <span className="arena-tile__when"> · locks {lockClock(day.locksAt)}</span>
        )}
      </p>
    );
  }

  // LOCKED, unplayed. Not a question any more — the tap can't do anything about
  // it, and pretending otherwise would send the fan to a card with two dead
  // buttons on it.
  if (day.locked) {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        Locked at kickoff — you sat this one out.
      </p>
    );
  }

  // OPEN. The hook.
  return (
    <p className="arena-tile__state arena-tile__state--open">
      The Oracle takes{' '}
      <strong>{day.oracle.team ?? day.matchup}</strong> ·{' '}
      {day.oracle.confidence}% — ride or fade?
      <span className="arena-tile__when">
        {' · '}
        {arenaLockCountdown(day.locksAt)}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// THE TRAIL CARD
//
// The Trail's hook is a PLACE, so the card leads with where the bus is — season
// name, then "Town 1 of 6: Hutchinson, KS" — and the position bar underneath is
// the season-long reason to care, which the Oracle card has no equivalent of.
// ---------------------------------------------------------------------------
export function TrailGameCard({
  today,
  loading,
  failed,
}: {
  today: TrailToday | null;
  loading: boolean;
  failed: boolean;
}) {
  const day = today?.day ?? null;
  const progress = today?.progress ?? null;
  const season = today?.season ?? null;

  return (
    <GameTile
      href="/arena/trail"
      tone="trail"
      mark={
        <>
          <span className="arena-tile__glyph">🚌</span>
          <span className="arena-tile__glyph arena-tile__glyph--sub">🏁</span>
        </>
      }
      name="The Foxx Trail"
      tagline="A season-long road trip through small-college America"
    >
      {loading && <TilePlaceholder text="Finding the bus…" />}
      {!loading && failed && (
        <TilePlaceholder text="Couldn't reach the Trail — tap to try." />
      )}

      {!loading && !failed && !season && (
        <p className="arena-tile__state arena-tile__state--quiet">
          The bus is between seasons.
        </p>
      )}

      {!loading && !failed && season && (
        <>
          {/* WHERE WE ARE, always — this line is true even on a day with no
              town scheduled, and it is the line that makes the Trail feel like
              a journey rather than a second daily pick.

              TODAY'S STOP IS NAMED, NOT NUMBERED, and that is deliberate. A
              town's position_index is editor-authored and the schema only
              promises >= 0, so "town 1" and "town 0" are both legal spellings
              of the first stop — the ONE place a route ordinal is unambiguous
              is the map's ordered array, which is where /arena/trail numbers
              its stops. The fan's OWN position is a different number and the
              server pre-renders it as progress.label; it rides under the bar
              below, where it belongs. */}
          <p className="arena-tile__where">
            <strong>{season.name}</strong>
            {day && (
              <>
                {' · '}
                <span className="arena-tile__town">{day.town.name}</span>
                <span className="arena-tile__region"> {day.town.region}</span>
              </>
            )}
          </p>

          <TrailState day={day} />

          {/* The position bar. Rendered even at zero — an empty road ahead is
              the honest first state and reads as an invitation. */}
          {progress && progress.townCount > 0 && (
            <div className="arena-progress">
              <div
                className="arena-progress__track"
                role="img"
                aria-label={`${progress.label}, ${progress.pennants} pennants`}
                style={{
                  ['--pct' as string]: `${
                    (progress.position / progress.townCount) * 100
                  }%`,
                }}
              >
                <div className="arena-progress__fill" />
              </div>
              <span className="arena-progress__label">{progress.label}</span>
            </div>
          )}
        </>
      )}
    </GameTile>
  );
}

function TrailState({ day }: { day: TrailToday['day'] }) {
  if (!day) {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        No stop on the schedule today.
      </p>
    );
  }

  // A REST STOP states itself. Not a failure and not an empty day — the bus is
  // parked, and streaks are safe, which is the only thing a fan needs to know.
  if (day.restStop) {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        Rest stop — streaks safe.
      </p>
    );
  }

  const mine = day.myPick;
  const graded = day.status === 'graded' || day.status === 'voided';

  if (graded) {
    if (!mine) {
      return (
        <p className="arena-tile__state arena-tile__state--quiet">
          Settled — you sat this one out.
        </p>
      );
    }
    if (mine.outcome === 'win') {
      return (
        <p className="arena-tile__state arena-tile__state--win">
          {mine.pointsAwarded !== null && (
            <strong className="arena-tile__pts">+{points(mine.pointsAwarded)}</strong>
          )}
          pennant claimed 🏁
        </p>
      );
    }
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        {mine.outcome === 'void'
          ? 'Rest stop — streaks safe.'
          : 'The bus waits. Same town tomorrow.'}
      </p>
    );
  }

  if (mine) {
    return (
      <p className="arena-tile__state arena-tile__state--ride">
        You&apos;re riding <strong>{trailSideTeam(day, mine.side)}</strong>
        {!day.locked && day.locksAt && (
          <span className="arena-tile__when"> · locks {lockClock(day.locksAt)}</span>
        )}
      </p>
    );
  }

  if (day.locked) {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        Locked at first pitch — you sat this one out.
      </p>
    );
  }

  return (
    <p className="arena-tile__state arena-tile__state--open">
      Pick today&apos;s game
      {/* locksAt is null on a rest stop, which the branch above already
          returned on — but the type is honest about it, so the guard stays
          rather than being asserted away. */}
      {day.locksAt && (
        <span className="arena-tile__when">
          {' · '}
          {arenaLockCountdown(day.locksAt)}
        </span>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// THE THIRD SLOT — what's coming.
//
// A DEAD TILE ON PURPOSE. It carries no link because there is nothing to open,
// and it names the next game rather than saying "more soon", because a named
// thing with a described mechanic builds anticipation and a vague one builds
// nothing. It sits in the grid at full weight so the Arena reads as a place
// that is filling up rather than a page with two things on it.
// ---------------------------------------------------------------------------
export function ComingSoonCard() {
  return (
    <GameTile
      href={null}
      tone="soon"
      mark={<span className="arena-tile__glyph">📻</span>}
      name="The Correspondent's Call"
      tagline="Next into the Arena"
    >
      <p className="arena-tile__state arena-tile__state--soon">
        <span className="arena-tile__nextpill">NEXT</span>
        Our correspondents file one question a day from the road. You answer
        before they do.
      </p>
      <p className="arena-tile__soonfoot">More games coming.</p>
    </GameTile>
  );
}
