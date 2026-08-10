'use client';

// ============================================================================
// THE CARD — a 5x5 grid, the free centre, and what the card has done so far.
//
// DESIGNED AT 390px AND ADAPTED UP, NOT THE OTHER WAY ROUND. A 5x5 grid plus a
// call board is the hardest layout on this platform to fit on a phone, and it is
// the one surface where retrofitting would mean rebuilding. The base CSS IS the
// phone: five `minmax(0, 1fr)` tracks land ~58px squares inside the page's
// padding, comfortably past the 44px tap floor, and two digits sit in that with
// room. The only breakpoint caps the grid so squares stop growing into slabs on
// a desktop — the phone never pays for the desktop case. Same discipline
// .sqgrid already states for the squares board, which does this at TEN columns.
//
// THE B-I-N-G-O HEADER IS PART OF THE SAME GRID, as a sixth row of header cells
// rather than a flex row above it. Against `fr` tracks at fractional pixel
// widths a separate row drifts, and a header that doesn't sit over its column is
// worse than no header at all.
//
// THE DAUB IS INK ON THE NUMBER, NOT A REPLACEMENT FOR IT. A gold disc under the
// digits with the digits reversed to --accent-text: the dark-on-gold flip the
// app already uses for primary buttons, which is the loudest signal the palette
// contains and costs no new colour. The number stays readable under the daub
// because that is what a hall card looks like.
//
// NOTHING HERE IS TAPPABLE. drizzle/arena_bingo.sql is explicit that the fan
// never writes `marks` — the mark is (this card's numbers) INTERSECT (tonight's
// called balls) and re-derives identically on any re-run. A tap-to-daub control
// would be a control that changes nothing on a card whose marks are already
// correct, which teaches the fan their tap matters on a pure chance game. The
// theatre is the four-ball reveal in the caller; this grid does not need a
// second one.
// ============================================================================

import {
  bingoNumberLabel,
  bingoPatternLabel,
  points,
  BingoCard as BingoCardData,
  BingoCardPattern,
  BingoNightStatus,
  BINGO_COLUMNS,
  BINGO_FREE_INDEX,
} from '../../api';

// ---------------------------------------------------------------------------
// THE ONE SQUARE A BLACKOUT WANTS.
//
// Only meaningful at needed === 1, where by construction exactly one of the 25
// is unmarked. Returns null otherwise rather than "the first gap", so a caller
// that forgets the guard draws no ring instead of the wrong one.
// ---------------------------------------------------------------------------
function soleUnmarkedIndex(daubed: boolean[]): number | null {
  let found = -1;
  for (let i = 0; i < daubed.length; i += 1) {
    if (!daubed[i]) {
      if (found !== -1) return null;
      found = i;
    }
  }
  return found === -1 ? null : found;
}

function patternOf(
  card: BingoCardData,
  pattern: BingoCardPattern['pattern'],
): BingoCardPattern | null {
  return card.patterns.find((p) => p.pattern === pattern) ?? null;
}

// ---------------------------------------------------------------------------
// THE GRID
// ---------------------------------------------------------------------------
function Grid({
  card,
  ringIndex,
}: {
  card: BingoCardData;
  // The blackout's last square, or null. Passed in rather than computed here so
  // the STATE RULE that governs it (drawing only, blackout only) lives in one
  // place — see the rail below.
  ringIndex: number | null;
}) {
  // Which squares belong to a pattern that has already PAID. The predict/won
  // green is the app's only non-gold "good" and it is already reused by
  // .sqgrid-cell--won for exactly this reading; a blackout that landed paints
  // the whole card, which is the correct amount of loud for 1 in 5,919.
  const blackout = patternOf(card, 'blackout');
  const paidOut = blackout?.awardedAt != null;

  return (
    <div
      className={`bingo-grid${paidOut ? ' bingo-grid--blackout' : ''}`}
      role="img"
      aria-label={`Card ${card.cardIndex + 1}: ${card.called} of 24 squares marked`}
    >
      {BINGO_COLUMNS.map((letter) => (
        <span key={letter} className="bingo-grid__head" aria-hidden="true">
          {letter}
        </span>
      ))}

      {card.numbers.map((n, i) => {
        const free = i === BINGO_FREE_INDEX;
        const daubed = card.daubed[i] === true;
        const ringed = i === ringIndex;
        return (
          <span
            key={i}
            className={[
              'bingo-sq',
              free ? 'bingo-sq--free' : '',
              daubed ? 'bingo-sq--daubed' : '',
              ringed ? 'bingo-sq--wanted' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          >
            {free ? 'Free' : n}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE RAIL — what this card has done.
//
// ===========================================================================
// !!  RULE 2: THE NEAR-MISS IS NEVER PLACED BESIDE A PURCHASE CONTROL.
// !!
// !!  This whole component is gated by the page on `night.called > 0`. Not on
// !!  `!claim.canPurchase` — on a DIFFERENT FIELD, with a STRICTER condition,
// !!  so the layout does not rely on rule 1 holding. The backend already
// !!  guarantees the two cannot coexist (today() derives both from one clock
// !!  read); this is the client's own brace, and it survives anyone who later
// !!  "improves" sales into staying open mid-night.
// !!
// !!  If you are adding a buy button, it does not go on this screen. It goes in
// !!  the lobby, which is a different render branch entirely, and which cannot
// !!  reach this component because `called` is 0 there.
// ===========================================================================
//
// A LIVE CARD AND A DEAD CARD ARE NOT THE SAME OBJECT, and this is the rule the
// whole rail turns on: SHOWING A LIVE CARD'S STATE IS HONEST; NARRATING A DEAD
// CARD'S STATE IS MANIPULATION.
//
// While the balls are in the air, "one from blackout" is a fact about a card the
// fan is holding and can still act on by watching. Once the night settles it is
// a fact about nothing — 1 in 690 cards ends exactly one square short, and
// telling that fan "so close" when there is nothing left to play for has one
// function only: making them come back tomorrow feeling owed. That is the
// near-win illusion with the game removed. So `needed` DIES AT SETTLED. The
// settled rail shows what paid and nothing else.
// ---------------------------------------------------------------------------
function Rail({
  card,
  status,
}: {
  card: BingoCardData;
  status: BingoNightStatus;
}) {
  const live = status === 'drawing';

  // ---- SETTLED: awards only. No counts, no rings, no "you were close". -----
  if (!live) {
    const won = card.patterns.filter((p) => p.complete);
    if (won.length === 0) {
      // Plain, and deliberately not consoling. A card that paid nothing is an
      // ordinary outcome of a game of chance, and dressing it as a near-thing
      // would be the same illusion by a softer route.
      return (
        <p className="bingo-rail__none">Nothing landed on this card tonight.</p>
      );
    }
    return (
      <ul className="bingo-rail">
        {won.map((p) => (
          <li key={p.pattern} className="bingo-chip bingo-chip--won">
            <span className="bingo-chip__name">
              {bingoPatternLabel(p.pattern)}
            </span>
            {/* pointsAwarded, never the pattern's list price: a pattern can be
                priced at 0 ("recognised but pays nothing") and would then read
                as an unpaid win. */}
            {p.pointsAwarded !== null && p.pointsAwarded > 0 && (
              <span className="bingo-chip__pts">+{points(p.pointsAwarded)}</span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  // ---- DRAWING: state per pattern, including how far short. ----------------
  return (
    <ul className="bingo-rail">
      {card.patterns.map((p) => {
        const paid = p.awardedAt != null;
        return (
          <li
            key={p.pattern}
            className={`bingo-chip${
              p.complete ? ' bingo-chip--won' : ''
            }${!p.complete && p.pattern === 'blackout' && p.needed === 1 ? ' bingo-chip--wanted' : ''}`}
          >
            <span className="bingo-chip__name">
              {bingoPatternLabel(p.pattern)}
            </span>
            {p.complete ? (
              paid && p.pointsAwarded !== null && p.pointsAwarded > 0 ? (
                <span className="bingo-chip__pts">
                  +{points(p.pointsAwarded)}
                </span>
              ) : (
                <span className="bingo-chip__state">complete</span>
              )
            ) : (
              // THE COUNT, FLAT. No urgency styling that scales as it falls, and
              // no "only N to go" — see the ring below for the one affordance
              // this number is allowed to have.
              <span className="bingo-chip__state">
                {p.needed} away
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// THE CARD BLOCK
// ---------------------------------------------------------------------------
export function BingoCard({
  card,
  status,
  // The page's gate. TRUE ONLY WHEN A BALL HAS BEEN CALLED — see the Rail's
  // header. A card in the lobby renders as a grid and nothing else, which is
  // also the better object there: an empty card is the anticipation.
  showRail,
}: {
  card: BingoCardData;
  status: BingoNightStatus;
  showRail: boolean;
}) {
  const blackout = patternOf(card, 'blackout');

  // ===========================================================================
  // THE ONE AFFORDANCE THE NEAR-MISS GETS, AND ITS THREE LIMITS.
  //
  // At one square from a blackout, ring THAT SQUARE. "1 away" is a sentence
  // about arithmetic; what is actually happening is that one specific square on
  // the card in front of the fan is bare and every remaining ball is a coin flip
  // on it. Pointing at it is showing the fan their own card.
  //
  //   * STATIC. A 1px outline, no fill, no pulse, no glow, no shake, and
  //     nothing that intensifies as `needed` falls. A static ring is a fact; a
  //     pulsing ring is a slot machine, and escalating animation is the near-win
  //     illusion drawn as a feeling.
  //   * BLACKOUT ONLY. A line hits ~95% of cards, so "one from a line" is not
  //     news. Four corners at ~30% is real, but ringing two corners as well puts
  //     three competing rings on one grid and turns the card into a demand list.
  //   * DRAWING ONLY. Dead at settled, with the rest of `needed`. See the Rail.
  //
  // It names a NUMBER, NOT AN ACTION. There is nothing to tap, nothing to buy
  // (rule 1 closed sales before the first ball, and rule 2's gate is stricter
  // still), and no count of the balls left to hit it — that last one would turn
  // a fact into suspense priced per tick.
  // ===========================================================================
  const wanted =
    showRail &&
    status === 'drawing' &&
    blackout !== null &&
    !blackout.complete &&
    blackout.needed === 1
      ? soleUnmarkedIndex(card.daubed)
      : null;

  return (
    <section className="bingo-card">
      <header className="bingo-card__head">
        <span className="bingo-card__index">
          {card.source === 'free' ? 'Your free card' : `Card ${card.cardIndex + 1}`}
        </span>
        {/* THE LATE-CARD EXPLANATION, and the only reason issuedAtSlot is on the
            wire: the free card stays claimable all night, so a fan who arrives
            at 21:00 holds a card that will never fill as far as one taken at
            19:00. Stated on the card rather than left to be discovered. */}
        {card.issuedAtSlot > 0 && (
          <span className="bingo-card__late">
            Taken after {card.issuedAtSlot} call
            {card.issuedAtSlot === 1 ? '' : 's'}
          </span>
        )}
      </header>

      <Grid card={card} ringIndex={wanted} />

      {wanted !== null && (
        // The ring's sentence. It says which ball, because the ring alone is a
        // pointer without a name — and a fan looking at a phone should not have
        // to hunt the grid for the one square that isn't gold.
        <p className="bingo-wanted">
          One from blackout — you need{' '}
          <strong>{bingoNumberLabel(card.numbers[wanted])}</strong>.
        </p>
      )}

      {showRail && <Rail card={card} status={status} />}
    </section>
  );
}
