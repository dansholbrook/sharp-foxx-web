'use client';

// The SQUARES surface for /contests/[id] when type==='squares'. A squares
// contest IS a contest (the chassis owns enter/leaderboard, shared with pick'em),
// but its body is the GRID — the whole reason this surface exists — rather than a
// pick sheet. This component owns the boards read, the tap-to-claim /
// tap-to-release gameplay, the digit reveal at lock, and the per-period prize
// table with its live win treatment.
//
// v2 — MULTI-BOARD. A contest runs UNLIMITED boards that fill STRICTLY ONE AT A
// TIME: board 2 accepts nothing until board 1's 100 squares are gone, and filling
// square #100 spawns the next board. So the surface gains a BOARD SWITCHER, and
// the single most important thing the UI has to make obvious is WHICH BOARD YOUR
// TAP LANDS ON — only the 'filling' board's cells are tappable, it is labelled
// "← you are here", and switching to a full/locked board puts the grid in a
// read-only mode with an explicit note. The client never sends a board id (the
// server routes claims to the filling board); the switcher is pure navigation.
//
// At game start every board locks AS-IS. A partially-filled board plays with its
// holes and SHARP FOXX OWNS the unclaimed squares — rendered with a subtle fox
// mark. If an SF-owned square wins a period, the prize is DEDICATED TO THE NEXT
// PROMOTION: shown as such in the results, paid to nobody, never kept.
//
// POINTS ONLY: entering is FREE (the chassis entry row is just leaderboard
// presence); each claimed square spends config.squareCost through the ledger, so
// the ⚡ chip moves on claim and release, never on enter. Mobile-first — the grid
// is a phone activity, so cells are thumb-sized and the whole 11-column board
// fits a 390px screen (scrolling only as a last resort), and the switcher wraps.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth-context';
import { usePoints } from '../../points-context';
import {
  getSquaresGrid,
  claimSquare,
  releaseSquare,
  enterContest,
  points,
  squaresPeriodLabel,
  ContestDetail,
  SquaresGrid,
  SquaresBoard as SquaresBoardData,
  SquaresPrizeRow,
  SquaresClaim,
} from '../../api';

// Poll the grid on the same cadence the pick'em scorecard uses while the game is
// LIVE — scores and freshly-landed winning squares both move courtside, so a
// gentle refresh keeps the board honest without a socket. 30s: cheap.
const LIVE_POLL_MS = 30_000;

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

// A short badge for a claimed square: two initials from the owner's name, so 100
// cells stay legible at 34px. Falls back to a star when the name is unknown (an
// unlinked user, or the just-placed optimistic square before its read comes back).
function initials(name: string | null): string {
  if (!name) return '★';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '★';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const key = (row: number, col: number) => `${row},${col}`;

// The switcher's status word for a board. 'filling' is the only claimable state,
// and it is the one the fan needs to spot instantly.
function boardStatusLabel(b: SquaresBoardData): string {
  switch (b.status) {
    case 'filling':
      return 'Filling';
    case 'full':
      return 'Full';
    case 'locked':
      return 'Locked';
    case 'settled':
      return 'Settled';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// The per-period prize table row (for ONE board)
// ---------------------------------------------------------------------------

function PrizeRow({ row, meId }: { row: SquaresPrizeRow; meId: string | undefined }) {
  const label = squaresPeriodLabel(row.period);

  if (row.status === 'pending') {
    return (
      <li className="sqprize__row">
        <span className="sqprize__period">{label}</span>
        <span className="sqprize__pool">{points(row.prospectivePool)} pts</span>
        <span className="sqprize__status sqprize__status--pending">Pending</span>
      </li>
    );
  }

  // Graded: 'won' (a fan owned the winning square) or 'dedicated' (it landed on a
  // Sharp Foxx square, so the prize goes to the next promotion — never paid out,
  // never kept).
  const won = row.status === 'won';
  const mineWon = won && row.winner?.userId === meId;
  return (
    <li
      className={`sqprize__row${won ? ' sqprize__row--won' : ''}${
        !won ? ' sqprize__row--dedicated' : ''
      }`}
    >
      <span className="sqprize__period">{label}</span>
      <span className="sqprize__pool">
        {won ? `${points(row.pointsPaid)} pts` : `${points(row.basePoints)} pts`}
        <span className="sqprize__digits">
          {' '}
          · {row.awayDigit}–{row.homeDigit}
        </span>
      </span>
      {won ? (
        <span className="sqprize__status sqprize__status--won">
          {mineWon ? 'You won' : row.winner?.displayName ?? 'Winner'}
        </span>
      ) : (
        <span className="sqprize__status sqprize__status--dedicated">
          <span className="sqprize__fox" aria-hidden="true">
            🦊
          </span>
          {row.dedicatedNote ?? 'Dedicated to next promotion'}
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function SquaresBoard({ contest }: { contest: ContestDetail }) {
  const { token, user } = useAuth();
  const { applyBalance } = usePoints();

  const [grid, setGrid] = useState<SquaresGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Which board the switcher is showing. null = "follow the contest" (the filling
  // board, or the last board once everything has locked). A fan who has
  // deliberately switched to look at board 1 keeps that view across polls.
  const [viewBoard, setViewBoard] = useState<number | null>(null);

  // Entering is transparent: the first claim enters the contest if we haven't,
  // so one tap never errors with "not entered". Seed from the detail read.
  const [entered, setEntered] = useState(contest.myEntry != null);

  // Per-cell transient UI. claimingCells: which squares have a claim in flight
  // (disabled + spinner). shakeCell: the square that a 409 revealed was taken by
  // someone else (a one-shot shake). pendingRelease: a two-step release confirm.
  // All three are keyed by BOARD + cell, so switching boards mid-flight can't
  // paint a spinner on the wrong grid.
  const [claimingCells, setClaimingCells] = useState<Set<string>>(new Set());
  const [shakeCell, setShakeCell] = useState<string | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [releasing, setReleasing] = useState(false);
  // A board-level message bar for the outcomes that don't belong on one cell:
  // insufficient points, "square taken", a release refund note, a board fill.
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Silent reload (no loading flash) — used by the live poll and after a "taken"
  // 409, so the cell flips to its real owner.
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setGrid(await getSquaresGrid(token, contest.id));
    } catch {
      /* keep the prior grid; a transient read failure isn't worth blanking it */
    }
  }, [token, contest.id]);

  // Initial load.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getSquaresGrid(token, contest.id)
      .then((g) => {
        if (!cancelled) setGrid(g);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load grid');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, contest.id]);

  // Live poll — only while the contest is LIVE (open boards change only on the
  // fan's own taps; final boards are settled), mirroring the scorecard.
  const live = grid?.status === 'live';
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => void refresh(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, refresh]);

  useEffect(
    () => () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
    },
    [],
  );

  // The board on screen. Default (viewBoard null) follows the action: the board
  // that's filling, or — once the contest locks and nothing is filling — the last
  // board, which is the partially-filled one everybody wants to see.
  const boards = grid?.boards ?? [];
  const defaultBoardNumber =
    grid?.currentBoardNumber ?? (boards.length ? boards[boards.length - 1].boardNumber : null);
  const shownNumber = viewBoard ?? defaultBoardNumber;
  const board = boards.find((b) => b.boardNumber === shownNumber) ?? boards[0] ?? null;

  // Claims on the SHOWN board indexed for O(1) cell lookup.
  const claimMap = useMemo(() => {
    const m = new Map<string, SquaresClaim>();
    if (board) for (const c of board.claimed) m.set(key(c.row, c.col), c);
    return m;
  }, [board]);

  // Winning squares on the SHOWN board. 'won' rows get the green treatment;
  // 'dedicated' rows (Sharp Foxx's square hit) get their own, so a fan can see the
  // digits landed there without it reading as somebody's payday.
  const winMap = useMemo(() => {
    const m = new Map<string, { dedicated: boolean; winnerId?: string }>();
    if (board) {
      for (const p of board.prizeTable) {
        if (p.status === 'won') {
          m.set(key(p.winningSquare.row, p.winningSquare.col), {
            dedicated: false,
            winnerId: p.winner?.userId,
          });
        } else if (p.status === 'dedicated') {
          m.set(key(p.winningSquare.row, p.winningSquare.col), { dedicated: true });
        }
      }
    }
    return m;
  }, [board]);

  // The caller's total winnings across EVERY board — a fan can hold squares on
  // several, and the header callout is their whole take from this contest.
  const myWinnings = useMemo(() => {
    if (!grid || !user) return 0;
    let sum = 0;
    for (const b of grid.boards) {
      for (const p of b.prizeTable) {
        if (p.status === 'won' && p.winner?.userId === user.id) sum += p.pointsPaid;
      }
    }
    return sum;
  }, [grid, user]);

  // Claims land on the FILLING board, whatever the switcher is showing. Tapping is
  // therefore allowed only when the shown board IS that board.
  const claimable = grid?.status === 'open' && board?.isCurrent === true;

  const cellKey = useCallback(
    (row: number, col: number) => `${board?.boardNumber ?? 0}:${key(row, col)}`,
    [board?.boardNumber],
  );

  const onCellTap = useCallback(
    async (row: number, col: number) => {
      if (!token || !grid || !board || !claimable) return;
      const k = key(row, col);
      const ck = cellKey(row, col);
      const existing = claimMap.get(k);

      // Tapping my own square opens the release confirm; someone else's is inert.
      if (existing) {
        if (existing.mine) {
          setNotice(null);
          setPendingRelease({ row, col });
        }
        return;
      }
      if (claimingCells.has(ck)) return;

      const boardNumber = board.boardNumber;

      // Optimistic: paint the square as mine at once so the tap feels instant.
      setClaimingCells((s) => new Set(s).add(ck));
      setShakeCell(null);
      setNotice(null);
      const patchBoard = (
        g: SquaresGrid,
        fn: (b: SquaresBoardData) => SquaresBoardData,
      ): SquaresGrid => ({
        ...g,
        boards: g.boards.map((b) => (b.boardNumber === boardNumber ? fn(b) : b)),
      });
      setGrid((g) =>
        g
          ? patchBoard(g, (b) => ({
              ...b,
              claimed: [...b.claimed, { row, col, displayName: null, mine: true }],
              claimedCount: b.claimedCount + 1,
              myClaimCount: b.myClaimCount + 1,
            }))
          : g,
      );

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
          res = await claimSquare(token, contest.id, { row, col });
        } catch (e) {
          // Belt-and-braces: if the claim 403s for a missing entry (our flag was
          // wrong), enter and retry once so a first tap never dead-ends.
          if (/enter the contest/i.test(e instanceof Error ? e.message : '')) {
            await enterContest(token, contest.id).catch(() => {});
            setEntered(true);
            res = await claimSquare(token, contest.id, { row, col });
          } else {
            throw e;
          }
        }
        if (res.balance != null) applyBalance(res.balance);
        setGrid((g) =>
          g ? patchBoard(g, (b) => ({ ...b, myClaimCount: res!.myClaimCount })) : g,
        );

        // THE FILL: this claim took square #100 and spawned the next board. Refresh
        // to pick the new board up, follow it, and say so — the fan just closed a
        // board out, which is the most satisfying moment the game has.
        if (res.nextBoardNumber != null) {
          setNotice({
            kind: 'info',
            text: `You filled board ${res.boardNumber}! Board ${res.nextBoardNumber} is now open.`,
          });
          setViewBoard(null); // follow the action onto the new filling board
          void refresh();
        }
      } catch (err) {
        // Roll back the optimistic square (its (row,col) was unclaimed before, so
        // it's unique to this tap).
        setGrid((g) =>
          g
            ? patchBoard(g, (b) => ({
                ...b,
                claimed: b.claimed.filter((c) => !(c.row === row && c.col === col)),
                claimedCount: Math.max(0, b.claimedCount - 1),
                myClaimCount: Math.max(0, b.myClaimCount - 1),
              }))
            : g,
        );
        const msg = err instanceof Error ? err.message : 'Could not claim that square';
        if (/taken|already/i.test(msg)) {
          // Beaten to it — reload to show the real owner, shake the cell, note it.
          setShakeCell(ck);
          if (shakeTimer.current) clearTimeout(shakeTimer.current);
          shakeTimer.current = setTimeout(() => setShakeCell(null), 600);
          setNotice({ kind: 'info', text: 'That square was just taken — try another.' });
          void refresh();
        } else {
          // Insufficient points, contest locking under the fan, max squares, etc.
          setNotice({ kind: 'error', text: msg });
        }
      } finally {
        setClaimingCells((s) => {
          const n = new Set(s);
          n.delete(ck);
          return n;
        });
      }
    },
    [
      token, grid, board, claimable, claimMap, claimingCells, cellKey, entered,
      contest.id, applyBalance, refresh,
    ],
  );

  const onConfirmRelease = useCallback(async () => {
    if (!token || !pendingRelease || releasing || !board) return;
    const { row, col } = pendingRelease;
    const boardNumber = board.boardNumber;
    setReleasing(true);
    try {
      const res = await releaseSquare(token, contest.id, { row, col });
      if (res.balance != null) applyBalance(res.balance);
      setGrid((g) =>
        g
          ? {
              ...g,
              boards: g.boards.map((b) =>
                b.boardNumber === boardNumber
                  ? {
                      ...b,
                      claimed: b.claimed.filter((c) => !(c.row === row && c.col === col)),
                      claimedCount: Math.max(0, b.claimedCount - 1),
                      myClaimCount: Math.max(0, b.myClaimCount - 1),
                    }
                  : b,
              ),
            }
          : g,
      );
      setNotice({
        kind: 'info',
        text: `Square released — ${points(grid?.squareCost ?? 0)} pts refunded.`,
      });
      setPendingRelease(null);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not release' });
      setPendingRelease(null);
      void refresh();
    } finally {
      setReleasing(false);
    }
  }, [token, pendingRelease, releasing, board, contest.id, applyBalance, grid?.squareCost, refresh]);

  if (loading) return <div className="card muted">Loading the grid…</div>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!grid || !board) return null;

  const ev = grid.event;
  const home = ev?.homeTeam ?? 'Home';
  const away = ev?.awayTeam ?? 'Away';
  // Digits belong to THIS board — each board is randomized independently.
  const revealed = board.rowDigits != null && board.colDigits != null;
  const hasScore = ev?.homeScore != null && ev?.awayScore != null;
  // A locked board that never filled: its empty squares are Sharp Foxx's.
  const sfBoard = (board.status === 'locked' || board.status === 'settled') && board.sfOwnedCount > 0;

  const whenLine =
    ev?.status === 'final' ? 'Final' : ev?.status === 'live' ? 'Live' : formatWhen(ev?.scheduledAt ?? '');

  return (
    <div className="contest-detail__body sqboard">
      {/* ---- Header: matchup, time, cost, my count, winnings ---- */}
      <header className="sqboard-head">
        <div className="sqboard-matchup">
          <span className="sqboard-matchup__teams">
            {away} <span className="sqboard-at">@</span> {home}
          </span>
          <span className="sqboard-matchup__when">{whenLine}</span>
        </div>
        <div className="sqboard-stats">
          <div className="sqboard-stat">
            <span className="sqboard-stat__label">Per square</span>
            <span className="sqboard-stat__value">
              {grid.squareCost > 0 ? `${points(grid.squareCost)} pts` : 'Free'}
            </span>
          </div>
          <div className="sqboard-stat">
            <span className="sqboard-stat__label">
              {grid.totalBoards > 1 ? 'You own (all boards)' : 'You own'}
            </span>
            <span className="sqboard-stat__value">{grid.myClaimCount}</span>
          </div>
          <div className="sqboard-stat">
            <span className="sqboard-stat__label">Boards</span>
            <span className="sqboard-stat__value">{grid.totalBoards}</span>
          </div>
          {revealed && hasScore && (
            <div className="sqboard-stat">
              <span className="sqboard-stat__label">Score</span>
              <span className="sqboard-stat__value">
                {ev!.awayScore} – {ev!.homeScore}
              </span>
            </div>
          )}
          {myWinnings > 0 && (
            <div className="sqboard-stat sqboard-stat--won">
              <span className="sqboard-stat__label">Your winnings</span>
              <span className="sqboard-stat__value">{points(myWinnings)} pts</span>
            </div>
          )}
        </div>
      </header>

      {/* ---- THE BOARD SWITCHER ----
          Boards fill one at a time, so this doubles as the game's progress bar:
          every full board behind you was sold out, and exactly one is live. On
          mobile the pills wrap rather than scroll sideways. */}
      {grid.totalBoards > 1 || grid.currentBoardNumber != null ? (
        <nav className="sqboards" aria-label="Squares boards">
          <ul className="sqboards__list">
            {grid.boards.map((b) => {
              const shown = b.boardNumber === board.boardNumber;
              return (
                <li key={b.boardNumber}>
                  <button
                    type="button"
                    className={[
                      'sqboards__pill',
                      shown ? 'sqboards__pill--shown' : '',
                      b.isCurrent ? 'sqboards__pill--current' : '',
                      b.status === 'full' ? 'sqboards__pill--full' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-current={shown ? 'true' : undefined}
                    onClick={() => setViewBoard(b.boardNumber)}
                  >
                    <span className="sqboards__name">Board {b.boardNumber}</span>
                    <span className="sqboards__sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="sqboards__state">{boardStatusLabel(b)}</span>
                    {b.isCurrent && (
                      <span className="sqboards__here">← you are here</span>
                    )}
                    {b.myClaimCount > 0 && (
                      <span className="sqboards__mine" title="Your squares on this board">
                        {b.myClaimCount}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="sqboards__note muted">
            Boards fill one at a time — board {board.boardNumber} of {grid.totalBoards}
            {board.status === 'filling'
              ? ` is taking claims (${board.claimedCount}/100 gone). The next board opens the moment it fills.`
              : ' is closed to claims.'}
          </p>
        </nav>
      ) : null}

      {/* ---- The prize table for the SHOWN board ---- */}
      {board.prizeTable.length > 0 && (
        <section className="sqprize">
          <h3 className="sqprize__head">
            Board {board.boardNumber} prizes
            {grid.totalBoards > 1 && <span className="sqprize__each"> · every board pays this</span>}
          </h3>
          <ul className="sqprize__list">
            {board.prizeTable.map((p) => (
              <PrizeRow key={String(p.period)} row={p} meId={user?.id} />
            ))}
          </ul>
          <p className="sqprize__note muted">
            {grid.totalBoards > 1
              ? 'Each board is its own prize pool over the same game, with its own digits. '
              : ''}
            If a period lands on a Sharp Foxx square, that prize is dedicated to the next
            promotion — never paid out, never kept.
          </p>
        </section>
      )}

      {/* ---- Status / digit note ---- */}
      {grid.status === 'draft' && (
        <p className="sqgrid-note muted">This squares board isn&apos;t open yet.</p>
      )}
      {grid.status === 'canceled' && (
        <p className="sqgrid-note muted">This contest was canceled.</p>
      )}
      {claimable && (
        <p className="sqgrid-note muted">
          Digits randomize at game start. Tap an open square to claim it
          {grid.squareCost > 0 ? ` · ${points(grid.squareCost)} pts each` : ''}. Tap your own
          to release.
        </p>
      )}
      {/* Looking at a closed board while another is taking claims — say so, and
          offer the one tap back to where a claim would actually land. */}
      {!claimable && grid.status === 'open' && grid.currentBoardNumber != null && (
        <p className="sqgrid-note muted">
          Board {board.boardNumber} is {board.status === 'full' ? 'full' : 'closed'} — claims
          land on board {grid.currentBoardNumber}.{' '}
          <button
            type="button"
            className="sqboards__jump"
            onClick={() => setViewBoard(grid.currentBoardNumber)}
          >
            Go there
          </button>
        </p>
      )}
      {revealed && (
        <p className="sqgrid-note muted">
          Board {board.boardNumber}&apos;s digits are locked in
          {grid.totalBoards > 1 ? ' (each board is randomized separately)' : ''}.{' '}
          {grid.status === 'final'
            ? 'Final results are in the prize table.'
            : 'Winning squares light up as each period lands.'}
        </p>
      )}
      {sfBoard && (
        <p className="sqgrid-note muted">
          <span aria-hidden="true">🦊</span> This board locked with {board.sfOwnedCount} square
          {board.sfOwnedCount === 1 ? '' : 's'} unclaimed — Sharp Foxx holds them. If one wins, that
          prize is dedicated to the next promotion.
        </p>
      )}

      {notice && (
        <div className={notice.kind === 'error' ? 'error' : 'sqboard-notice'}>{notice.text}</div>
      )}

      {/* ---- Release confirm ---- */}
      {pendingRelease && (
        <div className="sqrelease">
          <span className="sqrelease__msg">
            Release your square and refund {points(grid.squareCost)} pts?
          </span>
          <div className="sqrelease__actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={releasing}
              onClick={() => setPendingRelease(null)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="sqrelease__go"
              disabled={releasing}
              onClick={() => void onConfirmRelease()}
            >
              {releasing ? 'Releasing…' : 'Release & refund'}
            </button>
          </div>
        </div>
      )}

      {/* ---- THE GRID (the shown board) ---- */}
      <div className="sqgrid-scroll">
        <div
          className={`sqgrid${claimable ? '' : ' sqgrid--readonly'}`}
          role="grid"
          aria-label={`${away} vs ${home} squares, board ${board.boardNumber}`}
        >
          {/* Corner: the two axes. Away runs across the top, Home down the side. */}
          <div className="sqgrid-corner">
            <span className="sqgrid-corner__away">{away} →</span>
            <span className="sqgrid-corner__home">{home} ↓</span>
          </div>
          {/* Top header row: the away-team digits (one per column). */}
          {Array.from({ length: 10 }, (_, col) => (
            <div key={`ch${col}`} className="sqgrid-head sqgrid-head--col">
              {revealed ? board.colDigits![col] : '?'}
            </div>
          ))}

          {/* Ten rows, each led by its home-team digit header. */}
          {Array.from({ length: 10 }, (_, row) => (
            <Fragment key={`r${row}`}>
              <div className="sqgrid-head sqgrid-head--row">
                {revealed ? board.rowDigits![row] : '?'}
              </div>
              {Array.from({ length: 10 }, (_, col) => {
                const k = key(row, col);
                const ck = cellKey(row, col);
                const claim = claimMap.get(k);
                const mine = claim?.mine ?? false;
                const win = winMap.get(k);
                const wonMine = win != null && !win.dedicated && win.winnerId === user?.id;
                const claiming = claimingCells.has(ck);
                // Only the filling board takes taps — that is the whole model, so
                // the UI never lets a tap look possible anywhere else.
                const tappable = claimable && (mine || !claim);
                // On a LOCKED board an empty square is Sharp Foxx's; before lock
                // it's simply still for sale.
                const sf = !claim && (board.status === 'locked' || board.status === 'settled');
                const label = claim
                  ? initials(mine ? claim.displayName ?? user?.displayName ?? null : claim.displayName)
                  : sf
                    ? '🦊'
                    : '';

                const cls = [
                  'sqgrid-cell',
                  claim ? 'sqgrid-cell--taken' : 'sqgrid-cell--open',
                  mine ? 'sqgrid-cell--mine' : '',
                  sf ? 'sqgrid-cell--sf' : '',
                  win ? 'sqgrid-cell--won' : '',
                  win?.dedicated ? 'sqgrid-cell--dedicated' : '',
                  wonMine ? 'sqgrid-cell--won-mine' : '',
                  claiming ? 'sqgrid-cell--claiming' : '',
                  shakeCell === ck ? 'sqgrid-cell--shake' : '',
                  pendingRelease && pendingRelease.row === row && pendingRelease.col === col
                    ? 'sqgrid-cell--releasing'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                const aria = claim
                  ? mine
                    ? `Your square, row ${row} column ${col}${claimable ? ' — tap to release' : ''}`
                    : `Claimed by ${claim.displayName ?? 'a fan'}, row ${row} column ${col}`
                  : sf
                    ? `Sharp Foxx square, row ${row} column ${col}`
                    : `Open square, row ${row} column ${col}${claimable ? ' — tap to claim' : ''}`;

                return (
                  <button
                    key={k}
                    type="button"
                    role="gridcell"
                    className={cls}
                    disabled={!tappable || claiming}
                    aria-label={aria}
                    onClick={() => void onCellTap(row, col)}
                  >
                    <span className="sqgrid-cell__mark">{label}</span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
