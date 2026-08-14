'use client';

// ============================================================================
// MY BOOK — the fan's five slots.
//
// IT SITS ABOVE THE MARKET, inverting the spec's order. The spec leads with the
// market because the spec's market has seven cards in it; ours has none, and a
// page opening on an empty grid reads as broken before the fan reaches anything
// true. The book is always a real thing to look at, even at 0 of 5.
//
// EMPTY SLOTS ARE DASHED AND NUMBERED AND CARRY NO CALL TO ACTION when there is
// nowhere to go. The spec makes each empty slot a button to the market; with an
// empty market that is a button to a disappointment.
// ============================================================================

import Link from 'next/link';
import {
  ScoutBook,
  ScoutSlot,
  scoutStatKindLabel,
} from '../../api';

export function BookBand({
  book,
  loading,
  failed,
  marketHasCards,
  onDrop,
  dropping,
}: {
  book: ScoutBook | null;
  loading: boolean;
  failed: boolean;
  marketHasCards: boolean;
  onDrop: (cardId: string) => void;
  dropping: string | null;
}) {
  const slotsTotal = book?.slotsTotal ?? 5;
  const slots: ScoutSlot[] = book && book.season !== null ? book.slots : [];
  const used = slots.length;

  return (
    <section className="scout-book" aria-labelledby="scout-book-h">
      <div className="scout-band__head">
        <h2 className="scout-band__title" id="scout-book-h">
          My book
        </h2>
        {!loading && !failed && (
          <span className="scout-band__count">
            {used} of {slotsTotal}
          </span>
        )}
      </div>

      {loading && <p className="scout-quiet">Reading your book…</p>}

      {failed && (
        <p className="scout-quiet">
          Couldn&rsquo;t reach your book. Reload to try again.
        </p>
      )}

      {!loading && !failed && book && (
        <>
          {/* THE NARROWING THAT MATTERS. The no-season branch OMITS
              `loyalty`, `swapWindow`, `swapAvailable` and `slotsUsed`
              entirely — reading book.loyalty.weeks on it throws rather than
              reading undefined. Everything below this line is inside the
              narrowed branch for that reason. */}
          {book.season !== null && <SwapLine book={book} />}

          {/* THE SAME NARROWING, ONE LEVEL DOWN. The slot list needs
              `book.loyalty` for the countdown chip, and that field only exists
              on the in-season arm — so the list is rendered inside the narrowing
              rather than handed a fabricated { weeks: 0 } default. On the
              no-season arm `slots` is [] anyway, so the branch below renders the
              empty-slot placeholders and nothing is lost.

              A DEFAULT WOULD HAVE BEEN THE BUG THIS UNION EXISTS TO PREVENT:
              "×1.2 in 0 weeks" on a book with no season is a promise about a
              week that does not exist. */}
          <ol className="scout-slots">
            {book.season !== null && slots.map((s) => (
              <FilledSlot
                key={s.slotId}
                slot={s}
                // The threshold and the rate, off the WIRE rather than written
                // down here: they are the book's terms, and a countdown that
                // hardcoded 4 would start lying the day the house retunes.
                loyalty={book.loyalty}
                swapOpen={book.season !== null && book.swapWindowOpen}
                swapAvailable={book.season !== null ? book.swapAvailable : 0}
                onDrop={onDrop}
                dropping={dropping === s.prospectCardId}
              />
            ))}
            {Array.from({ length: Math.max(0, slotsTotal - used) }).map((_, i) => (
              <EmptySlot
                key={`open-${i}`}
                n={used + i + 1}
                linked={marketHasCards}
              />
            ))}
          </ol>

          {book.season === null && (
            <p className="scout-foot">
              Slots open when the first week does. Nothing is lost in the
              meantime &mdash; there is no season to be behind in.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// The swap rules, stated only when there is a season to state them about.
function SwapLine({ book }: { book: Extract<ScoutBook, { season: string }> }) {
  return (
    <p className="scout-swapline">
      Week {book.week} ·{' '}
      {book.swapWindowOpen ? (
        book.swapAvailable > 0 ? (
          <>
            swap window open &mdash;{' '}
            <strong>
              {book.swapAvailable} swap{book.swapAvailable === 1 ? '' : 's'}
            </strong>{' '}
            available
          </>
        ) : (
          <>swap window open &mdash; no swap left this week</>
        )
      ) : (
        <>swap window closed &mdash; it reopens Monday</>
      )}
      {' · '}
      hold {book.loyalty.weeks} weeks for &times;{book.loyalty.multiplier}
    </p>
  );
}

function FilledSlot({
  slot,
  loyalty,
  swapOpen,
  swapAvailable,
  onDrop,
  dropping,
}: {
  slot: ScoutSlot;
  loyalty: { weeks: number; multiplier: number };
  swapOpen: boolean;
  swapAvailable: number;
  onDrop: (cardId: string) => void;
  dropping: boolean;
}) {
  const name = `${slot.firstName} ${slot.lastName}`;
  const closed = slot.status === 'retired';
  // THE SAME SUBTRACTION THE SCORER USES, which is what keeps the countdown and
  // the payout from ever disagreeing by a week. `weeksHeld` is
  // currentWeekNo - draftedWeekNo, computed server-side; loyalty lands when it
  // REACHES the threshold, so a week-1 pick is held 4 weeks in week 5 and first
  // scores at ×1.2 there — not in week 4. Clamped at 1 because a slot that is
  // one week short must never render "in 0 weeks" while still un-loyal.
  const weeksToLoyalty = Math.max(1, loyalty.weeks - slot.weeksHeld);

  return (
    <li className={`scout-slot scout-slot--filled${closed ? ' scout-slot--closed' : ''}`}>
      <Link href={`/arena/scout/${slot.prospectCardId}`} className="scout-slot__main">
        <span className="scout-slot__name">{name}</span>
        <span className="scout-slot__meta">
          {[slot.school, scoutStatKindLabel(slot.statKind), slot.position]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="scout-slot__chips">
          <span className="scout-tag">
            Held {slot.weeksHeld} week{slot.weeksHeld === 1 ? '' : 's'}
          </span>
          {/* ---------------------------------------------------------------
              THE ×1.2 CHIP APPEARS ONLY WHEN IT IS TRUE, AND THERE IS STILL NO
              ×1.0. The spec renders a "×1.0" chip on every un-loyal holding. A
              badge whose content is "you get nothing extra" is a deduction
              wearing a multiplier's clothes, and this game does not have
              deductions — the worst week is zero, by rule. Absence of a bonus is
              not a penalty and must not be given a pill to sit in.

              THAT RULE IS INTACT. THE COUNTDOWN IS NOT AN EXCEPTION TO IT, and
              the distinction is the whole reason the chip below is allowed:

                "×1.0"          states a NIL RETURN as though it were a rate.
                                It describes the present and describes it as a
                                shortfall.
                "×1.2 in 2 wks" states a PROMISE, with the date it lands. It
                                describes the future and describes it as a gain.

              Same pill, opposite sentence. A fan reading "×1.0" learns they are
              getting nothing; a fan reading "×1.2 in 2 weeks" learns what to
              hold for. Do not read this as the ×1.0 rule having been abandoned —
              it would still be refused today.
              --------------------------------------------------------------- */}
          {slot.loyal ? (
            <span className="scout-tag scout-tag--gold">
              &times;{slot.multiplier} loyal
            </span>
          ) : (
            <span className="scout-tag scout-tag--wait">
              &times;{loyalty.multiplier} in {weeksToLoyalty}{' '}
              {weeksToLoyalty === 1 ? 'week' : 'weeks'}
            </span>
          )}
          {slot.status === 'called_up' && (
            <span className="scout-tag scout-tag--gold">Called up</span>
          )}
          {closed && <span className="scout-tag scout-tag--closed">Card closed</span>}
        </span>
      </Link>

      {/* A closed card cannot be swapped away — there is nothing to spend a
          swap on, and charging one to tidy up a withdrawal would bill the fan
          for someone else's decision. It leaves the book when the season does. */}
      {!closed && (
        <div className="scout-slot__action">
          <button
            type="button"
            className="chip"
            onClick={() => onDrop(slot.prospectCardId)}
            disabled={dropping || !swapOpen || swapAvailable < 1}
          >
            {dropping ? 'Swapping…' : 'Swap'}
          </button>
        </div>
      )}
    </li>
  );
}

function EmptySlot({ n, linked }: { n: number; linked: boolean }) {
  const label = (
    <>
      <span className="scout-slot__n">{n}</span>
      <span className="scout-slot__open">Open slot</span>
    </>
  );

  // Only a link when the market can actually answer it.
  if (!linked) {
    return <li className="scout-slot scout-slot--open">{label}</li>;
  }
  return (
    <li className="scout-slot scout-slot--open">
      <Link href="#scout-market-h" className="scout-slot__main scout-slot__main--open">
        {label}
        <span className="scout-slot__cta">Draft from the market</span>
      </Link>
    </li>
  );
}
