'use client';

// The PARLAY surface for /contests/[id] when type==='parlay_board'. A parlay
// board IS a contest (the chassis owns enter/leaderboard, shared with pick'em),
// but its body is the TICKET BUILDER — the whole reason this surface exists —
// rather than a pick sheet. This component owns the board read, the tap-to-build
// gameplay, the stake, the place/cancel chain and the ticket book below it.
//
// TWO LAYERS, the same shape squares uses: entering is FREE (the chassis entry
// row is just leaderboard presence) and the TICKET is the buy. So, exactly like
// the squares grid, the first PLACE enters the contest transparently rather than
// making the fan press an Enter button first — the backend 403s a ticket from a
// caller with no entry, so the chain is enter → ticket (with a retry if our
// seeded flag was stale). POINTS ONLY: stakes and payouts are points, never
// money, and nothing here uses cash language.
//
// THE ONE LOCK RULE (parlay.type.ts, v1): the CONTEST lock governs everything.
// The board auto-locks at the slate's EARLIEST kickoff, and from that instant
// there are no new tickets and no cancels. So the builder renders only while
// `status === 'open'`; once locked the fan sees their tickets and nothing else.
// A started game inside a still-open board (a hand-reopened board, or the moment
// between kickoff and the lazy lock) renders inert rather than offering a chip
// that would 409.
//
// MOBILE-FIRST: the builder is a phone activity. Team chips are thumb-sized, and
// the TICKET STUB docks to the bottom of the viewport on a phone (sticky, below
// the slate in DOM order) so the running leg count, multiplier and payout stay in
// view while the fan scrolls the slate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth-context';
import { usePoints } from '../../points-context';
import {
  getParlayBoard,
  buildParlayTicket,
  cancelParlayTicket,
  enterContest,
  points,
  formatMultiplier,
  parlayLadderLabel,
  ContestDetail,
  ParlayBoardRead,
  ParlaySlateGame,
  ParlayTicket,
  ParlayLeg,
} from '../../api';

// Poll cadence while the board is LIVE — legs grade and tickets settle courtside,
// so a gentle refresh keeps the ticket book honest without a socket. Open boards
// don't poll (nothing moves but the fan's own taps); final boards are settled.
// 30s, the same cadence the scorecard / grid / survivor timeline use.
const LIVE_POLL_MS = 30_000;

// The stake shortcuts. Rendered only where they fall inside the board's own
// [minStake, maxStake] — a chip that would 400 is worse than no chip.
const QUICK_STAKES = [25, 50, 100, 250];

// The stake the builder opens on: 100 if the board allows it, else the nearest
// bound. Matches the task's "default 100, clamped to bounds".
function defaultStake(min: number, max: number): number {
  return Math.min(Math.max(100, min), max);
}

// Match the app's date+time treatment used across the game/contest surfaces.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

// A slate game is closed to legging once it has started: the backend rejects a
// ticket whose slate has any game at scheduledAt <= now (DB clock), and moves the
// status off 'scheduled' as it goes live. Mirror both so a started row renders
// inert. (On a healthy board the whole contest has locked by then — this is the
// belt-and-braces case, and what disables the row in the gap before the lazy
// lock lands.)
function gameStarted(game: ParlaySlateGame): boolean {
  if (game.status !== 'scheduled') return true;
  const at = new Date(game.scheduledAt).getTime();
  return !Number.isNaN(at) && at <= Date.now();
}

// Points are whole, so a fractional payout FLOORS — the same rule the backend
// prices with (parlayPayout), so the stub never promises a point that won't pay.
function payoutFor(stake: number, multiplier: number): number {
  return Math.floor(stake * multiplier);
}

// ---------------------------------------------------------------------------
// THE BUILDER — one slate row: the matchup, its kickoff, and the two team chips
// ---------------------------------------------------------------------------

function TeamChip({
  teamId,
  name,
  picked,
  disabled,
  onTap,
}: {
  // Null when the game's side isn't linked to a team row — nothing to leg, so the
  // chip is inert (the same guard survivor's TeamButton makes).
  teamId: string | null;
  name: string | null;
  picked: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      className={`parlay-chip${picked ? ' parlay-chip--on' : ''}`}
      aria-pressed={picked}
      disabled={disabled || teamId == null}
      onClick={onTap}
    >
      <span className="parlay-chip__name">{name ?? 'TBD'}</span>
      {picked && (
        <span className="parlay-chip__mark" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  );
}

function SlateRow({
  game,
  pickedTeamId,
  disabled,
  onTap,
}: {
  game: ParlaySlateGame;
  pickedTeamId: string | null;
  disabled: boolean;
  onTap: (teamId: string) => void;
}) {
  const started = gameStarted(game);
  const hasScore = game.homeScore !== null && game.awayScore !== null;
  return (
    <li className={`parlay-game${started ? ' parlay-game--locked' : ''}`}>
      <div className="parlay-game__head">
        <span className="parlay-game__when">
          {game.status === 'final'
            ? 'Final'
            : game.status === 'live'
            ? 'Live'
            : formatWhen(game.scheduledAt)}
          {hasScore && (
            <span className="parlay-game__score">
              {' '}
              · {game.awayScore}–{game.homeScore}
            </span>
          )}
        </span>
        {started && <span className="parlay-game__status">Started</span>}
      </div>
      <div className="parlay-game__sides">
        <TeamChip
          teamId={game.awayTeamId}
          name={game.awayTeam}
          picked={pickedTeamId != null && pickedTeamId === game.awayTeamId}
          disabled={disabled || started}
          onTap={() => game.awayTeamId && onTap(game.awayTeamId)}
        />
        <span className="parlay-game__at">@</span>
        <TeamChip
          teamId={game.homeTeamId}
          name={game.homeTeam}
          picked={pickedTeamId != null && pickedTeamId === game.homeTeamId}
          disabled={disabled || started}
          onTap={() => game.homeTeamId && onTap(game.homeTeamId)}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// MY TICKETS — one placed ticket as a slip card
// ---------------------------------------------------------------------------

// A leg's graded mark. Pending legs get a quiet dot rather than nothing, so the
// column reads as a column.
function legMark(result: ParlayLeg['result']): { glyph: string; cls: string; label: string } {
  switch (result) {
    case 'won':
      return { glyph: '✓', cls: 'parlay-leg__mark--ok', label: 'Won' };
    case 'lost':
      return { glyph: '✗', cls: 'parlay-leg__mark--no', label: 'Lost' };
    case 'void':
      return { glyph: '∅', cls: 'parlay-leg__mark--void', label: 'Void' };
    default:
      return { glyph: '·', cls: 'parlay-leg__mark--pending', label: 'Pending' };
  }
}

function TicketCard({
  ticket,
  cancelable,
  confirming,
  canceling,
  error,
  onAskCancel,
  onDismissCancel,
  onConfirmCancel,
}: {
  ticket: ParlayTicket;
  cancelable: boolean;
  confirming: boolean;
  canceling: boolean;
  error: string | null;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
}) {
  const settled = ticket.status !== 'pending';
  // Voided legs stay ON the ticket and drop out of the effective count, which is
  // what REPRICES it — legCount/multiplier are rewritten at settlement, so the
  // numbers below are already the recalculated ones. Say so when a void is why.
  const voidedLegs = ticket.legs.filter((l) => l.result === 'void').length;
  const statusFace =
    ticket.status === 'won'
      ? { label: 'Paid', cls: 'parlay-ticket__pill--won' }
      : ticket.status === 'lost'
      ? { label: 'Lost', cls: 'parlay-ticket__pill--lost' }
      : ticket.status === 'voided'
      ? { label: 'Voided', cls: 'parlay-ticket__pill--void' }
      : { label: 'Live', cls: 'parlay-ticket__pill--pending' };

  return (
    <li className={`parlay-ticket parlay-ticket--${ticket.status}`}>
      <div className="parlay-ticket__head">
        <span className="parlay-ticket__legs">
          {ticket.legCount} legs
          <span className="parlay-ticket__mult">×{formatMultiplier(ticket.multiplier)}</span>
        </span>
        <span className={`parlay-ticket__pill ${statusFace.cls}`}>{statusFace.label}</span>
        {cancelable && !confirming && (
          <button
            type="button"
            className="parlay-ticket__cancel"
            aria-label="Cancel this ticket"
            disabled={canceling}
            onClick={onAskCancel}
          >
            ✕
          </button>
        )}
      </div>

      <ul className="parlay-ticket__legs-list">
        {ticket.legs.map((leg) => {
          const mark = legMark(leg.result);
          const hasScore = leg.homeScore !== null && leg.awayScore !== null;
          return (
            <li key={leg.legId} className={`parlay-leg parlay-leg--${leg.result}`}>
              <span className={`parlay-leg__mark ${mark.cls}`} title={mark.label}>
                {mark.glyph}
                <span className="sr-only">{mark.label}</span>
              </span>
              <span className="parlay-leg__body">
                <span className="parlay-leg__team">{leg.pickedTeam ?? 'Your pick'}</span>
                <span className="parlay-leg__matchup">{leg.matchup ?? '—'}</span>
              </span>
              <span className="parlay-leg__when">
                {leg.eventStatus === 'final'
                  ? hasScore
                    ? `${leg.awayScore}–${leg.homeScore}`
                    : 'Final'
                  : leg.eventStatus === 'live'
                  ? hasScore
                    ? `${leg.awayScore}–${leg.homeScore}`
                    : 'Live'
                  : leg.scheduledAt
                  ? formatWhen(leg.scheduledAt)
                  : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      {voidedLegs > 0 && (
        <p className="parlay-ticket__void-note">
          {voidedLegs === 1 ? '1 leg voided' : `${voidedLegs} legs voided`} — repriced to{' '}
          {ticket.legCount} legs ×{formatMultiplier(ticket.multiplier)}.
        </p>
      )}

      <div className="parlay-ticket__foot">
        <span className="parlay-ticket__stake">{points(ticket.stake)} pts staked</span>
        {ticket.status === 'won' ? (
          <span className="parlay-ticket__result parlay-ticket__result--won">
            Paid +{points(ticket.payoutPoints ?? 0)} pts
          </span>
        ) : ticket.status === 'lost' ? (
          <span className="parlay-ticket__result parlay-ticket__result--lost">Lost</span>
        ) : ticket.status === 'voided' ? (
          <span className="parlay-ticket__result parlay-ticket__result--void">
            Stake refunded
          </span>
        ) : (
          <span className="parlay-ticket__result">
            To win <strong>{points(ticket.potentialPayout)} pts</strong>
          </span>
        )}
      </div>

      {!settled && confirming && (
        <div className="parlay-cancel">
          <span className="parlay-cancel__msg">Refund {points(ticket.stake)} pts?</span>
          <div className="parlay-cancel__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={canceling}
              onClick={onDismissCancel}
            >
              Keep it
            </button>
            <button
              type="button"
              className="parlay-cancel__go"
              disabled={canceling}
              onClick={onConfirmCancel}
            >
              {canceling ? 'Canceling…' : 'Cancel & refund'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="parlay-ticket__error">{error}</div>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function ParlayBoard({ contest }: { contest: ContestDetail }) {
  const { token } = useAuth();
  const { balance, applyBalance } = usePoints();

  const [board, setBoard] = useState<ParlayBoardRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Entering is transparent: the first PLACE enters the contest if we haven't, so
  // building a ticket never dead-ends on "you're not entered". Seeded from the
  // detail read (which may lag reality, hence the retry in onPlace).
  const [entered, setEntered] = useState(contest.myEntry != null);

  // THE TICKET IN PROGRESS. Legs in TAP ORDER (a slip reads in the order it was
  // built), one per game — the swap/remove rules below keep that invariant, which
  // is also what the backend's distinct-games check demands.
  const [draft, setDraft] = useState<Array<{ eventId: string; teamId: string }>>([]);
  // The stake is held as a STRING while typing (so a half-typed "" or "2" doesn't
  // snap back under the fan) and clamped to the board's bounds on blur/place.
  const [stakeText, setStakeText] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  // A gentle, self-clearing notice for the things that aren't errors: hitting
  // maxLegs at tap time, a cancel refund landing.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-ticket cancel state: which is confirming, which is in flight, which failed.
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<{ id: string; message: string } | null>(
    null,
  );

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  // Silent reload (no loading flash) — the live poll's reconcile.
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setBoard(await getParlayBoard(token, contest.id));
    } catch {
      /* keep the prior board; a transient read failure isn't worth blanking it */
    }
  }, [token, contest.id]);

  // Initial load. The board read is a lobby surface (no entry required), so a fan
  // who hasn't entered still sees the slate and the rules.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getParlayBoard(token, contest.id)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        setStakeText(String(defaultStake(b.rules.minStake, b.rules.maxStake)));
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load the board');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, contest.id]);

  // Live poll — only while the board is LIVE, mirroring the other contest bodies.
  const live = board?.status === 'live';
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => void refresh(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, refresh]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // eventId -> the team currently legged on that game, for O(1) chip state.
  const pickedByEvent = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of draft) m.set(l.eventId, l.teamId);
    return m;
  }, [draft]);

  const rules = board?.rules;
  const legCount = draft.length;
  // The rung this leg count prices at. null below minLegs (and for a hand-edited
  // ladder with a hole in it), which is exactly when PLACE stays disabled.
  const multiplier =
    rules && typeof rules.multipliers[String(legCount)] === 'number'
      ? rules.multipliers[String(legCount)]
      : null;

  const stake = Number(stakeText);
  const stakeValid =
    rules != null &&
    Number.isInteger(stake) &&
    stake >= rules.minStake &&
    stake <= rules.maxStake;

  // Clamp a typed stake back inside the bounds. Called on blur and before a
  // place, so the field can hold a transient bad value while the fan types.
  const clampStake = useCallback(() => {
    if (!rules) return;
    const n = Math.round(Number(stakeText));
    const next = Number.isFinite(n) && n > 0
      ? Math.min(Math.max(n, rules.minStake), rules.maxStake)
      : defaultStake(rules.minStake, rules.maxStake);
    setStakeText(String(next));
  }, [rules, stakeText]);

  // THE TAP: add / swap / remove, the three moves the builder has.
  const onTapTeam = useCallback(
    (eventId: string, teamId: string) => {
      if (!rules) return;
      setPlaceError(null);
      const current = pickedByEvent.get(eventId);
      if (current === teamId) {
        // Tapping a picked team takes that leg off the ticket.
        setDraft((d) => d.filter((l) => l.eventId !== eventId));
        return;
      }
      if (current) {
        // Tapping the other side of an already-legged game SWAPS it in place —
        // the leg keeps its slot on the slip rather than jumping to the end.
        setDraft((d) => d.map((l) => (l.eventId === eventId ? { eventId, teamId } : l)));
        return;
      }
      if (draft.length >= rules.maxLegs) {
        // Prevented at tap rather than at submit: the ticket simply can't hold
        // another leg, and saying so now is kinder than a 400 after a stake.
        flash(
          `A ticket carries at most ${rules.maxLegs} legs — remove one to swap in another game.`,
        );
        return;
      }
      setDraft((d) => [...d, { eventId, teamId }]);
    },
    [rules, pickedByEvent, draft.length, flash],
  );

  const onPlace = useCallback(async () => {
    if (!token || !board || !rules || placing) return;
    if (legCount < rules.minLegs || multiplier === null) return;

    const n = Math.round(Number(stakeText));
    const finalStake = Number.isFinite(n) && n > 0
      ? Math.min(Math.max(n, rules.minStake), rules.maxStake)
      : defaultStake(rules.minStake, rules.maxStake);
    setStakeText(String(finalStake));

    setPlacing(true);
    setPlaceError(null);

    // Enter the contest transparently — free, so the wallet doesn't move.
    // Tolerant of a stale "already entered" (our seed flag can lag reality).
    const ensureEntered = async () => {
      if (entered) return;
      try {
        await enterContest(token, contest.id);
      } catch (e) {
        if (!/already entered/i.test(e instanceof Error ? e.message : '')) throw e;
      }
      setEntered(true);
    };

    try {
      await ensureEntered();
      let res;
      try {
        res = await buildParlayTicket(token, contest.id, {
          stake: finalStake,
          legs: draft,
        });
      } catch (e) {
        // Belt-and-braces: if the build 403s for a missing entry (our flag was
        // wrong), enter and retry once so a first ticket never dead-ends.
        if (/enter the contest/i.test(e instanceof Error ? e.message : '')) {
          await enterContest(token, contest.id).catch(() => {});
          setEntered(true);
          res = await buildParlayTicket(token, contest.id, {
            stake: finalStake,
            legs: draft,
          });
        } else {
          throw e;
        }
      }
      // The response carries the built ticket and the new balance, so the book
      // appends the AUTHORITATIVE row (no guessed shape) and the ⚡ chip moves
      // without a wallet re-read.
      applyBalance(res.balance);
      setBoard((b) =>
        b
          ? { ...b, tickets: [...b.tickets, res.ticket], myTicketCount: b.myTicketCount + 1 }
          : b,
      );
      setDraft([]);
      setStakeText(String(defaultStake(rules.minStake, rules.maxStake)));
      flash(
        `Ticket placed — ${res.ticket.legCount} legs ×${formatMultiplier(
          res.ticket.multiplier,
        )} to win ${points(res.ticket.potentialPayout)} pts.`,
      );
    } catch (err) {
      // 'Insufficient points', 'The slate has started; no new tickets', the ticket
      // cap — all surface verbatim under the stub.
      setPlaceError(err instanceof Error ? err.message : 'Could not place that ticket');
    } finally {
      setPlacing(false);
    }
  }, [
    token,
    board,
    rules,
    placing,
    legCount,
    multiplier,
    stakeText,
    entered,
    contest.id,
    draft,
    applyBalance,
    flash,
  ]);

  const onCancelTicket = useCallback(
    async (ticketId: string) => {
      if (!token || cancelingId) return;
      setCancelingId(ticketId);
      setCancelError(null);
      try {
        const res = await cancelParlayTicket(token, contest.id, ticketId);
        applyBalance(res.balance);
        setBoard((b) =>
          b
            ? {
                ...b,
                tickets: b.tickets.filter((t) => t.id !== ticketId),
                myTicketCount: Math.max(0, b.myTicketCount - 1),
              }
            : b,
        );
        setConfirmCancel(null);
        flash(`Ticket canceled — ${points(res.refunded)} pts refunded.`);
      } catch (err) {
        setCancelError({
          id: ticketId,
          message: err instanceof Error ? err.message : 'Could not cancel that ticket',
        });
      } finally {
        setCancelingId(null);
      }
    },
    [token, cancelingId, contest.id, applyBalance, flash],
  );

  if (loading) return <div className="card muted">Loading the board…</div>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!board || !rules) return null;

  const open = board.status === 'open';
  const capReached = board.myTicketCount >= board.ticketCap;
  // Any started game closes the whole board (the v1 rule), so the builder goes
  // away the moment that's true even if the lazy lock hasn't landed yet.
  const slateStarted = board.slate.some(gameStarted);
  const building = open && !slateStarted;

  const potential = multiplier !== null && stakeValid ? payoutFor(stake, multiplier) : null;
  const underMin = legCount < rules.minLegs;
  const canPlace = building && !underMin && multiplier !== null && stakeValid && !capReached;
  // A soft pre-check so the button reads honestly; the backend's 409 is still the
  // authority (the chip can be stale), so we don't hard-block on it.
  const shortOnPoints = balance !== null && stakeValid && balance < stake;
  const quickStakes = QUICK_STAKES.filter((s) => s >= rules.minStake && s <= rules.maxStake);

  return (
    <div className="contest-detail__body parlay">
      {/* ---- Header: the ladder as the hook, plus my count and the bounds ---- */}
      <header className="parlay-head">
        <div className="parlay-ladder">
          <span className="parlay-ladder__label">Payout ladder</span>
          <span className="parlay-ladder__rungs">{parlayLadderLabel(rules.multipliers)}</span>
        </div>
        <div className="parlay-stats">
          <div className="parlay-stat">
            <span className="parlay-stat__label">Your tickets</span>
            <span className="parlay-stat__value">
              {board.myTicketCount}
              <span className="parlay-stat__of"> / {board.ticketCap}</span>
            </span>
          </div>
          <div className="parlay-stat">
            <span className="parlay-stat__label">Stake</span>
            <span className="parlay-stat__value">
              {points(rules.minStake)}–{points(rules.maxStake)}
              <span className="parlay-stat__of"> pts</span>
            </span>
          </div>
          <div className="parlay-stat">
            <span className="parlay-stat__label">Legs</span>
            <span className="parlay-stat__value">
              {rules.minLegs}–{rules.maxLegs}
            </span>
          </div>
        </div>
      </header>

      {notice && <div className="parlay-notice">{notice}</div>}

      {/* ---- Status notes for the non-building states ---- */}
      {!building && (
        <p className="parlay-note muted">
          {board.status === 'canceled'
            ? 'This board was canceled.'
            : board.status === 'draft'
            ? "This board isn't open yet."
            : board.tickets.length > 0
            ? 'The slate has started — no new tickets. Your tickets ride below.'
            : 'The slate has started, so ticket building is closed on this board.'}
        </p>
      )}

      {/* ---- THE BUILDER ---- */}
      {building && (
        <section className="parlay-builder">
          <div className="parlay-builder__head">
            <h2 className="game-articles__head">Build a ticket</h2>
            <span className="parlay-builder__hint muted">
              Tap a team to add a leg · tap the other side to swap · tap it again to
              remove.
            </span>
          </div>

          {capReached && (
            <p className="parlay-note muted">
              You&apos;re holding the maximum {board.ticketCap} tickets on this board —
              cancel one to build another.
            </p>
          )}

          <ul className="parlay-slate">
            {board.slate.map((g) => (
              <SlateRow
                key={g.eventId}
                game={g}
                pickedTeamId={pickedByEvent.get(g.eventId) ?? null}
                disabled={placing || capReached}
                onTap={(teamId) => onTapTeam(g.eventId, teamId)}
              />
            ))}
          </ul>

          {/* ---- THE TICKET STUB. After the slate in DOM order so it can dock to
                  the bottom of the viewport on a phone (sticky) while the slate
                  scrolls above it. ---- */}
          <div
            className={`parlay-stub${legCount === 0 ? ' parlay-stub--empty' : ''}`}
            aria-label="Ticket in progress"
          >
            <div className="parlay-stub__head">
              <span className="parlay-stub__title">Your ticket</span>
              <span className="parlay-stub__count">
                {legCount} {legCount === 1 ? 'leg' : 'legs'}
                {multiplier !== null && (
                  <span className="parlay-stub__mult"> ×{formatMultiplier(multiplier)}</span>
                )}
              </span>
            </div>

            {legCount === 0 ? (
              <p className="parlay-stub__empty">
                Tap {rules.minLegs} or more teams above to start a ticket.
              </p>
            ) : (
              <ul className="parlay-stub__legs">
                {draft.map((l) => {
                  const g = board.slate.find((s) => s.eventId === l.eventId);
                  const team =
                    g && (l.teamId === g.homeTeamId ? g.homeTeam : g.awayTeam);
                  return (
                    <li key={l.eventId} className="parlay-stub__leg">
                      <span className="parlay-stub__team">{team ?? 'Your pick'}</span>
                      <span className="parlay-stub__matchup">
                        {g ? `${g.awayTeam ?? 'TBD'} @ ${g.homeTeam ?? 'TBD'}` : ''}
                      </span>
                      <button
                        type="button"
                        className="parlay-stub__remove"
                        aria-label={`Remove ${team ?? 'this leg'}`}
                        disabled={placing}
                        onClick={() => setDraft((d) => d.filter((x) => x.eventId !== l.eventId))}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="parlay-stake">
              <label className="parlay-stake__label" htmlFor="parlay-stake-input">
                Stake
              </label>
              <div className="parlay-stake__row">
                <input
                  id="parlay-stake-input"
                  className="parlay-stake__input"
                  type="number"
                  inputMode="numeric"
                  min={rules.minStake}
                  max={rules.maxStake}
                  step={1}
                  value={stakeText}
                  disabled={placing}
                  onChange={(e) => setStakeText(e.target.value)}
                  onBlur={clampStake}
                />
                <span className="parlay-stake__unit">pts</span>
                <div className="parlay-stake__quick">
                  {quickStakes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`parlay-stake__chip${
                        stakeValid && stake === s ? ' parlay-stake__chip--on' : ''
                      }`}
                      aria-pressed={stakeValid && stake === s}
                      disabled={placing}
                      onClick={() => setStakeText(String(s))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              {!stakeValid && (
                <p className="parlay-stake__hint">
                  Stake between {points(rules.minStake)} and {points(rules.maxStake)} pts.
                </p>
              )}
            </div>

            <div className="parlay-stub__win">
              {potential !== null ? (
                <>
                  Win <strong>{points(potential)} pts</strong>
                </>
              ) : (
                <span className="muted">
                  {underMin
                    ? `Pick at least ${rules.minLegs}`
                    : 'Set a stake to price this ticket'}
                </span>
              )}
            </div>

            {placeError && <div className="error">{placeError}</div>}

            <button
              type="button"
              className="parlay-place"
              disabled={!canPlace || placing}
              onClick={() => void onPlace()}
            >
              {placing
                ? 'Placing…'
                : capReached
                ? 'Ticket cap reached'
                : underMin
                ? `Pick at least ${rules.minLegs}`
                : potential !== null
                ? `Place ticket · ${points(stake)} pts`
                : 'Place ticket'}
            </button>
            {shortOnPoints && canPlace && (
              <p className="parlay-stub__short muted">
                You&apos;re holding {points(balance ?? 0)} pts — this stake is{' '}
                {points(stake)}.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---- MY TICKETS ---- */}
      <section className="parlay-book">
        <div className="parlay-book__head">
          <h2 className="game-articles__head">Your tickets</h2>
          {board.tickets.length > 0 && (
            <span className="parlay-book__tally">
              {points(board.tickets.reduce((sum, t) => sum + t.stake, 0))} pts staked
            </span>
          )}
        </div>
        {board.tickets.length === 0 ? (
          <div className="results-empty">
            <p className="results-empty__title">No tickets yet</p>
            <p className="results-empty__hint">
              {building
                ? 'Build one above — pick your teams, set a stake, place it.'
                : 'This board closed before you built one.'}
            </p>
          </div>
        ) : (
          <ul className="parlay-ticket__list">
            {board.tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                cancelable={open && t.status === 'pending'}
                confirming={confirmCancel === t.id}
                canceling={cancelingId === t.id}
                error={cancelError?.id === t.id ? cancelError.message : null}
                onAskCancel={() => {
                  setCancelError(null);
                  setConfirmCancel(t.id);
                }}
                onDismissCancel={() => setConfirmCancel(null)}
                onConfirmCancel={() => void onCancelTicket(t.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
