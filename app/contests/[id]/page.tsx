'use client';

// /contests/[id] — one contest, in three faces:
//
//   a. NOT ENTERED + open  → the hero: title, cost, the payout table, entrant
//      count, and a big ENTER button. Entering spends points through the ledger
//      (the ⚡ chip updates); a 409 "Insufficient points" surfaces inline.
//   b. ENTERED + open      → THE PICK SHEET. Each slate game is a row with two
//      big tappable sides; a tap saves that one pick (optimistic PUT upsert, no
//      submit button). Games already started render locked. A withdraw
//      affordance refunds the entry.
//   c. LOCKED / LIVE / FINAL → the sheet becomes a SCORECARD (my picks, live
//      scores, ✓/✗, the crowd distribution) and the LEADERBOARD sits below,
//      reusing the fan-card slide-over from the points board.
//
// POINTS ONLY: entry and payouts are points, never money. Mobile-first — the
// pick sheet is a phone activity, so the two side buttons are thumb-sized.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { usePoints } from '../../points-context';
import { AppNav, AccessDenied } from '../../nav';
import { FanCard } from '../../fan-card';
import { SquaresBoard } from './squares-board';
import { SurvivorBoard } from './survivor-board';
import { canAccess } from '../../roles';
import {
  getContest,
  getMyPicks,
  getPickSheet,
  submitPicks,
  enterContest,
  withdrawContest,
  getContestLeaderboard,
  contestTypeLabel,
  contestCost,
  points,
  ContestDetail,
  PickSheet,
  PickSheetGame,
  PickValue,
  ContestLeaderboard,
  ContestLeaderboardRow,
} from '../../api';

// Poll cadence while a contest is LIVE — the scorecard's scores and the board's
// standings both move courtside, so a gentle refresh keeps them honest without a
// socket. Open contests don't poll (nothing changes but the fan's own taps);
// final contests don't poll (settled). 30s is slow enough to be cheap.
const LIVE_POLL_MS = 30_000;

// Match the app's date+time treatment used on the game/picks surfaces.
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

// The over/under line reads off the sheet game as a `numeric` STRING ("16.50").
// Normalize through Number so a stored "16.50" shows as "16.5"; leave a genuinely
// non-numeric value alone, and dash a missing line (a slate row without one).
function formatLine(line: string | null | undefined): string {
  if (line == null) return '—';
  const n = Number(line);
  return Number.isFinite(n) ? String(n) : line;
}

// 1 -> "1st", 2 -> "2nd" … for the payout table.
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// A slate game is closed to picking once it has started: the backend rejects a
// pick on a game whose scheduledAt <= now (DB clock) OR whose status has moved
// off 'scheduled'. Mirror both here so a started row renders locked rather than
// offering a tap that would 409.
function gameStarted(game: PickSheetGame): boolean {
  if (game.status !== 'scheduled') return true;
  const at = new Date(game.scheduledAt).getTime();
  return !Number.isNaN(at) && at <= Date.now();
}

// ---------------------------------------------------------------------------
// STATE a: the enter hero (not entered, open)
// ---------------------------------------------------------------------------

function EnterHero({
  contest,
  onEntered,
}: {
  contest: ContestDetail;
  onEntered: () => void;
}) {
  const { token } = useAuth();
  const { balance, applyBalance } = usePoints();
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payouts = [...(contest.config.payouts ?? [])].sort((a, b) => a.rank - b.rank);
  const full =
    contest.maxEntries != null && contest.entrants >= contest.maxEntries;
  // A soft pre-check so the button reads honestly; the backend's 409 is still
  // the authority (the chip can be stale), so we don't hard-block on it.
  const shortOnPoints =
    balance !== null && contest.entryCost > 0 && balance < contest.entryCost;

  async function onEnter() {
    if (!token || entering) return;
    setEntering(true);
    setError(null);
    try {
      await enterContest(token, contest.id);
      // Enter returns the entry row, not a balance — refresh the shared wallet
      // from its canonical read so the ⚡ chip reflects the spend. Best-effort:
      // the entry already succeeded, so a failed refresh just leaves a stale
      // chip until the next load.
      getMyPicks(token)
        .then((r) => applyBalance(r.balance))
        .catch(() => {});
      onEntered();
    } catch (err) {
      // 409 "Insufficient points" / "Contest is full" / "already entered" all
      // surface verbatim here.
      setError(err instanceof Error ? err.message : 'Failed to enter');
      setEntering(false);
    }
  }

  return (
    <div className="contest-detail__body">
      <section className="contest-enter card">
        <div className="contest-enter__stats">
          <div className="contest-stat">
            <span className="contest-stat__label">Entry</span>
            <span className="contest-stat__value">
              {contestCost(contest.entryCost)}
            </span>
          </div>
          <div className="contest-stat">
            <span className="contest-stat__label">Entrants</span>
            <span className="contest-stat__value">{contest.entrants}</span>
          </div>
          {contest.maxEntries != null && (
            <div className="contest-stat">
              <span className="contest-stat__label">Field cap</span>
              <span className="contest-stat__value">{contest.maxEntries}</span>
            </div>
          )}
        </div>

        {payouts.length > 0 && (
          <div className="contest-payouts">
            <h3 className="contest-payouts__head">Payouts</h3>
            <ul className="contest-payouts__list">
              {payouts.map((p) => (
                <li key={p.rank} className="contest-payouts__row">
                  <span className="contest-payouts__rank">{ordinal(p.rank)}</span>
                  <span className="contest-payouts__pts">{points(p.points)} pts</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <button
          type="button"
          className="contest-enter__btn"
          disabled={entering || full}
          onClick={onEnter}
        >
          {full
            ? 'Contest full'
            : entering
            ? 'Entering…'
            : contest.entryCost > 0
            ? `Enter · ${contestCost(contest.entryCost)}`
            : 'Enter · Free'}
        </button>
        {shortOnPoints && !full && (
          <p className="contest-enter__hint muted">
            You&apos;re holding {points(balance ?? 0)} pts — this contest costs{' '}
            {points(contest.entryCost)}.
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STATE b: the pick sheet (entered, open)
// ---------------------------------------------------------------------------

// One tappable side. `sub` is the big text (the tap target's headline): the team
// name for a pick'em, the direction for an over/under. `label` is the small cap
// above it — a pick'em shows "Home"/"Away"; an over/under omits it (the direction
// IS the headline, and the line lives in the row's O/U badge). aria-pressed rides
// the selection either way.
function SideButton({
  label,
  sub,
  picked,
  disabled,
  onPick,
}: {
  label?: string | null;
  sub: string | null;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`picksheet-side${picked ? ' picksheet-side--on' : ''}`}
      aria-pressed={picked}
      disabled={disabled}
      onClick={onPick}
    >
      {label != null && <span className="picksheet-side__label">{label}</span>}
      <span className="picksheet-side__team">{sub ?? 'TBD'}</span>
    </button>
  );
}

function PickRow({
  game,
  ou,
  saving,
  saved,
  error,
  onPick,
}: {
  game: PickSheetGame;
  ou: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onPick: (side: PickValue) => void;
}) {
  const locked = gameStarted(game);
  // An over/under row with no snapshotted line can't be picked (nothing to pick
  // against); treat it like a started row so a tap can't 400.
  const noLine = ou && game.line == null;
  return (
    <li className={`picksheet-row${locked ? ' picksheet-row--locked' : ''}`}>
      <div className="picksheet-row__head">
        <span className="picksheet-row__when">{formatWhen(game.scheduledAt)}</span>
        {locked ? (
          <span className="picksheet-row__status">Started</span>
        ) : saving ? (
          <span className="picksheet-row__status">Saving…</span>
        ) : saved ? (
          <span className="picksheet-row__status picksheet-row__status--saved">
            Saved ✓
          </span>
        ) : null}
      </div>
      {ou ? (
        <>
          <div className="ouline-matchup">
            <span className="ouline-teams">
              {game.awayTeam ?? 'TBD'} @ {game.homeTeam ?? 'TBD'}
            </span>
            <span className="ouline-badge">O/U {formatLine(game.line)}</span>
          </div>
          <div className="picksheet-row__sides">
            <SideButton
              sub="Over"
              picked={game.pick === 'over'}
              disabled={locked || saving || noLine}
              onPick={() => onPick('over')}
            />
            <SideButton
              sub="Under"
              picked={game.pick === 'under'}
              disabled={locked || saving || noLine}
              onPick={() => onPick('under')}
            />
          </div>
        </>
      ) : (
        <div className="picksheet-row__sides">
          <SideButton
            label="Away"
            sub={game.awayTeam}
            picked={game.pick === 'away'}
            disabled={locked || saving}
            onPick={() => onPick('away')}
          />
          <span className="picksheet-row__at">@</span>
          <SideButton
            label="Home"
            sub={game.homeTeam}
            picked={game.pick === 'home'}
            disabled={locked || saving}
            onPick={() => onPick('home')}
          />
        </div>
      )}
      {error && <div className="picksheet-row__error">{error}</div>}
    </li>
  );
}

function PickSheetView({
  contest,
  onWithdrew,
}: {
  contest: ContestDetail;
  onWithdrew: () => void;
}) {
  const { token } = useAuth();
  const { applyBalance } = usePoints();
  const ou = contest.type === 'overunder';
  const [sheet, setSheet] = useState<PickSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A polite live region so a save is announced to a screen reader without
  // stealing focus (the visual "Saved ✓" is per-row and easy to miss aurally).
  // The trailing count forces a re-announce when the same side saves twice.
  const [saveCount, setSaveCount] = useState(0);

  // Per-row transient UI: which event is mid-save, which just saved (a 1.5s
  // "Saved ✓"), and which failed. Keyed by eventId so rows are independent.
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ eventId: string; message: string } | null>(
    null,
  );
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Withdraw is a two-step inline confirm (no window.confirm) — it refunds the
  // entry and drops the fan back to the enter hero.
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getPickSheet(token, contest.id)
      .then((s) => {
        if (!cancelled) setSheet(s);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load sheet');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, contest.id]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const onPick = useCallback(
    async (eventId: string, side: PickValue) => {
      if (!token || !sheet || savingId) return;
      const prev = sheet.games.find((g) => g.eventId === eventId)?.pick ?? null;
      if (prev === side) return; // re-tapping the same side is a no-op

      // Optimistic: paint the side immediately so the tap feels instant.
      setSheet((s) =>
        s
          ? {
              ...s,
              games: s.games.map((g) =>
                g.eventId === eventId ? { ...g, pick: side } : g,
              ),
            }
          : s,
      );
      setSavingId(eventId);
      setRowError(null);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      setSavedId(null);

      try {
        // The PUT returns the rebuilt sheet — reconcile from it rather than
        // trusting the optimistic paint (keeps summary/pointsPerCorrect honest).
        const next = await submitPicks(token, contest.id, {
          picks: [{ eventId, pick: side }],
        });
        setSheet(next);
        setSavingId(null);
        setSavedId(eventId);
        setSaveCount((n) => n + 1);
        savedTimer.current = setTimeout(() => setSavedId(null), 1500);
      } catch (err) {
        // Revert the optimistic paint and say what went wrong on that row (a
        // started-game 409, or the contest locking under the fan).
        setSheet((s) =>
          s
            ? {
                ...s,
                games: s.games.map((g) =>
                  g.eventId === eventId ? { ...g, pick: prev } : g,
                ),
              }
            : s,
        );
        setSavingId(null);
        setRowError({
          eventId,
          message: err instanceof Error ? err.message : 'Could not save',
        });
      }
    },
    [token, sheet, savingId, contest.id],
  );

  async function onWithdraw() {
    if (!token || withdrawing) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await withdrawContest(token, contest.id);
      getMyPicks(token)
        .then((r) => applyBalance(r.balance))
        .catch(() => {});
      onWithdrew();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Failed to withdraw');
      setWithdrawing(false);
    }
  }

  if (loading) return <div className="card muted">Loading your pick sheet…</div>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!sheet) return null;

  const picked = sheet.games.filter((g) => g.pick).length;
  const totalGames = sheet.games.length;

  return (
    <div className="contest-detail__body">
      <div className="picksheet-progress">
        <span className="picksheet-progress__count">
          {picked} of {totalGames} picked
        </span>
        <div
          className="picksheet-progress__bar"
          role="progressbar"
          aria-valuenow={picked}
          aria-valuemin={0}
          aria-valuemax={totalGames}
        >
          <span
            className="picksheet-progress__fill"
            style={{ width: `${totalGames ? (picked / totalGames) * 100 : 0}%` }}
          />
        </div>
        <span className="picksheet-progress__hint muted">
          Tap a side to save it — no submit button.
        </span>
      </div>

      <ul className="picksheet-list">
        {sheet.games.map((g) => (
          <PickRow
            key={g.eventId}
            game={g}
            ou={ou}
            saving={savingId === g.eventId}
            saved={savedId === g.eventId}
            error={rowError?.eventId === g.eventId ? rowError.message : null}
            onPick={(side) => void onPick(g.eventId, side)}
          />
        ))}
      </ul>

      <div className="sr-only" role="status" aria-live="polite">
        {saveCount > 0 ? `Pick saved (${saveCount})` : ''}
      </div>

      <section className="contest-withdraw">
        {withdrawError && <div className="error">{withdrawError}</div>}
        {confirming ? (
          <div className="contest-withdraw__confirm">
            <span className="muted">
              Withdraw and refund your {contestCost(contest.entryCost)} entry?
            </span>
            <div className="contest-withdraw__actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={withdrawing}
                onClick={() => setConfirming(false)}
              >
                Keep my entry
              </button>
              <button
                type="button"
                className="contest-withdraw__go"
                disabled={withdrawing}
                onClick={onWithdraw}
              >
                {withdrawing ? 'Withdrawing…' : 'Withdraw & refund'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="link-btn contest-withdraw__open"
            onClick={() => setConfirming(true)}
          >
            Withdraw from contest
          </button>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STATE c: the scorecard + leaderboard (locked / live / final)
// ---------------------------------------------------------------------------

// The crowd's split, revealed only once locked. Two proportional bars. The
// distribution shape tells us which contest it is — {over,under} for an O/U slate,
// {home,away} for a pick'em — so the row doesn't have to thread the type down.
function DistributionBars({
  distribution,
}: {
  distribution: { home: number; away: number } | { over: number; under: number };
}) {
  const ou = 'over' in distribution;
  // left segment / right segment: Away|Home for pick'em, Under|Over for O/U.
  // Use the `in` guard inline so TS narrows the union on each access.
  const left = 'over' in distribution ? distribution.under : distribution.away;
  const right = 'over' in distribution ? distribution.over : distribution.home;
  const total = left + right;
  if (total === 0) return null;
  const rightPct = Math.round((right / total) * 100);
  const leftPct = 100 - rightPct;
  return (
    <div className="picksheet-dist" aria-label="Crowd pick distribution">
      <div className="picksheet-dist__bar">
        <span className="picksheet-dist__seg picksheet-dist__seg--away" style={{ width: `${leftPct}%` }} />
        <span className="picksheet-dist__seg picksheet-dist__seg--home" style={{ width: `${rightPct}%` }} />
      </div>
      <div className="picksheet-dist__legend">
        <span>{ou ? 'Under' : 'Away'} {leftPct}%</span>
        <span>{ou ? 'Over' : 'Home'} {rightPct}%</span>
      </div>
    </div>
  );
}

function ScoreRow({
  game,
  ou,
  revealed,
}: {
  game: PickSheetGame;
  ou: boolean;
  revealed: boolean;
}) {
  const hasScore = game.homeScore !== null && game.awayScore !== null;
  const away = game.awayTeam ?? 'TBD';
  const home = game.homeTeam ?? 'TBD';
  // The result mark rides on the fan's pick once graded.
  const mark =
    game.isCorrect === true ? 'correct' : game.isCorrect === false ? 'wrong' : null;

  if (ou) {
    // O/U scorecard: the meaningful number is the combined TOTAL vs the line, so
    // show "Total: 13" (client-computed) once scores post, else the line itself.
    const total = hasScore ? game.homeScore! + game.awayScore! : null;
    return (
      <li className={`scorecard-row${mark ? ` scorecard-row--${mark}` : ''}`}>
        <div className="scorecard-row__matchup">
          <span className="scorecard-team">
            {away} @ {home}
          </span>
          <span className="scorecard-row__score">
            {total !== null ? `Total: ${total}` : `O/U ${formatLine(game.line)}`}
          </span>
        </div>
        <div className="scorecard-row__foot">
          <span className="scorecard-row__when">
            {game.status === 'final' ? 'Final' : formatWhen(game.scheduledAt)}
            {game.line != null && ` · O/U ${formatLine(game.line)}`}
          </span>
          {game.pick ? (
            <span className="scorecard-row__mine">
              Your pick:{' '}
              <strong>{game.pick === 'over' ? 'Over' : 'Under'}</strong>
              {mark === 'correct' && <span className="scorecard-mark scorecard-mark--ok">✓</span>}
              {mark === 'wrong' && <span className="scorecard-mark scorecard-mark--no">✗</span>}
            </span>
          ) : (
            <span className="scorecard-row__mine muted">No pick</span>
          )}
        </div>
        {revealed && game.distribution && (
          <DistributionBars distribution={game.distribution} />
        )}
      </li>
    );
  }

  return (
    <li className={`scorecard-row${mark ? ` scorecard-row--${mark}` : ''}`}>
      <div className="scorecard-row__matchup">
        <span
          className={`scorecard-team${game.pick === 'away' ? ' scorecard-team--mine' : ''}`}
        >
          {away}
        </span>
        <span className="scorecard-row__score">
          {hasScore ? `${game.awayScore} – ${game.homeScore}` : 'vs'}
        </span>
        <span
          className={`scorecard-team${game.pick === 'home' ? ' scorecard-team--mine' : ''}`}
        >
          {home}
        </span>
      </div>
      <div className="scorecard-row__foot">
        <span className="scorecard-row__when">
          {game.status === 'final' ? 'Final' : formatWhen(game.scheduledAt)}
        </span>
        {game.pick ? (
          <span className="scorecard-row__mine">
            Your pick: <strong>{game.pick === 'home' ? home : away}</strong>
            {mark === 'correct' && <span className="scorecard-mark scorecard-mark--ok">✓</span>}
            {mark === 'wrong' && <span className="scorecard-mark scorecard-mark--no">✗</span>}
          </span>
        ) : (
          <span className="scorecard-row__mine muted">No pick</span>
        )}
      </div>
      {revealed && game.distribution && (
        <DistributionBars distribution={game.distribution} />
      )}
    </li>
  );
}

function Scorecard({ sheet, ou }: { sheet: PickSheet; ou: boolean }) {
  return (
    <section className="contest-scorecard">
      <div className="contest-scorecard__head">
        <h2 className="game-articles__head">Your scorecard</h2>
        <span className="contest-scorecard__tally">
          {sheet.summary.correct} correct · {sheet.summary.picksMade} picks
          {sheet.pointsPerCorrect !== 1 && (
            <span className="muted"> · {sheet.pointsPerCorrect} pts each</span>
          )}
        </span>
      </div>
      <ul className="scorecard-list">
        {sheet.games.map((g) => (
          <ScoreRow key={g.eventId} game={g} ou={ou} revealed={sheet.revealed} />
        ))}
      </ul>
    </section>
  );
}

// The medal/number treatment shared with the points board.
function rankBadge(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}`;
}

function LeaderboardRow({
  row,
  me,
  pinned,
  onOpen,
}: {
  row: ContestLeaderboardRow;
  me: boolean;
  pinned?: boolean;
  onOpen: () => void;
}) {
  return (
    <li
      className={`points-lb__row${me ? ' points-lb__row--me' : ''}${
        pinned ? ' points-lb__row--pinned' : ''
      }`}
    >
      <span className="points-lb__rank">{rankBadge(row.rank)}</span>
      <span className="points-lb__name">
        <button type="button" className="fancard-open" aria-haspopup="dialog" onClick={onOpen}>
          {row.display_name ?? 'You'}
        </button>
        {me && <span className="points-lb__you">You</span>}
      </span>
      <span className="points-lb__score">
        {points(Math.round(Number(row.score)))}
        <span className="points-lb__unit">pts</span>
      </span>
    </li>
  );
}

function ContestLeaderboardView({
  board,
  meId,
}: {
  board: ContestLeaderboard;
  meId: string | undefined;
}) {
  const [openFan, setOpenFan] = useState<ContestLeaderboardRow | null>(null);

  const inTop = board.me
    ? board.items.some((r) => r.user_id === board.me!.user_id)
    : true;
  const showPinned = board.me !== null && !inTop;

  return (
    <section className="contest-board">
      <h2 className="game-articles__head">Leaderboard</h2>
      {board.items.length > 0 ? (
        <>
          <ul className="points-lb__list">
            {board.items.map((r) => (
              <LeaderboardRow
                key={r.user_id}
                row={r}
                me={r.user_id === meId}
                onOpen={() => setOpenFan(r)}
              />
            ))}
          </ul>
          {showPinned && board.me && (
            <div className="points-lb__pin">
              <span className="points-lb__pin-label">Your rank</span>
              <ul className="points-lb__list">
                <LeaderboardRow
                  row={board.me}
                  me
                  pinned
                  onOpen={() => setOpenFan(board.me!)}
                />
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="results-empty">
          <p className="results-empty__title">No standings yet</p>
          <p className="results-empty__hint">
            Scores post as the games finalize.
          </p>
        </div>
      )}

      {openFan && (
        <FanCard
          key={openFan.user_id}
          userId={openFan.user_id}
          fallbackName={openFan.display_name}
          isMe={openFan.user_id === meId}
          onClose={() => setOpenFan(null)}
        />
      )}
    </section>
  );
}

// The scorecard + leaderboard section, with a live poll while the contest runs.
function LockedView({ contest }: { contest: ContestDetail }) {
  const { token, user } = useAuth();
  const [sheet, setSheet] = useState<PickSheet | null>(null);
  const [board, setBoard] = useState<ContestLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const entered = contest.myEntry !== null;
  const live = contest.status === 'live';

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // The scorecard is a participant surface (getPickSheet 403s for non-
      // entrants), so only entered fans fetch it; everyone gets the board.
      const [nextBoard, nextSheet] = await Promise.all([
        getContestLeaderboard(token, contest.id),
        entered
          ? getPickSheet(token, contest.id).catch(() => null)
          : Promise.resolve(null),
      ]);
      setBoard(nextBoard);
      if (nextSheet) setSheet(nextSheet);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contest');
    } finally {
      setLoading(false);
    }
  }, [token, contest.id, entered]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    if (!live) return;
    const timer = setInterval(() => void load(), LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, live]);

  if (loading) return <div className="card muted">Loading contest…</div>;

  return (
    <div className="contest-detail__body">
      {error && <div className="error">{error}</div>}
      {entered && sheet ? (
        <Scorecard sheet={sheet} ou={contest.type === 'overunder'} />
      ) : !entered ? (
        <div className="results-empty">
          <p className="results-empty__title">You didn&apos;t enter this one</p>
          <p className="results-empty__hint">
            Picks are closed, but you can still follow the leaderboard below.
          </p>
        </div>
      ) : null}
      {board && <ContestLeaderboardView board={board} meId={user?.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page: load the contest, then choose its face.
// ---------------------------------------------------------------------------

export default function ContestPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], '/contests');

  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setContest(await getContest(token, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contest');
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    void load();
  }, [token, router, allowed, load]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const status = contest?.status;
  const entered = contest?.myEntry != null;
  const open = status === 'open';
  const isSquares = contest?.type === 'squares';
  // Pick'em and over/under share the exact enter → sheet → scorecard chassis
  // (only the sides differ), so both are "playable" through the same arms below.
  const playable = contest?.type === 'pickem' || contest?.type === 'overunder';
  // Survivor rides the same chassis SHELL (canceled/draft gating + the enter hero
  // when not entered), but its entered body is its own round timeline, not the
  // pick sheet — so it branches to SurvivorBoard below rather than PickSheetView.
  const isSurvivor = contest?.type === 'survivor';
  const chassis = playable || isSurvivor;
  const face = contest ? statusFaceKicker(contest) : '';

  return (
    <main className="feed-home contest-detail">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <div className="contest-detail__back">
        <Link href="/contests" className="link-btn">
          ← All contests
        </Link>
      </div>

      {loading && <div className="card muted">Loading contest…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && contest && (
        <>
          <header className="masthead contest-detail__head">
            <span className="masthead-kicker">
              {contestTypeLabel(contest.type)} · {face}
            </span>
            <h1 className="masthead-title">{contest.title}</h1>
            {contest.description && (
              <p className="masthead-standfirst">{contest.description}</p>
            )}
            {entered && open && (
              <span className="contest-entered">Entered ✓</span>
            )}
          </header>

          {/* Squares carries its own body (the 10x10 grid across every status);
              survivor carries its own round timeline; pick'em and over/under split
              into enter → sheet → scorecard. Survivor shares the chassis SHELL
              (canceled/draft gating + the enter hero when not entered), then hands
              its entered/locked body to SurvivorBoard. Any other type has no fan
              gameplay in v1 — show the row it is rather than a sheet that 400s. */}
          {isSquares ? (
            <SquaresBoard contest={contest} />
          ) : !chassis ? (
            <div className="results-empty">
              <p className="results-empty__title">Not playable yet</p>
              <p className="results-empty__hint">
                This contest type isn&apos;t open for play in the app yet.
              </p>
            </div>
          ) : status === 'canceled' ? (
            <div className="results-empty">
              <p className="results-empty__title">This contest was canceled</p>
              <p className="results-empty__hint">
                Nothing more to play here. Browse the{' '}
                <Link href="/contests">contest lobby</Link> for what&apos;s open.
              </p>
            </div>
          ) : status === 'draft' ? (
            <div className="results-empty">
              <p className="results-empty__title">Not open yet</p>
              <p className="results-empty__hint">
                This contest hasn&apos;t opened for entries.
              </p>
            </div>
          ) : open && !entered ? (
            <EnterHero contest={contest} onEntered={load} />
          ) : isSurvivor ? (
            // Survivor's entered body across open/locked/live/final: the timeline.
            <SurvivorBoard contest={contest} onWithdrew={load} />
          ) : open && entered ? (
            <PickSheetView contest={contest} onWithdrew={load} />
          ) : (
            // locked / live / final
            <LockedView contest={contest} />
          )}
        </>
      )}
    </main>
  );
}

// The kicker's status word next to the type ("Pick'em · Open now").
function statusFaceKicker(contest: ContestDetail): string {
  switch (contest.status) {
    case 'open':
      return 'Open now';
    case 'locked':
      return 'Locked';
    case 'live':
      return 'Live';
    case 'final':
      return 'Final';
    case 'canceled':
      return 'Canceled';
    case 'draft':
      return 'Draft';
  }
}
