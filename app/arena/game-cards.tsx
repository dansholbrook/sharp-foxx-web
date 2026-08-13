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
// THE STATE LADDER IS THE SAME ON EVERY CARD, and it is ordered by which reading
// stops being true first: settled → called → open → nothing scheduled. The
// backend hands down `outcome` pre-collapsed, so no card re-derives "graded"
// from a status plus a nullable correct.
//
// THREE GAMES, THREE VOICES. Two are daily and one is weekly, and the third
// tile has to make that legible without a label — which is why the Call leads
// with a pot and a two-day countdown where the Oracle leads with a confidence
// and the Trail with a place.
// ============================================================================

import Link from 'next/link';
import {
  arenaLockCountdown,
  callPhase,
  clashResolveCountdown,
  myClashSide,
  otherClashSides,
  points,
  trailSideTeam,
  etTime,
  BingoToday,
  CallCurrent,
  CallEntry,
  ClashTug,
  OracleToday,
  TrailToday,
} from '../api';

// "7:10 PM ET" — the lock. The hub says the TIME rather than a countdown for a
// day already called: a fan who has picked wants to know when it goes live, not
// how many minutes they have left to do a thing they've done. Labelled, because
// it's still the moment their pick stops being editable.
function lockClock(iso: string | null): string {
  return etTime(iso, { zone: true });
}

// A NAME PAST THIS LENGTH GETS THE SMALLER TYPE STEP. The three shipped names
// are 15, 14 and 24 characters, and once the row goes three-across (856px up,
// where .arena-page's 860px cap also pins it) the name track is ~171px and the
// third one wraps to THREE lines while its siblings sit on one. That pushes the
// Call's status line a whole line below the other two and breaks the row's
// rhythm, which is the one thing a row of sibling tiles exists to have.
//
// A SIZE STEP AND NEVER A TRUNCATION: "The Correspondent's Call" is the game's
// name, and a name with an ellipsis in it is a name the fan has to guess at. The
// paired CSS caps the step so the long title lands on two lines at every width
// the row can be — see .arena-tile__name--long in globals.css.
const LONG_NAME = 18;

// The shell every card shares: mark, name, tagline, then whatever status line
// the game computed. `href` null renders the tile as a dead panel rather than a
// link, because a link that goes nowhere is worse than no link.
//
// NO CALLER PASSES null TODAY — the "coming soon" tile it was built for became
// the Correspondent's Call. The branch stays because the Arena is explicitly a
// family that keeps growing, and the next announced-but-unbuilt game wants
// exactly this. Its .arena-tile--dead styling is kept for the same reason; the
// four copy-specific --soon rules were deleted with the tile they described.
function GameTile({
  href,
  tone,
  mark,
  name,
  tagline,
  children,
}: {
  href: string | null;
  tone: 'oracle' | 'trail' | 'call' | 'bingo' | 'clash';
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
          <span
            className={`arena-tile__name${
              name.length > LONG_NAME ? ' arena-tile__name--long' : ''
            }`}
          >
            {name}
          </span>
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
              the honest first state and reads as an invitation.

              THE PENNANT COUNT IN THE LABEL IS trail_progress.pennant_count —
              the denormalized, PER-SEASON counter, and the one place of three
              where it is unambiguously the right source. Everything in this
              block is scoped to the current season (position, townCount, the
              server-rendered progress.label), so the count beside them must be
              too; a lifetime total off GET /me/items would describe a different
              trip and make the bar's own fraction read as a lie. The lifetime
              shelf lives on /profile. */}
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
// THE CORRESPONDENT'S CALL CARD
//
// THE ONLY WEEKLY TILE, and the ladder has to say so — a fan who reads "locks in
// 2d" on the two daily tiles beside this one has learned something false about
// them. So the open state leads with the POT, which is this game's equivalent of
// the Oracle's confidence number: the single figure that makes the tile a
// proposition rather than a link. It stays on the tile after the fan files,
// too — the purse keeps growing until kickoff, so it is still news to someone
// who has already played.
//
// NO STREAK, EVER, and none is drawn — the endpoint returns `streaks: null` by
// design. Nothing about this card contributes to the shared strip above it.
// ---------------------------------------------------------------------------
export function CallGameCard({
  current,
  loading,
  failed,
}: {
  current: CallCurrent | null;
  loading: boolean;
  failed: boolean;
}) {
  const call = current?.call ?? null;

  return (
    <GameTile
      href="/arena/call"
      tone="call"
      mark={
        <>
          <span className="arena-tile__glyph">📻</span>
          <span className="arena-tile__glyph arena-tile__glyph--sub">🎙️</span>
        </>
      }
      name="The Correspondent's Call"
      tagline="One local game a week, five questions from the stands"
    >
      {loading && <TilePlaceholder text="Raising the press box…" />}
      {!loading && failed && (
        <TilePlaceholder text="Couldn't reach the press box — tap to try." />
      )}

      {!loading && !failed && !call && (
        <p className="arena-tile__state arena-tile__state--quiet">
          No card this week — the correspondent files Thursday.
        </p>
      )}

      {!loading && !failed && call && (
        <CallState call={call} entry={current?.myEntry ?? null} />
      )}
    </GameTile>
  );
}

function CallState({
  call,
  entry,
}: {
  call: NonNullable<CallCurrent['call']>;
  entry: CallEntry | null;
}) {
  // One collapsed phase rather than a status plus a nullable — same refusal the
  // two cards above make with myPick.outcome. Note it never tests
  // `status === 'locked'`: nothing writes that status.
  const phase = callPhase(call);
  const hasEntry = entry !== null;

  // ---- SETTLED. A per-fan outcome exists now, so these two states say what
  // happened to the fan rather than what happened to the card.
  if (phase === 'voided') {
    // A wash pays participation and scores nothing, and points_awarded is the
    // one grading column a voided entry carries. The tile says so — a fan whose
    // balance moved should not have to open the card to find out why.
    const paid =
      entry?.outcome === 'void' ? entry.pointsAwarded ?? null : null;
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        {paid !== null && paid > 0 ? (
          <>
            Washed · you keep <strong>+{points(paid)}</strong> for filing
          </>
        ) : (
          'Washed — nothing counted against you.'
        )}
      </p>
    );
  }
  if (phase === 'graded') {
    const mine = entry?.outcome === 'graded' ? entry : null;
    if (!mine) {
      return (
        <p className="arena-tile__state arena-tile__state--quiet">
          Graded — you sat this one out.
        </p>
      );
    }
    // GOLD IS FOR BEATING THE ROOM, NOT FOR BEING PAID. Filing always pays, so
    // a tone keyed off pointsAwarded would make every graded tile a win tile.
    // A band or the Whistle is the real thing.
    const won = mine.whistle === true || mine.band != null;
    const paid = mine.pointsAwarded ?? null;
    return (
      <p
        className={`arena-tile__state arena-tile__state--${won ? 'win' : 'quiet'}`}
      >
        {paid !== null && paid > 0 && (
          <>
            <strong>+{points(paid)}</strong> pts ·{' '}
          </>
        )}
        {/* ONE LINE, SO ONE NUMBER: correctCount. Pushes never surface here —
            the distinction needs a sentence, and a tile that says "3 correct, 1
            push" with no room to explain it is a puzzle rather than a summary.
            The zero card gets the SAME shape rather than a special quiet
            phrasing, because inventing one would make the ordinary line read as
            a boast. */}
        {mine.whistle
          ? 'Golden Whistle'
          : `${mine.correctCount ?? 0} of ${call.questions.length} called`}
      </p>
    );
  }

  // LOCKED. Not a question any more; the tap can't do anything about it.
  if (phase === 'locked') {
    return (
      <p
        className={`arena-tile__state arena-tile__state--${
          hasEntry ? 'ride' : 'quiet'
        }`}
      >
        {hasEntry
          ? 'Your card is in — locked at kickoff.'
          : 'Locked at kickoff — you sat this one out.'}
      </p>
    );
  }

  // FILED, still open. The revisability is the news — it is the one thing about
  // this game that is not true of the two beside it — but the POT RIDES WITH IT,
  // because a filed card is still a stake in a purse that keeps growing until
  // kickoff. The Oracle's confidence and the Trail's position bar both persist
  // past the fan's pick for the same reason; a tile that drops its one figure
  // the moment the fan plays has nothing left to bring them back.
  if (hasEntry) {
    return (
      <p className="arena-tile__state arena-tile__state--ride">
        Card filed · <strong>{points(call.pot.points)}</strong> pts in
        the pot
        {call.locksAt && (
          <span className="arena-tile__when">
            {' · '}edit until {lockClock(call.locksAt)}
          </span>
        )}
      </p>
    );
  }

  // OPEN. The hook — and THE POT LEADS IT. This is the game's equivalent of the
  // Oracle's confidence number and the Trail's town: the single figure that
  // makes the tile a proposition rather than a link, and the question count and
  // the matchup are the terms of that proposition rather than the offer itself.
  return (
    <p className="arena-tile__state arena-tile__state--open">
      <strong>{points(call.pot.points)}</strong> pts in the pot ·{' '}
      {call.questions.length} questions on <strong>{call.event.matchup}</strong>
      {call.locksAt && (
        <span className="arena-tile__when">
          {' · '}
          {arenaLockCountdown(call.locksAt)}
        </span>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// THE SPORTS BINGO CARD
//
// THE FIRST TILE WITH NO DEADLINE ON IT, and the ladder has to be rebuilt around
// that rather than copied. The three tiles above all lead with a lock the fan
// has to beat, because all three games take a PICK that expires. Bingo takes no
// pick: the free card is claimable all night, the numbers come whether or not
// anyone is watching, and nothing on this tile is ever urgent.
//
// SO THE HOOK IS THE DRIP. "Call 24 of 56 · next four in 6m" is this game's
// equivalent of the Oracle's confidence and the Call's pot — the single reading
// that makes the tile a live thing rather than a link. It is also the honest
// one: the reason to tap is that four numbers are about to go up.
//
// NO STREAK, EVER, and none is drawn — BingoToday carries no streak field at
// all, so nothing here contributes to the shared strip above it. Same position
// the Call holds, for a different reason: the Call's cadence would burn freezes,
// bingo simply has no play to record.
//
// NO NEAR-MISS ON THE HUB. `needed` is not read in this file and must not be.
// A tile that says "one from the blackout" is a near-miss on a surface with no
// card under it to explain itself, three taps from the rest of the product —
// and the hub is the one Arena surface a fan lands on without choosing to.
// ---------------------------------------------------------------------------
export function BingoGameCard({
  today,
  loading,
  failed,
}: {
  today: BingoToday | null;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <GameTile
      href="/arena/bingo"
      tone="bingo"
      mark={
        <>
          <span className="arena-tile__glyph">🎱</span>
          <span className="arena-tile__glyph arena-tile__glyph--sub">🦊</span>
        </>
      }
      name="Sports Bingo"
      tagline="Fifty-six numbers a night, called off tonight's slate"
    >
      {loading && <TilePlaceholder text="Opening the hall…" />}
      {!loading && failed && (
        <TilePlaceholder text="Couldn't reach the hall — tap to try." />
      )}
      {/* GET today LAZY-OPENS the night, so a successful read always carries
          one and this branch is unreachable in practice. Kept because "the
          endpoint answered with nothing" should render the shell rather than an
          empty tile body. */}
      {!loading && !failed && !today && (
        <p className="arena-tile__state arena-tile__state--quiet">
          The hall is dark tonight.
        </p>
      )}
      {!loading && !failed && today && <BingoState today={today} />}
    </GameTile>
  );
}

function BingoState({ today }: { today: BingoToday }) {
  const { night, claim } = today;
  const held = claim.cardsHeld;

  // ---- VOIDED. Routine, never alarming, and never the fan's fault.
  if (night.status === 'voided') {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        Washed — no numbers were called.
      </p>
    );
  }

  // ---- SETTLED. The number leads when there is one, same as the three tiles
  // above — a fan who took a blackout at 23:20 and opened the hub at 23:30 came
  // for exactly that. `pointsAwarded` and never a pattern's list price: a
  // pattern can be priced at 0 and would otherwise read as an unpaid win.
  if (night.status === 'settled') {
    if (held === 0) {
      return (
        <p className="arena-tile__state arena-tile__state--quiet">
          Settled — you sat this one out.
        </p>
      );
    }
    const paid = today.cards.reduce(
      (sum, c) =>
        sum +
        c.patterns.reduce((s, p) => s + (p.pointsAwarded ?? 0), 0),
      0,
    );
    if (paid > 0) {
      return (
        <p className="arena-tile__state arena-tile__state--win">
          <strong className="arena-tile__pts">+{points(paid)}</strong>
          off tonight&apos;s card
        </p>
      );
    }
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        Settled — nothing landed tonight.
      </p>
    );
  }

  // ---- DRAWING. The drip is the hook, and it is the same line whether or not
  // the fan holds a card: the numbers are going up regardless, which is the one
  // true thing about this game that is not true of the other three.
  //
  // THE TIME, NEVER A COUNTDOWN, and for the reason lockClock above already
  // gives: THE HUB DOES NOT POLL AND DOES NOT TICK — one read on mount, because
  // a fan sitting on the hub is a fan about to leave it. A countdown rendered
  // once would read "in 6m" for the next twenty minutes, and it goes stale
  // faster here than anywhere else on this page: bingo's clock moves in
  // twenty-minute steps, so a stale one is wrong by most of a tick. A wall
  // clock is still true an hour after it was painted. The countdown lives on
  // /arena/bingo, which ticks.
  if (night.called > 0) {
    return (
      <p className="arena-tile__state arena-tile__state--open">
        Call <strong>{night.called}</strong> of {night.drawCount}
        {night.nextCallAt && (
          <span className="arena-tile__when">
            {' · '}next four at {etTime(night.nextCallAt, { zone: true })}
          </span>
        )}
        {held === 0 && (
          <span className="arena-tile__when"> · your free card is waiting</span>
        )}
      </p>
    );
  }

  // ---- OPEN, before the first ball. The invitation, and the start time.
  //
  // NO PRICE AND NO PURCHASE PROMPT ON THIS TILE. Extra cards are sold in one
  // place — the lobby — and a hub tile advertising a spend is a purchase control
  // on a surface with no terms beside it.
  return (
    <p className="arena-tile__state arena-tile__state--open">
      {held > 0 ? (
        <>
          {held === 1 ? 'Your card is in' : `${held} cards in`} — first four at{' '}
          <strong>{etTime(night.firstDrawAt, { zone: true })}</strong>
        </>
      ) : (
        <>
          Take a free card — first four at{' '}
          <strong>{etTime(night.firstDrawAt, { zone: true })}</strong>
        </>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// THE BUREAU CLASH CARD — THE ONLY TILE THAT IS NOT A PROPOSITION.
//
// LAST IN THE LADDER, and for the same reason the hub orders the other four by
// cadence: this one asks nothing of the fan today. There is no pick, no entry,
// no window closing. Every other tile on the hub is a thing you can still do;
// this one is a thing already being done on your behalf, which is exactly why it
// sits at the bottom of a column sorted by urgency.
//
// IT MUST NEVER SAY "PLAY", and the state ladder below has no call to action in
// it except in the ONE state where the fan genuinely has something to decide:
// having no bureau. 38 of 45 accounts are in that state, so for most fans this
// tile IS a recruiter — and then, once they have a city, it goes quiet and
// becomes a scoreboard forever. Those are two different tiles and the copy has
// to switch cleanly between them.
//
// THE NUMBER ON THE TILE IS THE AVERAGE, never the raw total — same rule as the
// board, for the same reason: a fan on the smaller side reading a lower total
// would conclude they were losing while they were winning. See the long note in
// arena/clash/board.tsx.
//
// NO CREST COLOUR HERE AT ALL. The tile has no room for a disc, and a crest hex
// on tile text or border is precisely the leak the board's palette note forbids.
// The hub's tiles are one visual system; Clash does not get to be the exception.
// ---------------------------------------------------------------------------
export function ClashGameCard({
  tug,
  loading,
  failed,
}: {
  tug: ClashTug | null;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <GameTile
      href="/arena/clash"
      tone="clash"
      mark={
        <>
          <span className="arena-tile__glyph">🏙️</span>
          <span className="arena-tile__glyph arena-tile__glyph--sub">🚩</span>
        </>
      }
      name="Bureau Clash"
      tagline="Your city, pulling against another — powered by everything else you play"
    >
      {loading && <TilePlaceholder text="Reading the board…" />}
      {!loading && failed && (
        <TilePlaceholder text="Couldn't reach the board — tap to try." />
      )}
      {!loading && !failed && tug && <ClashState tug={tug} />}
    </GameTile>
  );
}

function ClashState({ tug }: { tug: ClashTug }) {
  // ---- NO BUREAU. The one state with an action in it, and the only tile on
  // this hub phrased as an invitation rather than a status.
  if (tug.state === 'unaffiliated') {
    return (
      <p className="arena-tile__state arena-tile__state--open">
        Pick your city — six bureaus, and everything you already play starts
        counting for one of them.
      </p>
    );
  }

  if (tug.state === 'no_week') {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        {tug.bureau.name} · between weeks. The next board opens Monday.
      </p>
    );
  }

  if (tug.state === 'unpaired') {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        {tug.bureau.name} sits out week {tug.week.weekNo} — what you earn still
        counts toward the season.
      </p>
    );
  }

  const mine = myClashSide(tug.sides);
  const others = otherClashSides(tug.sides);

  if (!mine) {
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        Week {tug.week.weekNo} is live.
      </p>
    );
  }

  // ---- FREE-FOR-ALL, or any board that isn't a straight pairing: no opponent
  // to name, so the tile reports position rather than inventing a rival.
  if (tug.state === 'free_for_all' || others.length !== 1) {
    const ahead = others.filter(
      (o) => Number(o.score) > Number(mine.score),
    ).length;
    return (
      <p className="arena-tile__state arena-tile__state--quiet">
        {mine.name} · <strong>{ordinal(ahead + 1)}</strong> of{' '}
        {tug.sides.length} this week
        <span className="arena-tile__when">
          {' · '}
          {clashResolveCountdown(tug.week.endsAt)}
        </span>
      </p>
    );
  }

  // ---- THE PAIRING. Leading / trailing / level, off the average.
  const theirs = others[0];
  const diff = Number(mine.score) - Number(theirs.score);
  const level = Math.abs(diff) < 0.005;
  // GOLD IS FOR LEADING, and nothing else on this tile earns it — the same
  // discipline the Call's card keeps when it refuses to paint a paid-but-lost
  // entry as a win.
  const tone = level ? 'quiet' : diff > 0 ? 'win' : 'quiet';

  return (
    <p className={`arena-tile__state arena-tile__state--${tone}`}>
      {mine.code} <strong>{mine.score}</strong> — <strong>{theirs.score}</strong>{' '}
      {theirs.code}
      <span className="arena-tile__when">
        {' · '}
        {level ? 'level' : diff > 0 ? 'ahead' : 'behind'} on avg per active
      </span>
    </p>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
