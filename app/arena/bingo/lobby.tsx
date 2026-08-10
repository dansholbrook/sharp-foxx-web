'use client';

// ============================================================================
// THE LOBBY — everything that happens before the first ball.
//
// ============================================================================
// !!  THIS IS THE ONLY FILE IN THE BINGO BUILD CONTAINING A PURCHASE CONTROL,
// !!  AND THAT IS THE POINT. It is a separate file from the card, the caller and
// !!  the board so that "is there a buy button in this view" is answerable by
// !!  looking at the imports, not by reading a render tree for a conditional.
// !!
// !!  RULE 2: THE NEAR-MISS IS NEVER PLACED BESIDE A PURCHASE CONTROL.
// !!  patterns[].needed — "one from the blackout" — is honest information about
// !!  a card the fan already holds, and it is the tension the game is made of.
// !!  Next to a way to spend it becomes a near-win illusion driving a purchase,
// !!  which is the mechanic gambling regulators name, and it has a name because
// !!  it works.
// !!
// !!  THE PAGE RENDERS THIS COMPONENT ONLY WHILE night.called === 0, and it
// !!  passes `showRail={false}` to every card below. So there is no `needed`
// !!  anywhere on this screen — not suppressed by a flag, ABSENT. The other
// !!  branch, where `needed` lives, cannot reach this file.
// !!
// !!  DO NOT ADD A BUY BUTTON TO THE DRAWING BRANCH. Rule 1 (sales close when
// !!  the first ball is called) means the backend would refuse it anyway; the
// !!  layout must not be the thing relying on that.
// ============================================================================
//
// AN EMPTY CARD IS THE ANTICIPATION OBJECT, which is why the lobby renders full
// grids rather than a placeholder or a count. Twenty-five numbers nobody has
// called yet is the most hopeful thing this game ever shows, and it costs
// nothing extra — the card component already draws it.
//
// TWO COPY RULES, BOTH LOAD-BEARING, BOTH MARKED AT THEIR CALL SITES BELOW.
// They are the kind of thing that gets "improved" by someone optimising a
// funnel, and neither is a matter of taste.
// ============================================================================

import {
  bingoCallCountdown,
  etTime,
  points,
  BingoCard as BingoCardData,
  BingoClaim,
  BingoNight,
} from '../../api';
import { BingoCard } from './bingo-card';

export function Lobby({
  night,
  claim,
  cards,
  now,
  onClaim,
  claiming,
  claimError,
}: {
  night: BingoNight;
  claim: BingoClaim;
  cards: BingoCardData[];
  now: number;
  onClaim: (purchase: boolean) => void;
  claiming: 'free' | 'extra' | null;
  claimError: string | null;
}) {
  const full = claim.cardsHeld >= claim.maxCards;

  // ==========================================================================
  // THE FREE CARD IS A PREREQUISITE FOR A PAID ONE, AND canPurchase DOES NOT SAY
  // SO. The payload computes it as `purchaseOpen && cardsHeld < maxCards`, which
  // is true for a fan holding NOTHING — but claimCard's paid path refuses that
  // outright: "Take tonight's free card first -- it plays for exactly the same
  // prizes." Rendering the button off canPurchase alone offers a tap that always
  // 409s.
  //
  // `freeCardHeld` is on the wire for exactly this, so the gate is a field and
  // not an inference. And the rule it enforces is worth keeping visible: the
  // no-purchase-necessary arm is not merely available, it is UNSKIPPABLE — a fan
  // cannot reach the paid product without taking the free one first.
  // ==========================================================================
  const canBuy = claim.canPurchase && claim.freeCardHeld;

  // The window between purchase_closes_at and the first ball: sales are shut,
  // the night has not started, and the fan is holding fewer than three cards. A
  // real state, and it needs its own sentence rather than a vanished button.
  // Tested on canPurchase and not on canBuy — a fan who simply hasn't taken
  // their free card yet has nothing shut to them, and telling them so would be
  // both false and a nudge toward a spend.
  const salesShut = !claim.canPurchase && !full;

  return (
    <>
      <section className="bingo-lobby" aria-label="Tonight">
        <p className="bingo-lobby__start">
          Tonight&apos;s numbers start at{' '}
          <strong>{etTime(night.firstDrawAt, { zone: true })}</strong>
          <span className="bingo-lobby__in">
            {' · '}
            {bingoCallCountdown(night.firstDrawAt, now)}
          </span>
        </p>

        {/* THE TERMS, STATED BEFORE ANYTHING IS SPENT. Every one of these is a
            per-night snapshot rather than a live config read: a fan holding a
            card was promised 56 balls and this jackpot, and an admin edit at
            21:00 changes tomorrow's night, never tonight's. */}
        <dl className="bingo-terms">
          <div className="bingo-terms__row">
            <dt>The draw</dt>
            <dd>
              {night.drawCount} numbers · {night.drawsPerTick} every{' '}
              {night.tickIntervalMinutes} minutes
            </dd>
          </div>
          <div className="bingo-terms__row">
            <dt>Line</dt>
            <dd>{points(night.payouts.line)} pts</dd>
          </div>
          <div className="bingo-terms__row">
            <dt>Four corners</dt>
            <dd>{points(night.payouts.four_corners)} pts</dd>
          </div>
          <div className="bingo-terms__row">
            <dt>Blackout</dt>
            <dd>{points(night.payouts.blackout)} pts</dd>
          </div>
        </dl>

        {/* THE FREE ARM IS EQUAL AND SAYS SO. This is not marketing — it is the
            one thing that has to be true under a no-purchase-necessary
            framework, and it is true only because rule 1 closes sales before the
            first ball. Every card in this night faces the same numbers. */}
        <p className="bingo-lobby__equal">
          Every card tonight faces the same {night.drawCount} numbers — the free
          one included.
        </p>
      </section>

      {cards.length > 0 && (
        <div className="bingo-cards">
          {cards.map((card) => (
            <BingoCard
              key={card.id}
              card={card}
              status={night.status}
              // NO RAIL IN THE LOBBY. See this file's header — the argument is
              // the whole reason this branch exists.
              showRail={false}
            />
          ))}
        </div>
      )}

      <section className="bingo-claim" aria-label="Your cards">
        {claim.canClaimFree && (
          <button
            type="button"
            className="bingo-btn bingo-btn--free"
            onClick={() => onClaim(false)}
            disabled={claiming !== null}
          >
            <span className="bingo-btn__verb">
              {claiming === 'free' ? 'Taking…' : 'Take tonight’s free card'}
            </span>
            <span className="bingo-btn__sub">Free, once a night</span>
          </button>
        )}

        {canBuy && (
          <button
            type="button"
            className="bingo-btn bingo-btn--extra"
            onClick={() => onClaim(true)}
            disabled={claiming !== null}
          >
            {/* ==================================================
                COPY RULE: THE PRICE IS NEVER PHRASED AGAINST A PAYOUT.
                "Add a card · 50 pts" — never "50 pts for a shot at 1,000".
                The schema's own arithmetic is that an extra card costs 50
                against ~32 points of expected value, a ~35% rake, and that
                extras are a deliberate points SINK: a fan who buys both
                extras ends up slightly WORSE off in expectation than one who
                takes only the free card. They are buying jackpot chances, not
                expected points. Copy that implies otherwise sells a thing the
                maths says is not there.
                ================================================== */}
            <span className="bingo-btn__verb">
              {claiming === 'extra'
                ? 'Adding…'
                : `Add a card · ${points(claim.extraCardCost)} pts`}
            </span>
            <span className="bingo-btn__sub">
              Another card in tonight&apos;s draw
            </span>
          </button>
        )}

        {full && (
          <p className="bingo-claim__note">
            You&apos;re holding all {claim.maxCards}.
          </p>
        )}

        {salesShut && (
          <p className="bingo-claim__note">Extra cards are closed for tonight.</p>
        )}

        {/* ======================================================
            COPY RULE: purchaseClosesAt IS STATED AND NEVER COUNTED DOWN.
            The time, once, in ordinary type. A ticking clock on a spending
            deadline is a pressure device — it is the only countdown this
            surface could carry that would be one, and every other clock here
            is an ARRIVAL (the balls come whether or not anyone is watching).
            Do not "improve" this into bingoCallCountdown, do not give it
            urgency styling, and do not push a notification off it.
            ====================================================== */}
        {canBuy && (
          <p className="bingo-claim__closes">
            Extra cards close at {etTime(claim.purchaseClosesAt, { zone: true })}.
          </p>
        )}

        {claimError && <p className="bingo-claim__error">{claimError}</p>}
      </section>
    </>
  );
}
