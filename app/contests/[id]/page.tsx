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
import { useAgeGate } from '../../age-gate';
import { usePoints } from '../../points-context';
import { AppNav, AccessDenied } from '../../nav';
import { FanCard } from '../../fan-card';
import { SquaresBoard } from './squares-board';
import { SurvivorBoard } from './survivor-board';
import { ParlayBoard } from './parlay-board';
import { BracketBoard } from './bracket-board';
import { canAccess } from '../../roles';
import { EntryAdvisoryNotice } from '../../entry-advisory';
import {
  entryRefusal,
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
  etDateTime,
  ContestDetail,
  PickSheet,
  PickSheetGame,
  PickValue,
  PayoutRow,
  ContestLeaderboard,
  ContestLeaderboardRow,
} from '../../api';

// Poll cadence while a contest is LIVE — the scorecard's scores and the board's
// standings both move courtside, so a gentle refresh keeps them honest without a
// socket. Open contests don't poll (nothing changes but the fan's own taps);
// final contests don't poll (settled). 30s is slow enough to be cheap.
const LIVE_POLL_MS = 30_000;

// Match the app's ET date+time treatment used on the game/picks surfaces.
// Labelled: this renders the contest's own open/close window and its games'
// kickoffs — every one of them a moment a fan has to beat.
function formatWhen(iso: string): string {
  return (
    etDateTime(iso, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      zone: true,
    }) || iso
  );
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
  const { runGated } = useAgeGate();
  const { balance, applyBalance } = usePoints();
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payouts = [...(contest.config.payouts ?? [])].sort((a, b) => a.rank - b.rank);
  const full =
    contest.maxEntries != null && contest.entrants >= contest.maxEntries;
  // The conflict-of-interest refusal. Reads exactly like `full` does — a fact
  // about this contest that closes the button — and takes the same shape below.
  const covering = entryRefusal(contest.entry, 'GET /contests/:id');
  // A soft pre-check so the button reads honestly; the backend's 409 is still
  // the authority (the chip can be stale), so we don't hard-block on it.
  const shortOnPoints =
    balance !== null && contest.entryCost > 0 && balance < contest.entryCost;

  async function onEnter() {
    if (!token || entering) return;
    setEntering(true);
    setError(null);
    try {
      // Through the 18+ gate — see age-gate.tsx. Entering is itself gated, so
      // this is where an un-attested fan meets the prompt on most contests.
      await runGated(() => enterContest(token, contest.id));
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

        {/* THE STATS AND THE PAYOUTS STAY ABOVE THIS. A correspondent covering a
            game on the slate is still entitled to see what the contest is and
            what it pays — they're just not in it. Only the button closes. */}
        {covering && <EntryAdvisoryNotice refusal={covering} />}

        <button
          type="button"
          className="contest-enter__btn"
          disabled={entering || full || covering !== null}
          onClick={onEnter}
        >
          {/* THE ONE PIECE OF LOCAL COPY IN THIS FEATURE, and it is a CONTROL
              LABEL rather than the message: the server ships a sentence, not a
              button caption, and leaving the entry price sitting on a dead
              button would read as a bug. It renders the REASON CODE
              ('covering_this_game') in the same register as its neighbour
              'Contest full', and it is not a paraphrase of the notice above —
              which stays the only place the explanation is given. */}
          {covering
            ? 'Covering this game'
            : full
            ? 'Contest full'
            : entering
            ? 'Entering…'
            : contest.entryCost > 0
            ? `Enter · ${contestCost(contest.entryCost)}`
            : 'Enter · Free'}
        </button>
        {shortOnPoints && !full && !covering && (
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
  // Sheet-wide, not per-row: the backend gates the WRITE, so a refused sheet is
  // read-only end to end rather than pickable around one game.
  covered,
  onPick,
}: {
  game: PickSheetGame;
  ou: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  covered: boolean;
  onPick: (side: PickValue) => void;
}) {
  // A covered row greys exactly like a started one, but keeps its own status
  // chip empty rather than claiming 'Started' — the game hasn't.
  const locked = gameStarted(game) || covered;
  // An over/under row with no snapshotted line can't be picked (nothing to pick
  // against); treat it like a started row so a tap can't 400.
  const noLine = ou && game.line == null;
  return (
    <li className={`picksheet-row${locked ? ' picksheet-row--locked' : ''}`}>
      <div className="picksheet-row__head">
        <span className="picksheet-row__when">{formatWhen(game.scheduledAt)}</span>
        {gameStarted(game) ? (
          <span className="picksheet-row__status">Started</span>
        ) : covered ? null : saving ? (
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
  const { runGated } = useAgeGate();
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
        // Through the 18+ gate — see age-gate.tsx. The optimistic paint stays
        // up while the prompt is open, and stands if the retry lands.
        const next = await runGated(() =>
          submitPicks(token, contest.id, { picks: [{ eventId, pick: side }] }),
        );
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
    [token, sheet, savingId, contest.id, runGated],
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
  const covering = entryRefusal(sheet.entry, 'GET /contests/:id/picks');

  return (
    <div className="contest-detail__body">
      {/* ABOVE THE PROGRESS BAR, not below the list: this changes what the whole
          sheet is (a record rather than a form), so it has to be read before the
          first row rather than found after the last one. The picks the fan
          already made stay visible and stay scored — being assigned to cover a
          game doesn't retract a sheet they filled in beforehand. */}
      {covering && <EntryAdvisoryNotice refusal={covering} />}

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
        {/* The tap-to-save promise is dropped when nothing is tappable — an
            instruction for a control that isn't there is just noise. */}
        {!covering && (
          <span className="picksheet-progress__hint muted">
            Tap a side to save it — no submit button.
          </span>
        )}
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
            covered={covering !== null}
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

// ---------------------------------------------------------------------------
// The crowd's split, revealed only once locked: a proportional bar over a
// SENTENCE THAT NAMES THE FANS.
//
// WHY IT IS A SENTENCE AND NOT A LEGEND. This rendered a bare two-column legend
// — "Away 67%" / "Home 33%" — and an unlabelled percentage beside a final score
// reads as a price whether or not it is one. The Arena spec bans "odds",
// "lines" and "props" from UI copy, and this platform's whole position is that
// it is not a sportsbook; a number that has to be EXPLAINED to be innocent is
// the wrong number to ship. So the percentage says whose it is, inline.
//
// This block is gated on `revealed`, which the backend only sets at
// locked/live/final — so it is STRUCTURALLY GUARANTEED to render next to a
// score. There is no state in which the innocent reading comes for free.
//
// ----------------------------------------------------------------------------
// DO NOT SHORTEN THE SECOND HALF TO "· 33% Portland". It reads as redundant and
// it is not: it is the entire fix.
//
// At 0.7rem this line WRAPS on a phone, and it wraps at the separator — so the
// two halves become two lines, and either can be cropped into a screenshot
// alone. That is the test this copy has to pass, because the row is what gets
// screenshotted, and a legend elsewhere on the page does not travel with it.
// "33% of fans picked Portland" survives being cropped out on its own.
// "33% Portland" beside a final score is precisely the artifact this replaced.
// The repetition is not clutter; it is the guarantee, on both lines.
// ----------------------------------------------------------------------------
//
// "PICKED", NOT "TOOK". You take a side, you take the points — "took" is
// bettor's register. `picked` is this product's own verb, already two lines
// above in the same row ("Your pick: Washington"), and it cannot be misread as
// a transaction.
//
// The distribution shape tells us which contest it is — {over,under} for an O/U
// slate, {home,away} for a pick'em — so the row doesn't thread the type down.
// The team NAMES do have to be threaded: a side needs its name to be picked.
// ---------------------------------------------------------------------------
function DistributionBars({
  distribution,
  homeTeam,
  awayTeam,
}: {
  distribution: { home: number; away: number } | { over: number; under: number };
  // RAW and nullable — deliberately NOT the row's 'TBD'-substituted locals. An
  // unnamed side reads as "the home side" below, because "33% of fans picked
  // TBD" is not a sentence. Unused on an O/U slate, which names its own sides.
  homeTeam: string | null;
  awayTeam: string | null;
}) {
  const ou = 'over' in distribution;
  // left segment / right segment: Away|Home for pick'em, Under|Over for O/U.
  // Use the `in` guard inline so TS narrows the union on each access.
  const left = 'over' in distribution ? distribution.under : distribution.away;
  const right = 'over' in distribution ? distribution.over : distribution.home;
  const total = left + right;
  if (total === 0) return null;
  const rightPct = Math.round((right / total) * 100);
  // Derived by subtraction, not rounded independently, so the two always sum to
  // 100 — "67% … 34%" in one sentence would read as a mistake in the count.
  const leftPct = 100 - rightPct;
  // An O/U slate names its own two sides; a pick'em names the teams and falls
  // back to the side word. Capitalised Over/Under matches the option labels the
  // fan tapped and the "Your pick: Over" line directly above.
  const leftName = ou ? 'Under' : awayTeam ?? 'the away side';
  const rightName = ou ? 'Over' : homeTeam ?? 'the home side';
  const line =
    `${leftPct}% of fans picked ${leftName}` +
    ` · ${rightPct}% of fans picked ${rightName}`;
  return (
    <div className="picksheet-dist">
      {/* The bar duplicates the sentence, so it is decoration: hidden rather
          than given its own aria-label, which would announce the same split
          twice. The visible copy IS the accessible copy — the same property
          that makes it survive a screenshot makes it the better label. */}
      <div className="picksheet-dist__bar" aria-hidden="true">
        <span className="picksheet-dist__seg picksheet-dist__seg--away" style={{ width: `${leftPct}%` }} />
        <span className="picksheet-dist__seg picksheet-dist__seg--home" style={{ width: `${rightPct}%` }} />
      </div>
      {/* One child, so the legend's `justify-content: space-between` is a no-op
          and the sentence wraps inside its own box. No CSS change needed. */}
      <div className="picksheet-dist__legend">
        <span>{line}</span>
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
          <DistributionBars
            distribution={game.distribution}
            homeTeam={game.homeTeam}
            awayTeam={game.awayTeam}
          />
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
        <DistributionBars
          distribution={game.distribution}
          homeTeam={game.homeTeam}
          awayTeam={game.awayTeam}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// THE SETTLED VERDICT — what the contest actually PAID. Above the scorecard,
// because it is the subject of this screen and the scorecard is the evidence.
//
// The whole settlement pipeline exists to produce this block. Without it the
// screen is a report card: "3 correct · 6 picks" and a row in a list, identical
// for the fan who won 250 points and the fan who won nothing.
//
// ---------------------------------------------------------------------------
// NO ANIMATION HERE, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
//
// `oracle-rise` (globals.css) and the Trail's chest exist one directory over and
// look like the obvious thing to reach for. They are the wrong pattern, and the
// difference is not taste:
//
//   THOSE FIRE ON A TRANSITION THE FAN JUST CAUSED. Both are gated on a
//   `justPicked` response held in page state, and both DELIBERATELY do not
//   survive a reload — today-card.tsx says it outright: "the moment has passed."
//   The animation is the app reacting to a tap.
//
//   THIS SCREEN IS LOADED COLD. A final contest is a URL. There is no moment to
//   react to, and the same flourish would replay on the fan's twentieth visit to
//   a contest they lost last week — which reads as decoration, not celebration.
//
// The celebration here is the FIGURE: gold, serif, and first. That treatment is
// already carried by the shared .call-verdict/.contest-verdict rule and needs no
// new token and no keyframe. If you are here to add motion, the only version
// that would be honest is one gated on a live→final transition observed in-page,
// and LockedView does not poll `contest` — only `board` and `sheet` — so that
// moment is not detectable today anyway.
// ---------------------------------------------------------------------------

// "Second of three." / "Ninth of 217." Words to tenth, digits above — and the
// two halves cross that threshold INDEPENDENTLY, because "Ninth of 217" is a
// sentence a fan reads and "Ninth of two hundred and seventeen" is not.
const ORDINAL_WORDS = [
  '', 'First', 'Second', 'Third', 'Fourth', 'Fifth',
  'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
];
const CARDINAL_WORDS = [
  'none', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
];

function ordinalWord(n: number): string {
  return ORDINAL_WORDS[n] || ordinal(n);
}

function cardinalWord(n: number): string {
  return CARDINAL_WORDS[n] ?? points(n);
}

// WHAT THIS CONTEST PAID THIS ENTRY — DERIVED, NOT READ. Read this before
// trusting the number, and before copying the function to another contest type.
//
// contest_entries carries `score` and `rank` and NOTHING ELSE about settlement:
// finalize pays through the LEDGER (a 'contest_payout' point_events row) and
// never writes the amount back to the entry. GET /points/ledger takes only
// limit/offset — no referenceId filter, no actionType filter — so reaching that
// row from this screen would mean paging the fan's entire statement and matching
// client-side. That is the unbounded scan this codebase has already deleted once.
//
// So the amount is re-derived from the two things the detail read ALREADY
// carries: config.payouts and myEntry.rank. It is exact rather than an estimate,
// because it is the same lookup finalize performed —
// sharp-foxx-api/src/modules/contests/contests.service.ts:378, the `else` arm:
//
//     for (const e of ranked) {
//       const points = e.rank == null ? undefined : payoutByRank.get(e.rank);
//       if (points && points > 0) amountByEntry.set(e.id, points);
//     }
//
// THE CAVEAT, and it is why this comment is longer than the function. That arm
// is the DUPLICATE tie regime, taken only when the contest type does NOT set
// `splitTies`. Pick'em and over/under don't, and that is this function's entire
// licence. The other arm (splitTies: true — survivor) divides a rank's pool
// evenly among everyone tied at it, and the tie group's SIZE is not on this read
// at all. So THE DAY PICK'EM GAINS splitTies, THIS SILENTLY OVERPAYS: it would
// print a figure nobody was credited, with nothing to make it fail loudly. There
// is no test that catches it either, because both sides would still typecheck.
//
// That is the risk docs/contest-payout-column.md exists to remove — a
// payout_points column written at finalize turns this back into a read, and
// unblocks survivor (which today shows no payout at all) in the same change.
//
// RANK COMES FROM myEntry, not from the leaderboard's `me` row. The two agree —
// both are rank() OVER (ORDER BY score DESC) over the same entries — but only
// myEntry.rank is the column finalize actually read when it paid.
function payoutForRank(payouts: PayoutRow[], rank: number | null): number {
  if (rank == null) return 0;
  return payouts.find((p) => p.rank === rank)?.points ?? 0;
}

function SettledVerdict({
  contest,
  sheet,
}: {
  contest: ContestDetail;
  sheet: PickSheet;
}) {
  const rank = contest.myEntry?.rank ?? null;
  // finalize sets rank for every entry of the contest in one UPDATE before it
  // flips the status, so a 'final' contest always has one. Guarded anyway: no
  // rank means no honest sentence, and silence beats a wrong placement.
  if (rank == null) return null;

  const payouts = contest.config.payouts ?? [];
  const paid = payoutForRank(payouts, rank);

  // Only ranks that actually pay. A row of { rank: 4, points: 0 } is legal
  // config and credits nobody, so it must not be counted as a prize this fan
  // missed — and a fan sitting ON that rank is a non-winner, not a winner of
  // zero. Both of those cases fall out of this one filter.
  const payingRanks = payouts
    .filter((p) => p.points > 0)
    .map((p) => p.rank)
    .sort((a, b) => a - b);
  // Contiguous from 1 is the shape every contest ships today ("top three"); a
  // gapped table cannot be described that way, so it doesn't try to.
  const contiguous =
    payingRanks.length > 0 && payingRanks.every((r, i) => r === i + 1);

  // Denominator is the SLATE, not picksMade — it matches the rows immediately
  // below, which render every game including the ones that say "No pick". A fan
  // reading "3 of 4 correct" over six rows would be reading a contradiction.
  const total = sheet.games.length;

  return (
    <div className="contest-verdict">
      {/* Never "+0" — see the .call-verdict note in globals.css. A zero figure
          turns a neutral screen into a scolding one, and the non-winner branch
          below already says plainly where the points went. */}
      {paid > 0 && (
        <span className="contest-verdict__points">+{points(paid)}</span>
      )}
      <p className="contest-verdict__headline">
        {ordinalWord(rank)} of {cardinalWord(contest.entrants)}.
      </p>
      <p className="contest-verdict__counts">
        {points(sheet.summary.correct)} of {points(total)} correct
      </p>
      {paid > 0 ? (
        <p className="contest-verdict__sub">
          {points(paid)} pts are in your balance.
        </p>
      ) : payingRanks.length === 0 ? (
        // NO PRIZES ON THE BOARD. config.payouts is optional (it defaults to []
        // in assertPayoutsValid), so a contest can legitimately pay nobody —
        // and every sentence about "the winners" would be a lie on this one.
        <p className="contest-verdict__sub">
          This one was played for the standings — no points on the board.
        </p>
      ) : (
        // THE COMMON CASE, and the one the copy is built around. Flat and
        // factual: where they landed, where the points went, where to go next.
        // No consolation, no "so close" — a fan who came 90th is not close.
        <p className="contest-verdict__sub">
          {contiguous
            ? payingRanks.length === 1
              ? 'First place took the points.'
              : `Top ${cardinalWord(payingRanks.length)} took the points.`
            : 'The paid ranks took the points.'}{' '}
          Next slate&apos;s in the <Link href="/contests">lobby</Link>.
        </p>
      )}
    </div>
  );
}

function Scorecard({ sheet, ou }: { sheet: PickSheet; ou: boolean }) {
  return (
    <section className="contest-scorecard">
      <div className="contest-scorecard__head">
        <h2 className="game-articles__head">Your scorecard</h2>
        <span className="contest-scorecard__tally">
          {sheet.summary.correct} correct · {sheet.summary.picksMade} picks
          {/* NOT "pts". pointsPerCorrect is the SCOREBOARD's unit — pickem.type.ts
              says so in as many words ("the per-correct-pick payout in points on
              the scoreboard, NOT the ledger") — and scoreEntry turns it into the
              ranking score, which nothing ever credits. Calling it "2 pts each"
              invited a fan with 3 correct to conclude they had earned 6 points,
              and now that the verdict block above states a REAL credited figure,
              the two would be two point numbers meaning different things on one
              screen. Only one number on this page is points; it is upstairs. */}
          {sheet.pointsPerCorrect !== 1 && (
            <span className="muted">
              {' '}
              · {sheet.pointsPerCorrect} toward your score each
            </span>
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
          // Contest standings aren't the winnings board, so the card keeps the
          // platform-wide earned pair it has always shown here.
          board="earned"
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
        <>
          {/* ONLY AT 'final'. A locked or live contest has no settlement yet —
              ranks move every time a game posts, and myEntry.rank is null until
              finalize writes it — so there is nothing true to say about what the
              fan won. The leaderboard below already carries the running story. */}
          {contest.status === 'final' && (
            <SettledVerdict contest={contest} sheet={sheet} />
          )}
          <Scorecard sheet={sheet} ou={contest.type === 'overunder'} />
        </>
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
  // A parlay board, like squares, is FREE to enter — the TICKET is the buy — so
  // it owns its whole body across every status and enters the fan transparently
  // on their first PLACE, rather than routing through the enter hero.
  const isParlay = contest?.type === 'parlay_board';
  // Pick'em and over/under share the exact enter → sheet → scorecard chassis
  // (only the sides differ), so both are "playable" through the same arms below.
  const playable = contest?.type === 'pickem' || contest?.type === 'overunder';
  // Survivor rides the same chassis SHELL (canceled/draft gating + the enter hero
  // when not entered), but its entered body is its own round timeline, not the
  // pick sheet — so it branches to SurvivorBoard below rather than PickSheetView.
  const isSurvivor = contest?.type === 'survivor';
  // A bracket rides the same chassis SHELL as survivor — canceled/draft gating and
  // the enter hero when not entered — then hands its entered body to BracketBoard,
  // which is a TREE (draft the whole thing, commit once), not a pick sheet.
  const isBracket = contest?.type === 'bracket';
  const chassis = playable || isSurvivor || isBracket;
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
              the parlay board likewise carries its own ticket builder + book;
              survivor carries its own round timeline; bracket carries its own
              tree; pick'em and over/under split into enter → sheet → scorecard.
              Survivor and bracket share the chassis SHELL (canceled/draft gating +
              the enter hero when not entered), then hand their entered/locked body
              to SurvivorBoard / BracketBoard. Any other type has no fan
              gameplay in v1 — show the row it is rather than a sheet that 400s. */}
          {isSquares ? (
            <SquaresBoard contest={contest} />
          ) : isParlay ? (
            <ParlayBoard contest={contest} />
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
          ) : isBracket ? (
            // Bracket's entered body across open/locked/live/final: the tree.
            <BracketBoard contest={contest} onWithdrew={load} />
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
