'use client';

// ============================================================================
// THE PROSPECT MARKET — the band a fan drafts from, and today the only state
// of this game that exists.
//
// TWO DIFFERENT NOTHINGS, AND THEY MUST NOT SHARE A SCREEN.
//
//   not_started  — no season is running. The game has not begun.
//   empty        — a season IS running and no athlete is eligible yet.
//
// These feel completely different to a fan and only one of them is the
// compliance story. The API cannot currently tell them apart on its own —
// `?season=anything` answers 200 with an empty list — so the caller decides,
// off ScoutBook.season, and passes the verdict in. A market that guessed would
// eventually render "the eligibility rule is working" over what was really a
// typo, which is a false statement about a rule protecting real people.
//
// THE CHIPS ARE HIDDEN WHEN THERE ARE NO CARDS. Five sport filters over an
// empty grid is the single most "this is broken" thing this screen could do,
// and it invites a fan to tap four more times to confirm the same emptiness.
// Filters appear when there is something to filter.
// ============================================================================

import Link from 'next/link';
import {
  SCOUT_STAT_KINDS,
  ScoutMarketCard,
  scoutStatKindLabel,
  scoutTierLabel,
} from '../../api';

export type MarketState = 'not_started' | 'empty' | 'ok' | 'loading' | 'failed';

export function ProspectMarket({
  state,
  cards,
  statKind,
  onStatKind,
  inBook,
  onDraft,
  drafting,
  bookFull,
  actionError,
}: {
  state: MarketState;
  cards: ScoutMarketCard[];
  statKind: string | null;
  onStatKind: (next: string | null) => void;
  inBook: Set<string>;
  onDraft: (cardId: string) => void;
  drafting: string | null;
  bookFull: boolean;
  actionError: string | null;
}) {
  return (
    <section className="scout-market" aria-labelledby="scout-market-h">
      <h2 className="scout-band__title" id="scout-market-h">
        The Prospect Market
      </h2>

      {/* The chips only exist when they have something to do. */}
      {state === 'ok' && cards.length > 0 && (
        <div className="scout-chips" role="group" aria-label="Filter by sport">
          <button
            type="button"
            className={`chip${statKind === null ? ' chip--on' : ''}`}
            onClick={() => onStatKind(null)}
          >
            All
          </button>
          {SCOUT_STAT_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`chip${statKind === k.id ? ' chip--on' : ''}`}
              onClick={() => onStatKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {actionError && <p className="scout-error">{actionError}</p>}

      {state === 'loading' && (
        <p className="scout-quiet">Reading the market…</p>
      )}

      {state === 'failed' && (
        <div className="results-empty">
          <p className="results-empty__title">Couldn&rsquo;t reach the market</p>
          <p className="results-empty__hint">
            That&rsquo;s a fault on our side, not an empty market. Reload to try
            again.
          </p>
        </div>
      )}

      {state === 'not_started' && <MarketNotStarted />}
      {state === 'empty' && <MarketEmpty />}

      {state === 'ok' && cards.length === 0 && statKind !== null && (
        <div className="results-empty">
          <p className="results-empty__title">
            No {scoutStatKindLabel(statKind).toLowerCase()} prospects yet
          </p>
          <p className="results-empty__hint">
            Other sports have cards on the board — clear the filter to see them.
          </p>
        </div>
      )}

      {state === 'ok' && cards.length > 0 && (
        <ul className="scout-cards">
          {cards.map((c) => (
            <MarketRow
              key={c.id}
              card={c}
              held={inBook.has(c.id)}
              onDraft={onDraft}
              drafting={drafting === c.id}
              bookFull={bookFull}
            />
          ))}
        </ul>
      )}

      <FootNote />
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE EMPTY MARKET. Today this is the entire game, so it gets the weight of a
// screen rather than the grey stub used for a transient miss.
//
// THIS COPY IS LOAD-BEARING AND HAS BEEN SIGNED OFF — do not soften it into an
// apology on a later pass. "The market is empty, and that is the rule working"
// is the frame: the emptiness is a compliance rule succeeding, not a shortfall,
// and a screen that says sorry for it teaches a fan that eligibility is
// friction. It is the most defensible property this product has and it reads as
// deliberate.
// ---------------------------------------------------------------------------
function MarketEmpty() {
  return (
    <div className="scout-empty">
      <p className="scout-empty__title">
        The market is empty, and that is the rule working.
      </p>
      <p className="scout-empty__body">
        The Scout Book covers JUCO, NAIA, D-II and D-III athletes who have opted
        in &mdash; and only those. Every athlete on the platform today plays at a
        D-I school, which the Scout Book excludes on purpose.
      </p>
      <p className="scout-empty__body">
        No card is filed until a correspondent files one and the athlete has
        agreed to be scouted. Both, every time.
      </p>
    </div>
  );
}

// The other nothing. Same treatment, different fact — and it deliberately does
// NOT recite the eligibility rule, because no rule has excluded anybody yet.
function MarketNotStarted() {
  return (
    <div className="scout-empty">
      <p className="scout-empty__title">The season hasn&rsquo;t opened yet.</p>
      <p className="scout-empty__body">
        No Scout Book week is running, so there is nothing to draft and no book
        to keep. When the first week opens, the market fills with prospects our
        correspondents have scouted and who have agreed to take part.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A MARKET ROW. Name, school, tier, position, the correspondent's note and the
// byline that makes the note somebody's judgement rather than a system's rating.
//
// WHAT IS NOT HERE: `card.heldBy`. See the field's comment in api.ts — a live
// count of strangers holding a teenager is a pressure display with no upside to
// them. It is on the payload and it stays off the screen.
//
// AND NO JERSEY BLOCK. The spec's colour-and-number jersey has no data behind
// it: there is no jersey number and no colour anywhere in the API, and picking
// one per athlete would be inventing an attribute and attaching it to a real
// named person.
// ---------------------------------------------------------------------------
function MarketRow({
  card,
  held,
  onDraft,
  drafting,
  bookFull,
}: {
  card: ScoutMarketCard;
  held: boolean;
  onDraft: (cardId: string) => void;
  drafting: boolean;
  bookFull: boolean;
}) {
  const name = `${card.firstName} ${card.lastName}`;
  return (
    <li className="scout-card">
      <Link href={`/arena/scout/${card.id}`} className="scout-card__main">
        <span className="scout-card__name">{name}</span>
        <span className="scout-card__meta">
          {[card.school, scoutTierLabel(card.tier), scoutStatKindLabel(card.statKind), card.position]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="scout-card__note">
          &ldquo;{card.scoutingNote}&rdquo;
          {card.scoutedBy && (
            <span className="scout-card__by"> &mdash; {card.scoutedBy}</span>
          )}
        </span>
      </Link>
      <div className="scout-card__action">
        {held ? (
          <span className="scout-card__held">In your book</span>
        ) : (
          <button
            type="button"
            className="chip"
            onClick={() => onDraft(card.id)}
            // A full book disables the button rather than hiding it, and the
            // book band above already says 5 of 5 — so the reason is on screen
            // and this doesn't have to explain itself in a tooltip nobody taps.
            disabled={drafting || bookFull}
          >
            {drafting ? 'Drafting…' : 'Draft'}
          </button>
        )}
      </div>
    </li>
  );
}

// The standing rules. Present in every state INCLUDING the empty ones, because
// on an empty market this is the only thing explaining what the market is for.
function FootNote() {
  return (
    <p className="scout-foot">
      <strong>College athletes 18+, opted in.</strong> Positive-only scoring
      &mdash; the worst week a prospect can have is 0. A card can be held by any
      number of scouts. No trading, no cash value. An athlete can stop taking
      part at any time; their card closes and holders keep the points they
      earned.
    </p>
  );
}
