'use client';

// The BRACKET surface for /contests/[id] when type==='bracket'. A bracket IS a
// contest (the chassis owns enter/withdraw/finalize, shared with pick'em and
// survivor), but its body is the TREE — a fan picks every slot, from round one to
// the champion, BEFORE the first game starts, and scores each slot they got right
// weighted by round. This component owns the tree read, the draft-and-commit
// gameplay, the three pick states, and the standings crowd view.
//
// TWO THINGS MAKE THIS DIFFERENT FROM THE OTHER BOARDS.
//
// 1. THE SUBMIT IS THE WHOLE TREE, NOT A TAP.
//    Survivor and pick'em PUT on every tap. A bracket cannot: the backend rejects
//    a partial tree, because its consistency rule (your finalist must be someone
//    you picked to win a semifinal) can only be checked against a complete one. So
//    picking here is a LOCAL DRAFT — tap through the rounds, then commit once. The
//    same consistency rule is enforced here by construction (reconcileDraft), so
//    an inconsistent tree is not something the fan can build and have rejected;
//    changing an upstream pick CLEARS the downstream picks it invalidates, which
//    is the honest thing to do and also exactly what the backend would demand.
//
// 2. THE DRAFT TREE IS NOT THE SHEET'S TREE.
//    The sheet's per-slot `participants` are the RESOLVED ones — real teams put
//    there by real results — and they stay [null, null] for rounds 2+ until games
//    decide them. That is the right shape for scoring and the wrong one for
//    drafting, where slot 5's two candidates are whoever the FAN sent there. So
//    the draft walks config.slots[].from (the topology, which only config carries)
//    against the fan's own picks. See buildCandidates.
//
// THE THREE PICK STATES ARE THE WHOLE DESIGN, and the reason this screen exists
// rather than a scoreboard: correct (with the points), wrong (your team played and
// lost), and unreachable (your team never got here). UNREACHABLE IS MUTED, NEVER
// RED — it is not a loss, it is a consequence of one — and it renders the
// backend's unreachableReason sentence verbatim. A fan looking at four zeros with
// no explanation concludes the app is broken; that sentence is the difference
// between a busted bracket and a busted app.
//
// POINTS ONLY: entry costs points like any contest (the chassis EnterHero handles
// that when not entered); nothing here is money. Mobile-first — the tree stacks as
// rounds at 390px rather than laying out as columns, which no phone can hold.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth-context';
import { useAgeGate } from '../../age-gate';
import { usePoints } from '../../points-context';
import { FanCard } from '../../fan-card';
// The tree algebra — the draft's candidate resolution and the consistency rule.
// See bracket-tree.ts.
import { buildCandidates, reconcileDraft, roundLabel } from './bracket-tree';
import {
  getBracketSheet,
  submitBracket,
  getMyPicks,
  withdrawContest,
  contestCost,
  points,
  etDateTime,
  ContestDetail,
  BracketSheet,
  BracketSlotView,
  BracketTeamRef,
  BracketStandingsRow,
  BracketConfigSlot,
} from '../../api';

// Poll cadence while the contest is LIVE — games resolve, the tree advances, and
// picks flip to correct/wrong/unreachable underneath the fan. 30s, the same gentle
// cadence the survivor timeline, the pick'em scorecard and the squares grid use.
const LIVE_POLL_MS = 30_000;

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

// Round names counted BACK from the final, which is how anyone actually refers to
// them ("the semis"), and which needs no knowledge of the field size beyond the
// tree's own depth. Past the quarters the halving names itself.
// "3 seed Baltimore" — the seed is how a bracket names a team, so it leads.
function teamLabel(team: BracketTeamRef | null): string {
  if (!team) return 'TBD';
  return team.teamName ?? 'Unknown team';
}

// ---------------------------------------------------------------------------
// One team button in the draft — the same thumb-sized affordance survivor uses.
// A TBD candidate (its feeder isn't picked yet) is inert and says so rather than
// disappearing, so the slot keeps its shape as the fan works down the tree.
// ---------------------------------------------------------------------------

function CandidateButton({
  team,
  picked,
  disabled,
  onPick,
}: {
  team: BracketTeamRef | null;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`bracket-team${picked ? ' bracket-team--on' : ''}${
        team ? '' : ' bracket-team--tbd'
      }`}
      aria-pressed={picked}
      disabled={disabled || !team}
      onClick={onPick}
    >
      {team?.seed != null && <span className="bracket-team__seed">{team.seed}</span>}
      <span className="bracket-team__name">{teamLabel(team)}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// A slot while the contest is OPEN: pick the winner of this game.
// ---------------------------------------------------------------------------

function DraftSlot({
  slot,
  candidates,
  picked,
  disabled,
  onPick,
}: {
  slot: BracketSlotView;
  candidates: [BracketTeamRef | null, BracketTeamRef | null];
  picked: string | null;
  disabled: boolean;
  onPick: (teamId: string) => void;
}) {
  return (
    <li className="bracket-slot">
      <div className="bracket-slot__head">
        <span className="bracket-slot__when">
          {slot.scheduledAt ? formatWhen(slot.scheduledAt) : 'Date TBD'}
        </span>
        <span className="bracket-slot__worth">{points(slot.points)} pts</span>
      </div>
      {/* A SERIES says so. winsNeeded > 1 means this slot is best-of-N and one
          game won't settle it — the fan is picking who takes the series. */}
      {slot.winsNeeded > 1 && (
        <p className="bracket-slot__series">
          Best of {slot.eventIds.length} — first to {slot.winsNeeded}
        </p>
      )}
      <div className="bracket-slot__sides">
        <CandidateButton
          team={candidates[0]}
          picked={picked != null && picked === candidates[0]?.teamId}
          disabled={disabled}
          onPick={() => candidates[0] && onPick(candidates[0].teamId)}
        />
        <span className="bracket-slot__vs">vs</span>
        <CandidateButton
          team={candidates[1]}
          picked={picked != null && picked === candidates[1]?.teamId}
          disabled={disabled}
          onPick={() => candidates[1] && onPick(candidates[1].teamId)}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// A slot once the contest has LOCKED: what happened, what the fan picked, and —
// the whole point of this screen — WHICH KIND of zero a zero is.
// ---------------------------------------------------------------------------

function ResultSlot({ slot }: { slot: BracketSlotView }) {
  const { result } = slot;
  const hasScore = slot.homeScore !== null && slot.awayScore !== null;
  const matchup =
    slot.participants[0] || slot.participants[1]
      ? `${teamLabel(slot.participants[0])} vs ${teamLabel(slot.participants[1])}`
      : 'Teams to be decided';

  // The status line for the game itself, independent of how the fan did.
  const gameLine =
    slot.gameStatus === 'final'
      ? 'Final'
      : slot.gameStatus === 'live'
      ? 'Live'
      : slot.scheduledAt
      ? formatWhen(slot.scheduledAt)
      : 'Date TBD';

  return (
    <li className={`bracket-slot bracket-slot--result${result ? ` bracket-slot--${result}` : ''}`}>
      <div className="bracket-slot__head">
        <span className="bracket-slot__when">
          {gameLine}
          {hasScore && (
            <span className="bracket-slot__score">
              {' '}
              · {slot.awayScore}–{slot.homeScore}
            </span>
          )}
        </span>
        <span className="bracket-slot__worth">{points(slot.points)} pts</span>
      </div>

      <p className="bracket-slot__matchup">{matchup}</p>

      {slot.winner && (
        <p className="bracket-slot__winner">
          Won by <strong>{teamLabel(slot.winner)}</strong>
        </p>
      )}

      {/* The fan's own pick, and its verdict. */}
      {slot.myPick ? (
        <div className="bracket-verdict">
          <span className="bracket-verdict__pick">
            You picked <strong>{teamLabel(slot.myPick)}</strong>
          </span>
          {result === 'correct' && (
            <span className="bracket-verdict__mark bracket-verdict__mark--correct">
              ✓ +{points(slot.points)} pts
            </span>
          )}
          {result === 'wrong' && (
            <span className="bracket-verdict__mark bracket-verdict__mark--wrong">✗ Wrong</span>
          )}
          {/* MUTED, NOT RED. An unreachable pick is not a loss the fan took here;
              it is the echo of one they took earlier, and painting it in the same
              alarm colour as a loss tells them the same lie four times. */}
          {result === 'unreachable' && (
            <span className="bracket-verdict__mark bracket-verdict__mark--unreachable">
              Unreachable
            </span>
          )}
          {result === 'pending' && (
            <span className="bracket-verdict__mark bracket-verdict__mark--pending">
              Still alive
            </span>
          )}
        </div>
      ) : (
        <p className="bracket-slot__nopick muted">No pick for this slot.</p>
      )}

      {/* THE MOST IMPORTANT SENTENCE ON THE SCREEN. Verbatim from the backend,
          which derives it from who could still have reached this slot — never
          paraphrased here, because the two would drift and the fan would be told
          two different stories about the same zero. */}
      {slot.unreachableReason && (
        <p className="bracket-slot__reason">{slot.unreachableReason}</p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Standings — from the SHEET, not /contests/:id/leaderboard. That board is
// chassis-owned and shared across all eight contest types; it has no notion of a
// ceiling, and forking it so one type could carry one is the wrong trade. Revealed
// at lock like every other type's crowd view.
// ---------------------------------------------------------------------------

// `isMe` rides on every row, so this needs no notion of who the caller is.
function Standings({
  rows,
  onOpenFan,
}: {
  rows: BracketStandingsRow[];
  onOpenFan: (row: BracketStandingsRow) => void;
}) {
  return (
    <section className="bracket-standings">
      <h2 className="bracket-standings__title">Standings</h2>
      <p className="bracket-standings__note muted">
        Ceiling is a score plus every slot still winnable — what an entry can
        finish on if everything left goes its way.
      </p>
      <ol className="bracket-standings__list">
        {rows.map((row, i) => (
          <li
            key={row.entryId}
            className={`bracket-standings__row${
              row.isMe ? ' bracket-standings__row--me' : ''
            }`}
          >
            <span className="bracket-standings__rank">{i + 1}</span>
            <button
              type="button"
              className="bracket-standings__who"
              onClick={() => onOpenFan(row)}
            >
              {/* No display name comes back on this read (see BracketStandingsRow)
                  — so an entry is "You" or a short id, and the card behind the tap
                  resolves the rest. */}
              {row.isMe ? 'You' : row.displayName ?? `Fan ${row.userId.slice(0, 8)}`}
            </button>
            <span className="bracket-standings__score">{points(Number(row.score))}</span>
            <span className="bracket-standings__ceiling">
              ceiling {points(row.ceiling)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function BracketBoard({
  contest,
  onWithdrew,
}: {
  contest: ContestDetail;
  onWithdrew: () => void;
}) {
  const { token } = useAuth();
  const { runGated } = useAgeGate();
  const { applyBalance } = usePoints();
  const entered = contest.myEntry != null;

  const [sheet, setSheet] = useState<BracketSheet | null>(null);
  const [loading, setLoading] = useState(entered);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The local tree, slot -> teamId. Seeded from whatever the fan already submitted
  // so a revisit pre-lock shows their bracket and can change it.
  const [draft, setDraft] = useState<Map<number, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [openFan, setOpenFan] = useState<BracketStandingsRow | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // The tree topology, off config (the sheet carries no `from` — see the header).
  const configSlots = useMemo<BracketConfigSlot[]>(
    () => [...(contest.config.slots ?? [])].sort((a, b) => a.slot - b.slot),
    [contest.config.slots],
  );
  const seedTeam = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of contest.config.seeds ?? []) m.set(s.seed, s.teamId);
    return m;
  }, [contest.config.seeds]);

  // Every team that appears anywhere on the sheet, by id. Round-1 participants are
  // resolved from the seed lines the moment the contest exists, so this covers the
  // whole field — which is what lets a draft name a team the tree hasn't reached.
  const teamById = useMemo(() => {
    const m = new Map<string, BracketTeamRef>();
    const add = (t: BracketTeamRef | null) => {
      if (t && !m.has(t.teamId)) m.set(t.teamId, t);
    };
    for (const s of sheet?.slots ?? []) {
      add(s.participants[0]);
      add(s.participants[1]);
      add(s.winner);
      add(s.myPick);
    }
    return m;
  }, [sheet]);

  const refresh = useCallback(async () => {
    if (!token || !entered) return;
    try {
      setSheet(await getBracketSheet(token, contest.id));
    } catch {
      /* keep the prior tree; a transient read failure isn't worth blanking it */
    }
  }, [token, entered, contest.id]);

  // Initial load (entered fans only — the sheet 403s for non-entrants).
  useEffect(() => {
    if (!token || !entered) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getBracketSheet(token, contest.id)
      .then((s) => {
        if (cancelled) return;
        setSheet(s);
        // Seed the draft from the submitted tree.
        const seeded = new Map<number, string>();
        for (const slot of s.slots) if (slot.myPick) seeded.set(slot.slot, slot.myPick.teamId);
        setDraft(seeded);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load your bracket');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, entered, contest.id]);

  // Live poll — only while the contest is LIVE, mirroring the other boards.
  const live = sheet?.contestStatus === 'live';
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => void refresh(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, refresh]);

  // A tap: take the pick, then reconcile the whole tree so anything it
  // invalidated downstream falls away in the same beat.
  const onPick = useCallback(
    (slot: number, teamId: string) => {
      setSaved(false);
      setSubmitError(null);
      setDraft((prev) => {
        const next = new Map(prev);
        next.set(slot, teamId);
        return reconcileDraft(configSlots, seedTeam, next);
      });
    },
    [configSlots, seedTeam],
  );

  async function onSubmit() {
    if (!token || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Through the 18+ gate — the PUT is age-gated on the backend (the GET isn't).
      const next = await runGated(() =>
        submitBracket(token, contest.id, {
          picks: [...draft].map(([slot, teamId]) => ({ slot, teamId })),
        }),
      );
      setSheet(next);
      const seeded = new Map<number, string>();
      for (const slot of next.slots) if (slot.myPick) seeded.set(slot.slot, slot.myPick.teamId);
      setDraft(seeded);
      setSaved(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit your bracket');
    } finally {
      setSubmitting(false);
    }
  }

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

  // Non-entrant on a closed contest (the page routes open+not-entered to the enter
  // hero, so this is the locked/live/final spectator case).
  if (!entered) {
    return (
      <div className="contest-detail__body">
        <div className="results-empty">
          <p className="results-empty__title">You didn&apos;t enter this one</p>
          <p className="results-empty__hint">
            Brackets are picked before the first game, so this one is closed. Browse
            the contest lobby for what&apos;s open.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="card muted">Loading your bracket…</div>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!sheet) return null;

  const drafting = sheet.contestStatus === 'open';
  const maxRound = sheet.slots.reduce((m, s) => Math.max(m, s.round), 0);
  const byRound = new Map<number, BracketSlotView[]>();
  for (const s of sheet.slots) {
    byRound.set(s.round, [...(byRound.get(s.round) ?? []), s]);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  const total = configSlots.length || sheet.slots.length;
  const complete = draft.size === total && total > 0;
  const submitted = sheet.slots.some((s) => s.myPick != null);
  // Only worth a PUT if the draft actually differs from what's committed.
  const dirty = sheet.slots.some((s) => (draft.get(s.slot) ?? null) !== (s.myPick?.teamId ?? null));

  // "Am I dead?" — stated from the ceiling, which is the only number that answers
  // it. Two separate facts rather than one verdict: whether anything the fan holds
  // can still score, and whether it can still catch the leader.
  const standings = sheet.standings ?? [];
  // The leader is row ONE, and it is null when that row is the fan themselves —
  // taking the first row that isn't me would name the RUNNER-UP as the leader and
  // tell a fan in first place they can't catch someone they're already ahead of.
  const top = standings[0] ?? null;
  const leader = top && !top.isMe ? top : null;
  const myScore = Number(sheet.score);
  const nothingLeft = sheet.revealed && sheet.ceiling <= myScore;
  const cantCatch =
    sheet.revealed && leader != null && sheet.ceiling < Number(leader.score);

  return (
    <div className="contest-detail__body bracket">
      {/* ---- Where the fan stands: score, ceiling, and what that means ---- */}
      <header className="bracket-head">
        <div className="bracket-head__figures">
          <span className="bracket-figure">
            <span className="bracket-figure__num">{points(myScore)}</span>
            <span className="bracket-figure__key">points</span>
          </span>
          <span className="bracket-figure">
            <span className="bracket-figure__num">{points(sheet.ceiling)}</span>
            <span className="bracket-figure__key">ceiling</span>
          </span>
        </div>
        {sheet.revealed && (
          <p className="bracket-head__read">
            {cantCatch
              ? `The leader has ${points(Number(leader!.score))} — more than your ceiling. You can't finish first.`
              : nothingLeft
              ? 'Every slot on your bracket is decided. This is your final score.'
              : 'Still live — your ceiling is what you finish on if everything left goes your way.'}
          </p>
        )}
      </header>

      {/* ---- The tree, stacked by round ---- */}
      {rounds.map((round) => (
        <section key={round} className="bracket-round">
          <h2 className="bracket-round__title">
            {roundLabel(round, maxRound)}
            <span className="bracket-round__worth">
              {points(byRound.get(round)?.[0]?.points ?? 0)} pts a slot
            </span>
          </h2>
          <ul className="bracket-round__slots">
            {(byRound.get(round) ?? []).map((slot) => {
              if (!drafting) return <ResultSlot key={slot.slot} slot={slot} />;
              const cfg = configSlots.find((c) => c.slot === slot.slot);
              // Without the topology there is nothing to draft against — fall back
              // to the sheet's own resolved participants (correct for round 1,
              // TBD after) rather than rendering an empty slot.
              const ids = cfg
                ? buildCandidates(cfg, seedTeam, draft)
                : [slot.participants[0]?.teamId ?? null, slot.participants[1]?.teamId ?? null];
              const candidates: [BracketTeamRef | null, BracketTeamRef | null] = [
                ids[0] ? teamById.get(ids[0]) ?? null : null,
                ids[1] ? teamById.get(ids[1]) ?? null : null,
              ];
              return (
                <DraftSlot
                  key={slot.slot}
                  slot={slot}
                  candidates={candidates}
                  picked={draft.get(slot.slot) ?? null}
                  disabled={submitting}
                  onPick={(teamId) => onPick(slot.slot, teamId)}
                />
              );
            })}
          </ul>
        </section>
      ))}

      {/* ---- Commit. A bracket is submitted WHOLE, so the bar states how far off
              complete the fan is rather than offering a button that 400s. ---- */}
      {drafting && (
        <section className="bracket-commit">
          {submitError && <div className="error">{submitError}</div>}
          <div className="bracket-commit__row">
            <span className="bracket-commit__count">
              {draft.size} of {total} slots picked
              {submitted && !dirty && ' · submitted'}
            </span>
            <button
              type="button"
              className="bracket-commit__go"
              disabled={!complete || submitting || !dirty}
              onClick={() => void onSubmit()}
            >
              {submitting
                ? 'Submitting…'
                : submitted
                ? 'Update bracket'
                : 'Submit bracket'}
            </button>
          </div>
          {!complete && (
            <p className="bracket-commit__hint muted">
              A bracket is submitted whole — pick every slot through the final, then
              commit. You can change it until the first game starts.
            </p>
          )}
          {saved && !dirty && (
            <p className="bracket-commit__saved">
              Bracket saved. You can change it until the first game starts.
            </p>
          )}
        </section>
      )}

      {/* ---- Standings (revealed at lock) ---- */}
      {sheet.revealed && standings.length > 0 && (
        <Standings rows={standings} onOpenFan={setOpenFan} />
      )}

      {/* ---- Withdraw (open only) ---- */}
      {drafting && (
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
                  onClick={() => void onWithdraw()}
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
      )}

      {openFan && (
        <FanCard
          key={openFan.userId}
          userId={openFan.userId}
          fallbackName={openFan.displayName ?? null}
          isMe={openFan.isMe}
          // Contest standings aren't the winnings board — same call the pick'em
          // leaderboard makes.
          board="earned"
          onClose={() => setOpenFan(null)}
        />
      )}
    </div>
  );
}
