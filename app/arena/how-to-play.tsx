'use client';

// ============================================================================
// HOW TO PLAY — the reference panel every Arena game carries.
//
// ----------------------------------------------------------------------------
// WHY IT EXISTS. A fan opening Bureau Clash could not learn what a bye pays.
// The number is in arena_rewards, the rule is in the resolver, and neither is
// anywhere a fan can read. That is the general shape: five games pay about
// twenty different things and the pages said almost none of it.
//
// ----------------------------------------------------------------------------
// IT DOES NOT REPLACE THE PAGE'S STANDFIRST, and the split is deliberate:
//
//   .page-rules  is the PITCH. One line, at the top, where someone decides
//                whether to play at all. "One call a day from the house engine."
//   this panel   is the REFERENCE. What things pay, read when confused, which
//                is not most visits.
//
// So it sits LOW on the page — after the game, before the compliance fineprint
// — and it is collapsed by default. A fan who wants to play is never made to
// scroll past the rules to reach the game.
//
// ----------------------------------------------------------------------------
// <details>, NOT A useState TOGGLE. This is the first expander on the platform,
// so it sets the precedent: the native element is keyboard-operable, announced
// correctly by screen readers, works with JavaScript off, and survives a
// re-render without state. A hand-rolled toggle would be more code and less
// accessible. If a second expander ships, copy this.
//
// ----------------------------------------------------------------------------
// NO BETTING WORDS. Not "odds", "line", "bet", "wager", "stake" or "book". This
// is a points game for a college-sports audience that includes minors, and the
// vocabulary is the product's position on what it is. `dl`/`dt`/`dd` rather than
// a table for the same reason the copy is short: a payout list read on a phone
// is a set of term-and-value pairs, not a grid.
// ============================================================================

import { ReactNode } from 'react';

export function HowToPlay({
  short,
  children,
}: {
  // The one line that is always visible. Says the shape of the game, not its
  // numbers — the numbers are what the expander is for.
  short: ReactNode;
  // The full rules. Written as <Pays> rows plus <p> notes by every caller.
  children: ReactNode;
}) {
  return (
    <section className="htp" aria-labelledby="htp-h">
      <h2 className="htp__title" id="htp-h">
        How to play
      </h2>
      <p className="htp__short">{short}</p>
      <details className="htp__more">
        {/* The marker is drawn by CSS from the open state, so the label never
            has to say "show"/"hide" and never falls out of step with it. */}
        <summary className="htp__toggle">All the rules and what they pay</summary>
        <div className="htp__body">{children}</div>
      </details>
    </section>
  );
}

// One payout: what it is, and what it pays. A definition list because that is
// what this is — the alternative, a two-column table, wraps badly at 390px and
// the label is not a column heading in any useful sense.
export function Pays({ what, value }: { what: ReactNode; value: ReactNode }) {
  return (
    <div className="htp__pay">
      <dt className="htp__paywhat">{what}</dt>
      <dd className="htp__payval">{value}</dd>
    </div>
  );
}

// The wrapper for a run of <Pays>. Exported separately so a caller can put
// prose between two groups of payouts without nesting lists.
export function PaysList({ children }: { children: ReactNode }) {
  return <dl className="htp__pays">{children}</dl>;
}
