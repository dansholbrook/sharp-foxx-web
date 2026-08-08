'use client';

// The fan-facing PREDICTIONS pick cards, and the board that puts them on a game
// page. POINTS ONLY: a fan stakes points, wins points, and climbs a leaderboard.
// There is no money here and the copy must never imply one ("points", "picks",
// "stake" — never "bet", "wager", "odds").
//
// This file owns THREE things, in widening order of coupling:
//   • PickCard — a pure card over a PredictionBase. Scope-blind, like the
//     backend's withPickData() it renders: a game question and a national one
//     read identically, which is the whole point.
//   • usePickBoard — the pick STATE MACHINE (optimistic taps, per-card errors,
//     the balance push, the re-read). Takes a `load` and knows nothing about
//     where rows come from.
//   • PredictionsSection — the game page's board: event read + live poll + the
//     covering advisory, built on the two above.
// The National Board on the feed (feed-picks.tsx) reuses the first two with its
// own `load`. Nothing about picking is duplicated there.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePoints } from './points-context';
import { useAgeGate } from './age-gate';
import { EntryAdvisoryNotice } from './entry-advisory';
import {
  entryRefusal,
  getEventPredictions,
  makePick,
  points,
  signedPoints,
  PredictionBase,
  PredictionOption,
} from './api';

// Matches the game page's live pulse poll (useLivePulse, 5s) — the board rides
// the SAME cadence as the score and the courtside feed, so a fan watching a
// question fill up sees it move in step with the play-by-play rather than on a
// second, unrelated clock. Like that poller, it only runs while the game is
// live; a scheduled or final game loads its board once.
const POLL_MS = 5000;

// A question the fan can still act on drives the whole card's affordance.
const isOpen = (p: PredictionBase) => p.status === 'open';

// Status pill copy. Deliberately plain-language: "Picks locked", not "LOCKED".
function statusLabel(p: PredictionBase): string {
  switch (p.status) {
    case 'open':
      return 'Picks open';
    case 'locked':
      return 'Picks locked';
    case 'resolved':
      return 'Final';
    case 'voided':
      return 'Voided';
  }
}

// ---- One option button. This is the fun surface: a big tap target with the
// crowd's share painted straight into it as a fill bar behind the label. ----
function OptionButton({
  option,
  prediction,
  // The fan's pick on this question, real or optimistic — null if they haven't
  // picked. Drives the chosen/dimmed split across the whole option row.
  myKey,
  // Bump this option's count by one for an in-flight optimistic pick, so the
  // crowd bar moves the instant the fan taps rather than a poll later.
  optimisticBump,
  disabled,
  onPick,
}: {
  option: PredictionOption;
  prediction: PredictionBase;
  myKey: string | null;
  optimisticBump: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const mine = myKey === option.key;
  const settled = prediction.status === 'resolved';
  const won = settled && prediction.winningKey === option.key;
  // Once the fan has picked (or the question is settled), the other options
  // recede — the card should answer "where do I stand?" at a glance.
  const dimmed = (myKey !== null && !mine) || (settled && !won);

  // Recompute the distribution locally when an optimistic pick is in flight:
  // the server hasn't counted it yet, but the fan just did it, so the bar must
  // already show it. Counts move together (this option +1, the total +1) so the
  // shares still sum to 100%.
  const total = prediction.totalPicks + (optimisticBump ? 1 : 0);
  const count = option.count + (optimisticBump && mine ? 1 : 0);
  const share = total > 0 ? count / total : 0;
  const pct = Math.round(share * 100);

  const classes = [
    'predict-opt',
    mine && 'predict-opt--mine',
    won && 'predict-opt--won',
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
      {/* The crowd bar sits BEHIND the label as a fill, not beside it — the
          button stays one tap target and the share reads as weight. */}
      <span
        className="predict-opt__fill"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
      <span className="predict-opt__body">
        <span className="predict-opt__label">
          {option.label}
          {won && <span className="predict-opt__check" aria-hidden="true">✓</span>}
        </span>
        <span className="predict-opt__share">
          <span className="predict-opt__pct">{pct}%</span>
          <span className="predict-opt__count">
            {count === 1 ? '1 pick' : `${points(count)} picks`}
          </span>
        </span>
      </span>
    </button>
  );
}

// ---- The outcome banner on a settled question. Green for a win, neutral
// otherwise — a loss should be quiet, not a scolding. ----
function OutcomeBanner({ prediction }: { prediction: PredictionBase }) {
  const my = prediction.myPick;
  if (!my) return null;

  if (my.outcome === 'won') {
    // NET, not gross. `payout` is the gross return (stake × 2), so a 100-point
    // pick pays 200 back — but the fan only ever gained 100, and that's the
    // number /picks, lifetime earned, and the leaderboard all report. Saying
    // "200" here would be the one surface in the app claiming double.
    const net = (my.payout ?? 0) - my.stake;
    return (
      <div className="predict-outcome predict-outcome--won" role="status">
        You won {signedPoints(net)} points!
      </div>
    );
  }
  if (my.outcome === 'lost') {
    return (
      <div className="predict-outcome" role="status">
        Not this time — {points(my.stake)} points on {pickLabelOf(prediction)}.
      </div>
    );
  }
  if (my.outcome === 'refunded') {
    return (
      <div className="predict-outcome" role="status">
        Refunded — {points(my.stake)} points back. This question was voided.
      </div>
    );
  }
  return null;
}

// The label the fan actually picked (falls back to the raw key, which should
// never surface but beats rendering nothing).
function pickLabelOf(p: PredictionBase): string {
  const key = p.myPick?.pickKey;
  return p.options.find((o) => o.key === key)?.label ?? key ?? '';
}

// ---- One pick card: question, stake, status, the option buttons, and whatever
// the fan's own standing is on it. ----
//
// Takes a PredictionBase, so this ONE card serves the game board and the
// National Board. It renders nothing scope-specific on its own — a national
// question's context/byline arrives through `caption`, which is the only thing
// the two boards disagree about.
export function PickCard({
  prediction,
  caption,
  optimisticKey,
  error,
  onPick,
  covering,
  collapsed,
  onToggleCollapse,
}: {
  prediction: PredictionBase;
  // Optional line under the question. The game board leaves it off (the page IS
  // the context); the National Board passes "NBA Finals 2026 · asked by …".
  caption?: React.ReactNode;
  // A pick that's been tapped but hasn't come back yet. Overlaid on the server
  // row so the card commits instantly.
  optimisticKey: string | null;
  error: string | null;
  onPick: (pickKey: string) => void;
  // Set by a board whose caller is covering this game. Every option goes inert
  // and the board's notice carries the reason — the card itself says nothing,
  // because the refusal is a fact about the GAME and repeating it on all six
  // questions would read as six separate problems.
  //
  // THE CARD STILL RENDERS IN FULL. A correspondent should see their game's
  // questions and the crowd's split; hiding them would answer a question they
  // still have and make the advisory look like an outage. Same rule
  // EntryAdvisoryNotice states for every other surface.
  //
  // Never set by the National Board: a national question is tied to no event,
  // so there is nothing to be covering. Undefined there, which is why this is
  // optional rather than a required boolean the feed would have to pass false to.
  covering?: boolean;
  // ---- Rail accordion variant (National Board only) ----
  // Passing `onToggleCollapse` turns the card collapsible: the head becomes a
  // toggle button with a chevron, and while `collapsed` the stake/options/notes
  // body is swapped for a single summary row. Omit both and the card renders
  // exactly as before — always-expanded, the game board's behaviour. This is a
  // density concern for the feed's right rail, NOT a redesign of the card; the
  // expanded body below is the same markup the game board shows.
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const my = prediction.myPick;
  const myKey = my?.pickKey ?? optimisticKey;
  const open = isOpen(prediction);
  // Once picked, the buttons stop being buttons: a pick is one-shot per fan
  // (the backend 409s a second one), so leaving them tappable would only ever
  // produce an error. `covering` joins the same test for the same reason: the
  // backend 403s a covered pick, so a tappable option is a promise we know we
  // cannot keep.
  const canPick = open && myKey === null && !covering;
  const inFlight = optimisticKey !== null && !my;

  const collapsible = onToggleCollapse != null;
  const showSummary = collapsible && collapsed;
  const pillClass = `pill predict-pill predict-pill--${prediction.status}`;

  // The full body — identical whether the card is a game-board card or an
  // expanded rail card. Extracted only so the collapsed rail state can swap it
  // out for the one-line summary; nothing here changed.
  const body = (
    <>
      <div className="predict-card__stake">
        <span className="predict-card__stake-value">
          {points(prediction.stake)} points
        </span>
        <span className="predict-card__stake-label">to play</span>
      </div>

      <div className="predict-opts">
        {prediction.options.map((o) => (
          <OptionButton
            key={o.key}
            option={o}
            prediction={prediction}
            myKey={myKey}
            optimisticBump={inFlight}
            disabled={!canPick}
            onPick={() => onPick(o.key)}
          />
        ))}
      </div>

      {/* The fan's standing, one line. Open+picked says what they're holding;
          settled hands over to the outcome banner. */}
      {open && myKey !== null && (
        <p className="predict-note">
          {inFlight
            ? 'Locking in…'
            : `Locked in — ${points(my?.stake ?? prediction.stake)} points on ${pickLabelOf(
                prediction,
              )}.`}
        </p>
      )}
      {open && myKey === null && prediction.totalPicks === 0 && (
        <p className="predict-note predict-note--muted">
          Be the first to pick.
        </p>
      )}
      {prediction.status === 'locked' && myKey === null && (
        <p className="predict-note predict-note--muted">
          Picks closed before you got one in.
        </p>
      )}
      {(prediction.status === 'resolved' || prediction.status === 'voided') && (
        <OutcomeBanner prediction={prediction} />
      )}

      {error && <div className="error predict-error">{error}</div>}
    </>
  );

  return (
    <article
      className={`predict-card${
        prediction.status === 'resolved' ? ' predict-card--settled' : ''
      }`}
    >
      {collapsible ? (
        <button
          type="button"
          className="predict-card__head natboard-collapse-toggle"
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <h3 className="predict-card__question">{prediction.question}</h3>
          <span className="natboard-collapse-head-right">
            <span className={pillClass}>{statusLabel(prediction)}</span>
            <span
              className="natboard-collapse-chevron"
              data-open={!collapsed}
              aria-hidden="true"
            >
              ▾
            </span>
          </span>
        </button>
      ) : (
        <div className="predict-card__head">
          <h3 className="predict-card__question">{prediction.question}</h3>
          <span className={pillClass}>{statusLabel(prediction)}</span>
        </div>
      )}

      {caption}

      {showSummary ? (
        <CollapsedSummary prediction={prediction} myKey={myKey} open={open} />
      ) : collapsible ? (
        <div className="natboard-collapse-body">{body}</div>
      ) : (
        body
      )}
    </article>
  );
}

// ---- The one-line collapsed summary for a rail card. Answers "where do I
// stand?" without the option list: the fan's pick and stake (with a Won/Lost/
// Refunded badge once it's settled) if they've picked, or the shape of the
// question plus a "Make your pick" nudge if they haven't. ----
function CollapsedSummary({
  prediction,
  myKey,
  open,
}: {
  prediction: PredictionBase;
  myKey: string | null;
  open: boolean;
}) {
  const my = prediction.myPick;

  if (myKey !== null) {
    // Optimistic picks carry no `my` yet, so resolve the label off the key and
    // fall back to the question's own stake for the points figure.
    const label = prediction.options.find((o) => o.key === myKey)?.label ?? '';
    const stake = my?.stake ?? prediction.stake;
    const settled = my != null && my.outcome !== 'pending';
    return (
      <div className="natboard-collapse-summary">
        <span className="natboard-collapse-mine">
          Your pick: <strong>{label}</strong>
          <span className="natboard-collapse-dot" aria-hidden="true">·</span>
          {points(stake)} pts
        </span>
        {settled && (
          <span
            className={`natboard-collapse-badge natboard-collapse-badge--${my.outcome}`}
          >
            {my.outcome === 'won'
              ? 'Won'
              : my.outcome === 'lost'
                ? 'Lost'
                : 'Refunded'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="natboard-collapse-summary">
      <span className="natboard-collapse-stat">
        {prediction.options.length} options
        <span className="natboard-collapse-dot" aria-hidden="true">·</span>
        {prediction.totalPicks === 1
          ? '1 pick'
          : `${points(prediction.totalPicks)} picks`}
        <span className="natboard-collapse-dot" aria-hidden="true">·</span>
        {points(prediction.stake)} pts to play
      </span>
      {open && <span className="natboard-collapse-cta">Make your pick</span>}
    </div>
  );
}

// ---- The pick state machine, minus any opinion about where rows come from.
//
// Everything hard about picking lives here: optimistic taps, the read-ordering
// guard, per-card 409s, and pushing the server's new balance at the ⚡ chip. It
// takes a `fetchRows` and is otherwise board-agnostic, which is what lets the
// game board and the National Board share it instead of growing two subtly
// different copies of the same race conditions.
//
// `fetchRows` MUST be stable (useCallback it) — it keys the initial load.
//
// `onPicked` is the board's chance to do something scope-specific after a pick
// LANDS (not after a 409). Today that's exactly one thing: the National Board
// reports a national_pick earn. It lives here as a callback rather than as a
// `scope` flag because the state machine has no business knowing what a national
// question is — it knows a pick succeeded, and hands that fact upward.
export function usePickBoard<T extends PredictionBase>({
  token,
  fetchRows,
  onPicked,
}: {
  token: string;
  fetchRows: () => Promise<T[]>;
  onPicked?: () => void;
}) {
  const { applyBalance } = usePoints();
  const { runGated } = useAgeGate();
  const [rows, setRows] = useState<T[] | null>(null);
  // predictionId -> pickKey for taps still in flight. Overlaid on the server
  // rows at render, so a poll landing mid-flight can replace `rows` wholesale
  // without stomping the fan's tap.
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Guards against a slow in-flight load resolving after unmount.
  const cancelledRef = useRef(false);
  // Issue order for board reads. The poll and a pick's re-read overlap BY
  // DESIGN, and without this whichever response happens to land last would win
  // — so a poll fired before a pick, but arriving after it, would roll the card
  // back to "not picked" while the chip correctly shows the points already
  // spent. Only the most recently ISSUED read may write.
  const loadGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const next = await fetchRows();
      // Superseded by a newer read while this one was in flight — drop it.
      if (cancelledRef.current || gen !== loadGenRef.current) return;
      setRows(next);
      // A 409 is a statement about a board that has since MOVED, and the card
      // it sits on can't be tapped again to clear it (the buttons disable the
      // moment a pick exists). So once a fresh row explains the situation on
      // its own — the pick is in, or the pill now reads Locked — retire the
      // banner instead of stranding it above a correctly "Locked in" pick.
      // An "Insufficient points" 409 on a still-open question is deliberately
      // NOT pruned: nothing else on the card says it, and the fan can retry.
      setErrors((prev) => {
        let changed = false;
        const pruned = { ...prev };
        for (const row of next) {
          if (pruned[row.id] && (row.myPick !== null || row.status !== 'open')) {
            delete pruned[row.id];
            changed = true;
          }
        }
        return changed ? pruned : prev;
      });
    } catch {
      // The board is a garnish on someone else's page — a failed load leaves
      // whatever's on screen and the next poll tries again. It must never blank
      // the game (or the feed).
    }
  }, [fetchRows]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  const onPick = useCallback(
    async (predictionId: string, pickKey: string) => {
      // Commit to the UI first, then go to the network.
      setOptimistic((o) => ({ ...o, [predictionId]: pickKey }));
      setErrors((e) => {
        const { [predictionId]: _drop, ...rest } = e;
        return rest;
      });
      try {
        // Through the 18+ gate: an un-attested fan gets the prompt and, on
        // affirming, this same pick is retried for them. Declining throws a
        // plain sentence the catch below renders in the card's own error slot.
        const result = await runGated(() => makePick(token, predictionId, pickKey));
        // The response carries the fan's new balance straight out of the
        // server-side debit — the ⚡ chip updates from that, no refetch.
        applyBalance(result.balance);
        // The pick is in. Fire the board's after-hook BEFORE the re-read so the
        // earn (and its toast) isn't queued behind a network round-trip the fan
        // isn't waiting on. It must not throw — useEngagementEarn never does.
        onPicked?.();
        // Re-read the board so the counts/shares are the server's truth rather
        // than our +1, and the row comes back carrying a real myPick.
        await load();
      } catch (err) {
        // The 409s land here — already picked, insufficient points, picks
        // closed — and each one is a real thing to say on the card rather than
        // a silent revert. The client renders them as "<status> <message>".
        setErrors((e) => ({
          ...e,
          [predictionId]:
            err instanceof Error ? err.message : 'Could not place that pick',
        }));
        // "Already picked" / "picks are closed" mean the board moved under us,
        // so re-read it: the fan should end up looking at the truth.
        await load();
      } finally {
        setOptimistic((o) => {
          const { [predictionId]: _drop, ...rest } = o;
          return rest;
        });
      }
    },
    [token, applyBalance, load, onPicked, runGated],
  );

  return { rows, load, onPick, optimistic, errors };
}

// ---- The game page's board: the event read + the live poll, over the shared
// card and state machine above. ----
export function PredictionsSection({
  token,
  eventId,
  live,
}: {
  token: string;
  eventId: string;
  // Drives the poll only. The board renders on every game — an upcoming game
  // can carry open questions before tip-off.
  live: boolean;
}) {
  // Stable per (token, eventId) — the hook keys its initial load on it.
  const fetchRows = useCallback(
    () => getEventPredictions(token, eventId),
    [token, eventId],
  );
  const { rows, load, onPick, optimistic, errors } = usePickBoard({
    token,
    fetchRows,
  });

  // Ride the game page's live cadence (see POLL_MS). Only while live: a
  // scheduled or final game's board doesn't move on its own. This is the one
  // thing that stays here rather than in the hook — a national question moves on
  // a scale of weeks and has nothing to poll for.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  // A game with no questions shows NOTHING — no empty state, no placeholder.
  // Most games won't have a board, and an empty section on every one of them
  // would be noise on the page's most-live real estate.
  if (!rows || rows.length === 0) return null;

  // The conflict-of-interest refusal, read off ANY row — the server computes one
  // verdict for the game and stamps it on every question (see Prediction.entry),
  // so row zero is as authoritative as row five.
  //
  // `rows[0]` and NOT `rows[0]?.`: the guard directly above already establishes
  // there is a row, and an optional chain here would flatten "no board yet" into
  // the same undefined as "the server sent no advisory" — which is precisely the
  // conflation that let this gate's last silent failure run for a week. See the
  // block above entryRefusal.
  //
  // Computed after the empty-board return for the same reason: a board with no
  // questions carries no advisory (the server returns a bare []), and there is
  // nothing to refuse someone on a game with nothing to pick.
  const covering = entryRefusal(rows[0].entry, 'GET /events/:eventId/predictions');

  return (
    <section className="predict-section">
      <div className="predict-section__head">
        <h2 className="predict-section__title">Predictions</h2>
        <Link
          href={`/leaderboard?eventId=${encodeURIComponent(eventId)}`}
          className="predict-section__link"
        >
          Leaderboard →
        </Link>
      </div>
      <p className="predict-section__standfirst">
        Pick with points. No money, ever — just bragging rights.
      </p>
      {/* ONCE, ABOVE THE LIST, not on each card: the refusal is a fact about
          this GAME, and every question on the board carries the same verdict.
          Repeated six times it would read as six problems. Sits under the
          standfirst so it's the last thing read before the questions it
          closes. */}
      {covering && <EntryAdvisoryNotice refusal={covering} />}
      <div className="predict-list">
        {rows.map((p) => (
          <PickCard
            key={p.id}
            prediction={p}
            optimisticKey={optimistic[p.id] ?? null}
            error={errors[p.id] ?? null}
            onPick={(key) => void onPick(p.id, key)}
            covering={covering !== null}
          />
        ))}
      </div>
    </section>
  );
}
