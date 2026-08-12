'use client';

// ============================================================================
// CASUAL PICKING ON /games -- the compact pick strip that sits under a schedule
// card, and the one batch read that feeds every strip on the page.
//
// THE GESTURE THIS IS FOR: see a game, back a side, move on. No entry, no slate,
// no ranking. It is deliberately NOT the game page's board -- see WHY NOT
// PickCard below -- and it is deliberately not free: a casual pick costs points
// (25, from platform config), which is the settled decision recorded in
// docs/casual-picking-on-games.md.
//
// ----------------------------------------------------------------------------
// ONE REQUEST FOR THE WHOLE PAGE, NOT ONE PER CARD.
//
// useGamePicks makes exactly one call to GET /predictions/for-events with every
// event id currently rendered. A fan-out of 20 board reads per page (and 20 more
// per "Show more") is the shape that endpoint was added to avoid -- if you find
// yourself reaching for getEventPredictions from a card, stop.
//
// The strip renders NOTHING on a row with no question. No placeholder, no "no
// picks here" -- most rows on a paged schedule are future nights whose questions
// have not been opened yet (the nightly opener runs at noon ET for THAT day), and
// a row of empty affordances would be noise on the page's whole point.
//
// ----------------------------------------------------------------------------
// WHY NOT PickCard, WHICH ALREADY EXISTS AND ALREADY DOES THIS.
//
// PickCard leads with a question heading and a stake block, which is right on a
// board where the question IS the subject, and wrong stacked twenty deep on a
// schedule where the GAME is the subject. What the two share is the part that was
// actually hard: usePickBoard, which owns optimistic taps, the read-ordering
// guard, per-card 409s, the 18+ gate and the balance push. This file adds a
// layout and reuses all of that -- it does not reimplement any of it.
//
// ----------------------------------------------------------------------------
// THE COVERING FLAG, AND THE ONE RULE THAT IS EASY TO BREAK HERE.
//
// EventQuestion.covering is a BARE BOOLEAN with no message, on purpose: with many
// events the server's verdict reaches for the slate sentence ("it would change how
// the whole slate scores"), which is true of a pick sheet and false of a schedule.
// So the server sends the flag and keeps the words on the board each row links to.
//
// THIS FILE THEREFORE WRITES NO SENTENCE ABOUT THE REFUSAL, and must not grow
// one. The strip goes inert with the crowd's split still visible (the same rule
// PickCard states -- a correspondent should still see the question and where the
// crowd is), and the foot becomes a plain pointer to the board, which is the
// surface whose `entry` advisory carries the server's own wording. A local
// paraphrase here would be the third copy of a sentence the backend owns.
// ============================================================================

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePickBoard } from './predictions';
import { getQuestionsForEvents, points, EventQuestion } from './api';

// What the hook hands to each strip. One object rather than five props threaded
// through GameCard, which renders the strip as a sibling of its own <Link>.
export interface GamePicks {
  byEvent: Map<string, EventQuestion>;
  onPick: (predictionId: string, pickKey: string) => void;
  optimistic: Record<string, string>;
  errors: Record<string, string>;
}

// ---- The page-wide read. ----------------------------------------------------
//
// `eventIds` may change identity on every render (it is a .map over the page's
// items), so the fetch is keyed on the JOINED STRING rather than the array --
// usePickBoard keys its load on fetchRows' identity, and an unstable callback
// would re-request on every paint.
//
// A page-append ("Show more") legitimately changes the key and costs one more
// request for the whole widened set. That is one request per append, which is the
// trade this shape exists to make.
//
// NO POLL. The game page's board polls at 5s because it is one live game; a
// twenty-row schedule gets no heartbeat. The strip loads once, and a pick
// re-reads through the hook.
export function useGamePicks(token: string, eventIds: string[]): GamePicks {
  const key = eventIds.join(',');

  // No token (the page redirects, but hooks run first) or no rows on screen: no
  // request. Resolving empty is what keeps this out of the "signed out for a beat
  // and fired a 401" class of noise, and it means /games can call the hook above
  // its own auth early-return, which is where React requires it to be.
  const fetchRows = useCallback(
    () => (token && key ? getQuestionsForEvents(token, key.split(',')) : Promise.resolve([])),
    [token, key],
  );

  const { rows, onPick, optimistic, errors } = usePickBoard<EventQuestion>({
    token,
    fetchRows,
  });

  // FIRST ROW PER EVENT WINS. The server orders by event, then newest question
  // first, so this takes the newest -- which is the one the nightly opener just
  // opened, or the one a rep opened courtside if they beat it to the game. A
  // schedule card shows at most one question by design; a game with two goes to
  // the board to show both.
  const byEvent = useMemo(() => {
    const map = new Map<string, EventQuestion>();
    for (const row of rows ?? []) {
      if (!map.has(row.eventId)) map.set(row.eventId, row);
    }
    return map;
  }, [rows]);

  return { byEvent, onPick, optimistic, errors };
}

// ---- One option button. The crowd's share is painted behind the label as a
// fill, exactly as on the board's OptionButton -- same tokens, same treatment,
// tighter box. ----
function StripOption({
  option,
  question,
  myKey,
  optimisticBump,
  disabled,
  onPick,
}: {
  option: EventQuestion['options'][number];
  question: EventQuestion;
  myKey: string | null;
  optimisticBump: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const mine = myKey === option.key;
  // Once the fan has picked, the other side recedes -- the strip should answer
  // "where do I stand?" at a glance, same as the board's card.
  const dimmed = myKey !== null && !mine;

  // Recomputed locally while a tap is in flight so the bar moves on the tap
  // rather than a request later. Counts move together (this option +1, the total
  // +1) so the two shares still sum to 100%.
  const total = question.totalPicks + (optimisticBump ? 1 : 0);
  const count = option.count + (optimisticBump && mine ? 1 : 0);
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  // ---- NO SPLIT UNTIL THERE IS ONE. ----
  // With nobody picked, "0%" on both buttons is not a quiet zero -- it is a
  // number competing for attention with the only thing on the button that means
  // anything, the team's name. It also reads as a measurement ("nobody likes
  // either side") when the truth is "no measurement exists yet".
  //
  // `total` and not question.totalPicks, so the fan's OWN tap brings it in
  // immediately rather than a request later -- their pick is the first pick, and
  // 100%/0% at that moment is true.
  const hasCrowd = total > 0;

  const classes = [
    'predict-opt',
    'gamepick-opt',
    mine && 'predict-opt--mine',
    dimmed && 'predict-opt--dim',
    !disabled && 'predict-opt--live',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      onClick={onPick}
      aria-pressed={mine}
    >
      <span
        className="predict-opt__fill"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
      {/* STACKED, NOT SIDE BY SIDE, and that is the whole fix for the truncation.
          The name gets the button's full inner width whether or not a split is
          showing, so the split's arrival costs the name nothing -- there is no
          width to trade between them, which is the only way "both fit at 390px"
          can be true of every team name rather than of the short ones. */}
      <span className="predict-opt__body gamepick-opt__body">
        <span className="predict-opt__label gamepick-opt__label">{option.label}</span>
        {hasCrowd && <span className="gamepick-opt__pct">{pct}%</span>}
      </span>
    </button>
  );
}

// ---- The strip. Renders null when this game has no question, which is most
// rows on most pages. ----
export function GamePickStrip({
  eventId,
  picks,
}: {
  eventId: string;
  picks: GamePicks;
}) {
  const question = picks.byEvent.get(eventId);
  if (!question) return null;

  const my = question.myPick;
  const optimisticKey = picks.optimistic[question.id] ?? null;
  const myKey = my?.pickKey ?? optimisticKey;
  const inFlight = optimisticKey !== null && !my;
  const open = question.status === 'open';
  const error = picks.errors[question.id] ?? null;

  // Same test as the board's: a pick is one-shot per fan (the backend 409s a
  // second one) and a covered pick is a 403, so a tappable option in either case
  // is a promise we already know we cannot keep.
  const canPick = open && myKey === null && !question.covering;

  return (
    <div className="gamepick">
      <div className="gamepick__opts">
        {question.options.map((o) => (
          <StripOption
            key={o.key}
            option={o}
            question={question}
            myKey={myKey}
            optimisticBump={inFlight}
            disabled={!canPick}
            onPick={() => picks.onPick(question.id, o.key)}
          />
        ))}
      </div>

      {/* ONE FOOT LINE, and which one it is says everything about the row's
          state. Order matters: covering outranks locked outranks picked outranks
          the price, because that is the order in which the fan can act on them. */}
      {question.covering ? (
        // NO SENTENCE ABOUT WHY -- see the header. A pointer to the surface that
        // carries the server's own wording, and nothing else.
        <Link href={`/games/${eventId}`} className="gamepick__foot gamepick__foot--link">
          See the board →
        </Link>
      ) : !open ? (
        <span className="gamepick__foot muted">Picks locked</span>
      ) : myKey !== null ? (
        <span className="gamepick__foot">
          {inFlight
            ? 'Locking in…'
            : `Locked in — ${points(my?.stake ?? question.stake)} pts on ${
                question.options.find((o) => o.key === myKey)?.label ?? ''
              }`}
        </span>
      ) : (
        <span className="gamepick__foot muted">
          {points(question.stake)} pts to play
        </span>
      )}

      {/* The 409s and the age-gate decline land here, per card, in the fan's own
          words from the server. Same slot the board's card uses. */}
      {error && <div className="error predict-error gamepick__error">{error}</div>}
    </div>
  );
}
