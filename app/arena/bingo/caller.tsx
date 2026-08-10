'use client';

// ============================================================================
// THE CALLER — the last tick, and when the next one lands.
//
// THE HEARTBEAT, AND THEREFORE THE LEAD BLOCK. A fan checking back between
// innings came for exactly one thing: what got called. So the newest ball is the
// biggest object on the screen and its flavour line sits under it, with the
// other three from the same tick beside it.
//
// FOUR AT A TIME IS THE PRODUCT, NOT AN IMPLEMENTATION DETAIL, and the block is
// built around the TICK rather than around the ball. P(a single ball lands on a
// given card) is 24/75, so at one-at-a-time two thirds of return visits would
// show a card that did not move; at four, 79% show at least one new mark. The
// tick is the reveal moment and the slot is the ball — grouping them here is
// what makes a return worth its cost.
//
// THE COUNTDOWN IS AN ARRIVAL, NEVER A DEADLINE. Every other clock in the Arena
// counts down to a lock the fan has to beat. Nothing here expires: the balls come
// whether or not anyone is watching, and the free card stays claimable all night.
// bingoCallCountdown reads "in 6m", not "Locks in 6m", and it never goes urgent —
// dressing an arrival as a deadline manufactures a reason to sit on the page,
// which is the one thing the 20-minute cadence was chosen to prevent.
// ============================================================================

import { ReactNode } from 'react';
import {
  bingoCallCountdown,
  bingoTickOf,
  etTime,
  BingoBall,
  BingoNight,
} from '../../api';

// The balls that landed together in the newest tick, newest first. `balls`
// arrives slot-descending from the server, so the head of the array is the most
// recent call and everything sharing its tick is what the fan just watched land.
function latestTick(balls: BingoBall[], drawsPerTick: number): BingoBall[] {
  if (balls.length === 0) return [];
  const tick = bingoTickOf(balls[0].slotIndex, drawsPerTick);
  return balls.filter((b) => bingoTickOf(b.slotIndex, drawsPerTick) === tick);
}

export function Caller({
  night,
  balls,
  now,
  // The free-card claim, when the fan is watching without one. IT LIVES HERE AND
  // NOT BESIDE A CARD, deliberately: a free claim is not the regulated mechanic
  // (there is no consideration in it), but it still has no business sitting next
  // to a near-miss count. Up here it is physically above every grid and every
  // rail on the page, and it disappears the moment a card exists.
  claim,
}: {
  night: BingoNight;
  balls: BingoBall[];
  now: number;
  claim: ReactNode;
}) {
  const tick = latestTick(balls, night.drawsPerTick);
  const [newest, ...rest] = tick;

  return (
    <section className="bingo-caller" aria-label="The call">
      {newest ? (
        <>
          <div className="bingo-caller__now">
            {/* KEYED BY SLOT so a new tick REMOUNTS the node and the entrance
                animation replays — without it React reuses the element and only
                the text changes, which is a jump-cut where the schema asked for
                a sequence. The stagger runs newest-first: the fan's eye is
                already here, and the three that follow fill in beside it. */}
            <span
              key={newest.slotIndex}
              className="bingo-ball bingo-ball--newest"
              style={{ ['--call-i' as string]: 0 }}
            >
              {newest.label}
            </span>
            <div className="bingo-caller__said">
              {/* THE FLAVOUR IS DECORATION AND IT CAN BE NULL — "the number is
                  the fact; the sentence is decoration. A null flavour still
                  commits the ball." So there is no fallback sentence invented
                  here: the ball simply stands on its own, which is what a caller
                  in a hall does most of the time anyway. */}
              {newest.flavourText && (
                <p className="bingo-caller__flavour">{newest.flavourText}</p>
              )}
              <p className="bingo-caller__count">
                Call {night.called} of {night.drawCount}
              </p>
            </div>
          </div>

          {rest.length > 0 && (
            <ul className="bingo-caller__tick" aria-label="Called with it">
              {rest.map((b, i) => (
                <li key={b.slotIndex}>
                  <span
                    className="bingo-ball"
                    style={{ ['--call-i' as string]: i + 1 }}
                  >
                    {b.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="bingo-caller__waiting">
          No numbers yet. The first four go up at{' '}
          {etTime(night.firstDrawAt, { zone: true })}.
        </p>
      )}

      {night.nextCallAt && (
        <p className="bingo-caller__next">
          Next four at {etTime(night.nextCallAt, { zone: true })}
          <span className="bingo-caller__in">
            {' · '}
            {bingoCallCountdown(night.nextCallAt, now)}
          </span>
        </p>
      )}

      {/* SETTLED. `called`, never `drawCount`: a night that lost its draw job
          for an hour BACKFILLS on recovery and reaches its full count, but one
          that could not recover in time settles SHORT — a real outcome the
          schema names and handles, and the number a fan watched go up is the
          honest one to close on. */}
      {night.status === 'settled' && (
        <p className="bingo-caller__done">
          That&apos;s the night — {night.called} called.
        </p>
      )}

      {claim}
    </section>
  );
}
