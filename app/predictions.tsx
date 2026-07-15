'use client';

// The fan-facing PREDICTIONS board for one game — the pick cards. POINTS ONLY:
// a fan stakes points, wins points, and climbs a leaderboard. There is no money
// here and the copy must never imply one ("points", "picks", "stake" — never
// "bet", "wager", "odds").
//
// Lives on the game page between the photos and the courtside feed. Any
// authenticated role sees it; any of them can pick (the backend puts no @Roles
// on the pick route on purpose).

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePoints } from './points-context';
import {
  getEventPredictions,
  makePick,
  points,
  signedPoints,
  Prediction,
  PredictionOption,
} from './api';

// Matches the game page's live pulse poll (useLivePulse, 5s) — the board rides
// the SAME cadence as the score and the courtside feed, so a fan watching a
// question fill up sees it move in step with the play-by-play rather than on a
// second, unrelated clock. Like that poller, it only runs while the game is
// live; a scheduled or final game loads its board once.
const POLL_MS = 5000;

// A question the fan can still act on drives the whole card's affordance.
const isOpen = (p: Prediction) => p.status === 'open';

// Status pill copy. Deliberately plain-language: "Picks locked", not "LOCKED".
function statusLabel(p: Prediction): string {
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
  prediction: Prediction;
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
function OutcomeBanner({ prediction }: { prediction: Prediction }) {
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
function pickLabelOf(p: Prediction): string {
  const key = p.myPick?.pickKey;
  return p.options.find((o) => o.key === key)?.label ?? key ?? '';
}

// ---- One pick card: question, stake, status, the option buttons, and whatever
// the fan's own standing is on it. ----
function PickCard({
  prediction,
  optimisticKey,
  error,
  onPick,
}: {
  prediction: Prediction;
  // A pick that's been tapped but hasn't come back yet. Overlaid on the server
  // row so the card commits instantly.
  optimisticKey: string | null;
  error: string | null;
  onPick: (pickKey: string) => void;
}) {
  const my = prediction.myPick;
  const myKey = my?.pickKey ?? optimisticKey;
  const open = isOpen(prediction);
  // Once picked, the buttons stop being buttons: a pick is one-shot per fan
  // (the backend 409s a second one), so leaving them tappable would only ever
  // produce an error.
  const canPick = open && myKey === null;
  const inFlight = optimisticKey !== null && !my;

  return (
    <article
      className={`predict-card${
        prediction.status === 'resolved' ? ' predict-card--settled' : ''
      }`}
    >
      <div className="predict-card__head">
        <h3 className="predict-card__question">{prediction.question}</h3>
        <span
          className={`pill predict-pill predict-pill--${prediction.status}`}
        >
          {statusLabel(prediction)}
        </span>
      </div>

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
    </article>
  );
}

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
  const { applyBalance } = usePoints();
  const [rows, setRows] = useState<Prediction[] | null>(null);
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
      const next = await getEventPredictions(token, eventId);
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
      // the game.
    }
  }, [token, eventId]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  // Ride the game page's live cadence (see POLL_MS). Only while live: a
  // scheduled or final game's board doesn't move on its own.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const onPick = useCallback(
    async (predictionId: string, pickKey: string) => {
      // Commit to the UI first, then go to the network.
      setOptimistic((o) => ({ ...o, [predictionId]: pickKey }));
      setErrors((e) => {
        const { [predictionId]: _drop, ...rest } = e;
        return rest;
      });
      try {
        const result = await makePick(token, predictionId, pickKey);
        // The response carries the fan's new balance straight out of the
        // server-side debit — the ⚡ chip updates from that, no refetch.
        applyBalance(result.balance);
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
    [token, applyBalance, load],
  );

  // A game with no questions shows NOTHING — no empty state, no placeholder.
  // Most games won't have a board, and an empty section on every one of them
  // would be noise on the page's most-live real estate.
  if (!rows || rows.length === 0) return null;

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
      <div className="predict-list">
        {rows.map((p) => (
          <PickCard
            key={p.id}
            prediction={p}
            optimisticKey={optimistic[p.id] ?? null}
            error={errors[p.id] ?? null}
            onPick={(key) => void onPick(p.id, key)}
          />
        ))}
      </div>
    </section>
  );
}
