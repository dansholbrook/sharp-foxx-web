'use client';

// The SQUARES surface for /contests/[id] when type==='squares'. A squares
// contest IS a contest (the chassis owns enter/leaderboard, shared with pick'em),
// but its body is the 10x10 GRID — the whole reason this surface exists — rather
// than a pick sheet. This component owns the grid read, the tap-to-claim /
// tap-to-release gameplay, the digit reveal at lock, and the per-period prize
// table with its live win treatment.
//
// POINTS ONLY: entering is FREE (the chassis entry row is just leaderboard
// presence); each claimed square spends config.squareCost through the ledger, so
// the ⚡ chip moves on claim and release, never on enter. Mobile-first — the grid
// is a phone activity, so cells are thumb-sized and the whole 11-column board
// fits a 390px screen (scrolling only as a last resort).

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

// ---------------------------------------------------------------------------
// The per-period prize table row
// ---------------------------------------------------------------------------

function PrizeRow({ row, meId }: { row: SquaresPrizeRow; meId: string | undefined }) {
  const label = squaresPeriodLabel(row.period);

  if (row.status === 'pending') {
    return (
      <li className="sqprize__row">
        <span className="sqprize__period">{label}</span>
        <span className="sqprize__pool">
          {points(row.prospectivePool)} pts
          {row.rolledIn > 0 && (
            <span className="sqprize__roll"> · {points(row.rolledIn)} rolled in</span>
          )}
        </span>
        <span className="sqprize__status sqprize__status--pending">Pending</span>
      </li>
    );
  }

  // Graded: 'won' (a fan owned the winning square) or 'unclaimed' (it landed on
  // an empty square; its pool rolled out per unclaimedRule).
  const won = row.status === 'won';
  const mineWon = won && row.winner?.userId === meId;
  return (
    <li className={`sqprize__row${won ? ' sqprize__row--won' : ''}`}>
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
        <span className="sqprize__status sqprize__status--unclaimed">Unclaimed</span>
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

  // Entering is transparent: the first claim enters the contest if we haven't,
  // so one tap never errors with "not entered". Seed from the detail read.
  const [entered, setEntered] = useState(contest.myEntry != null);

  // Per-cell transient UI. claimingCells: which squares have a claim in flight
  // (disabled + spinner). shakeCell: the square that a 409 revealed was taken by
  // someone else (a one-shot shake). pendingRelease: a two-step release confirm.
  const [claimingCells, setClaimingCells] = useState<Set<string>>(new Set());
  const [shakeCell, setShakeCell] = useState<string | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [releasing, setReleasing] = useState(false);
  // A board-level message bar for the outcomes that don't belong on one cell:
  // insufficient points, "square taken", a release refund note.
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

  // Claimed squares indexed for O(1) cell lookup.
  const claimMap = useMemo(() => {
    const m = new Map<string, SquaresClaim>();
    if (grid) for (const c of grid.claimed) m.set(key(c.row, c.col), c);
    return m;
  }, [grid]);

  // Winning squares (graded 'won' rows carry the landing square) for the green
  // win treatment. A square that hosted an unclaimed win isn't marked — the
  // treatment is for squares a fan actually won.
  const winMap = useMemo(() => {
    const m = new Map<string, string | undefined>(); // cell -> winner userId
    if (grid) {
      for (const p of grid.prizeTable) {
        if (p.status === 'won') m.set(key(p.winningSquare.row, p.winningSquare.col), p.winner?.userId);
      }
    }
    return m;
  }, [grid]);

  // The caller's total winnings across graded periods, for the header callout.
  const myWinnings = useMemo(() => {
    if (!grid || !user) return 0;
    let sum = 0;
    for (const p of grid.prizeTable) {
      if (p.status === 'won' && p.winner?.userId === user.id) sum += p.pointsPaid;
    }
    return sum;
  }, [grid, user]);

  const onCellTap = useCallback(
    async (row: number, col: number) => {
      if (!token || !grid || grid.status !== 'open') return;
      const k = key(row, col);
      const existing = claimMap.get(k);

      // Tapping my own square opens the release confirm; someone else's is inert.
      if (existing) {
        if (existing.mine) {
          setNotice(null);
          setPendingRelease({ row, col });
        }
        return;
      }
      if (claimingCells.has(k)) return;

      // Optimistic: paint the square as mine at once so the tap feels instant.
      setClaimingCells((s) => new Set(s).add(k));
      setShakeCell(null);
      setNotice(null);
      setGrid((g) =>
        g
          ? {
              ...g,
              claimed: [...g.claimed, { row, col, displayName: null, mine: true }],
              myClaimCount: g.myClaimCount + 1,
            }
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
        setGrid((g) => (g ? { ...g, myClaimCount: res.myClaimCount } : g));
      } catch (err) {
        // Roll back the optimistic square (its (row,col) was unclaimed before, so
        // it's unique to this tap).
        setGrid((g) =>
          g
            ? {
                ...g,
                claimed: g.claimed.filter((c) => !(c.row === row && c.col === col)),
                myClaimCount: Math.max(0, g.myClaimCount - 1),
              }
            : g,
        );
        const msg = err instanceof Error ? err.message : 'Could not claim that square';
        if (/taken|already/i.test(msg)) {
          // Beaten to it — reload to show the real owner, shake the cell, note it.
          setShakeCell(k);
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
          n.delete(k);
          return n;
        });
      }
    },
    [token, grid, claimMap, claimingCells, entered, contest.id, applyBalance, refresh],
  );

  const onConfirmRelease = useCallback(async () => {
    if (!token || !pendingRelease || releasing) return;
    const { row, col } = pendingRelease;
    setReleasing(true);
    try {
      const res = await releaseSquare(token, contest.id, { row, col });
      if (res.balance != null) applyBalance(res.balance);
      setGrid((g) =>
        g
          ? {
              ...g,
              claimed: g.claimed.filter((c) => !(c.row === row && c.col === col)),
              myClaimCount: Math.max(0, g.myClaimCount - 1),
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
    } finally {
      setReleasing(false);
    }
  }, [token, pendingRelease, releasing, contest.id, applyBalance, grid?.squareCost]);

  if (loading) return <div className="card muted">Loading the grid…</div>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!grid) return null;

  const ev = grid.event;
  const home = ev?.homeTeam ?? 'Home';
  const away = ev?.awayTeam ?? 'Away';
  const revealed = grid.rowDigits != null && grid.colDigits != null;
  const open = grid.status === 'open';
  const hasScore = ev?.homeScore != null && ev?.awayScore != null;

  const whenLine =
    ev?.status === 'final' ? 'Final' : ev?.status === 'live' ? 'Live' : formatWhen(ev?.scheduledAt ?? '');

  return (
    <div className="contest-detail__body sqboard">
      {/* ---- Header: matchup, time, cost, my count, prize table ---- */}
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
            <span className="sqboard-stat__label">You own</span>
            <span className="sqboard-stat__value">{grid.myClaimCount}</span>
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

      {grid.prizeTable.length > 0 && (
        <section className="sqprize">
          <h3 className="sqprize__head">Prize table</h3>
          <ul className="sqprize__list">
            {grid.prizeTable.map((p) => (
              <PrizeRow key={String(p.period)} row={p} meId={user?.id} />
            ))}
          </ul>
          <p className="sqprize__note muted">
            Unclaimed squares{' '}
            {grid.unclaimedRule === 'rollover'
              ? 'roll into the next period.'
              : 'return to the house.'}
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
      {open && (
        <p className="sqgrid-note muted">
          Digits randomize at game start. Tap an open square to claim it
          {grid.squareCost > 0 ? ` · ${points(grid.squareCost)} pts each` : ''}. Tap your own
          to release.
        </p>
      )}
      {revealed && (
        <p className="sqgrid-note muted">
          Digits are locked in.{' '}
          {grid.status === 'final'
            ? 'Final results are in the prize table.'
            : 'Winning squares light up as each period lands.'}
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

      {/* ---- THE GRID ---- */}
      <div className="sqgrid-scroll">
        <div className="sqgrid" role="grid" aria-label={`${away} vs ${home} squares grid`}>
          {/* Corner: the two axes. Away runs across the top, Home down the side. */}
          <div className="sqgrid-corner">
            <span className="sqgrid-corner__away">{away} →</span>
            <span className="sqgrid-corner__home">{home} ↓</span>
          </div>
          {/* Top header row: the away-team digits (one per column). */}
          {Array.from({ length: 10 }, (_, col) => (
            <div key={`ch${col}`} className="sqgrid-head sqgrid-head--col">
              {revealed ? grid.colDigits![col] : '?'}
            </div>
          ))}

          {/* Ten rows, each led by its home-team digit header. */}
          {Array.from({ length: 10 }, (_, row) => (
            <Fragment key={`r${row}`}>
              <div className="sqgrid-head sqgrid-head--row">
                {revealed ? grid.rowDigits![row] : '?'}
              </div>
              {Array.from({ length: 10 }, (_, col) => {
                const k = key(row, col);
                const claim = claimMap.get(k);
                const mine = claim?.mine ?? false;
                const wonBy = winMap.has(k) ? winMap.get(k) : undefined;
                const isWon = winMap.has(k);
                const wonMine = isWon && wonBy === user?.id;
                const claiming = claimingCells.has(k);
                const tappable = open && (mine || !claim);
                const label = claim
                  ? initials(mine ? claim.displayName ?? user?.displayName ?? null : claim.displayName)
                  : '';

                const cls = [
                  'sqgrid-cell',
                  claim ? 'sqgrid-cell--taken' : 'sqgrid-cell--open',
                  mine ? 'sqgrid-cell--mine' : '',
                  isWon ? 'sqgrid-cell--won' : '',
                  wonMine ? 'sqgrid-cell--won-mine' : '',
                  claiming ? 'sqgrid-cell--claiming' : '',
                  shakeCell === k ? 'sqgrid-cell--shake' : '',
                  pendingRelease && pendingRelease.row === row && pendingRelease.col === col
                    ? 'sqgrid-cell--releasing'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                const aria = claim
                  ? mine
                    ? `Your square, row ${row} column ${col}${open ? ' — tap to release' : ''}`
                    : `Claimed by ${claim.displayName ?? 'a fan'}, row ${row} column ${col}`
                  : `Open square, row ${row} column ${col}${open ? ' — tap to claim' : ''}`;

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
