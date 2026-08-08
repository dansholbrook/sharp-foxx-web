'use client';

// The SURVIVOR surface for /contests/[id] when type==='survivor'. A survivor
// contest IS a contest (the chassis owns enter/leaderboard, shared with pick'em),
// but its body is the ROUND TIMELINE — the whole reason this surface exists —
// rather than a pick sheet. Each round a fan picks ONE team to win from that
// round's slate; a wrong pick (or no pick by lock) eliminates them, and a team
// may be used only ONCE across the contest. This component owns the timeline
// read, the tap-to-pick / tap-to-change gameplay, the used-teams bookkeeping, and
// the alive/eliminated status.
//
// A WRINKLE the pick'em sheet doesn't have: the survivor picks read carries only
// the CURRENT pick per round, not each round's available games. So to render the
// slate of an unlocked round we resolve config.rounds[].eventIds to team names via
// the events API (getEvents) — there's no per-id/batch event read, so this is the
// same full-list-then-index pattern the game page uses, fetched LAZILY the first
// time a round is opened to pick, so a fan who never opens one never pays for it.
//
// POINTS ONLY: entry costs points like any contest (the chassis EnterHero handles
// that when not entered); nothing here is money. Mobile-first — the round timeline
// stacks clean at 390px and the two team buttons per game are thumb-sized.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth-context';
import { useAgeGate } from '../../age-gate';
import { usePoints } from '../../points-context';
import { EntryAdvisoryNotice } from '../../entry-advisory';
import {
  entryRefusal,
  getSurvivorPicks,
  submitSurvivorPick,
  getEvents,
  getMyPicks,
  withdrawContest,
  contestCost,
  etDateTime,
  ContestDetail,
  SurvivorPicks,
  SurvivorRound,
  SurvivorPick,
  EventListItem,
} from '../../api';

// Poll cadence while the contest is LIVE — a round's game moves courtside (score,
// then the ✓/✗ grade that can eliminate the fan), so a gentle refresh keeps the
// timeline honest without a socket. Open/final contests don't poll. 30s: cheap,
// same cadence the pick'em scorecard and squares grid use.
const LIVE_POLL_MS = 30_000;

// Match the app's ET date+time treatment used across the game/contest surfaces.
// Labelled: kickoff is the elimination deadline, and it costs the fan the whole
// contest to read it an hour late.
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

// A game is closed to picking once it has started: the backend locks the round at
// its first kickoff, but a single started game inside an otherwise-open round
// would still 409 a tap. Mirror the pick'em guard so a started matchup renders
// inert rather than offering a tap that fails.
function gameStarted(ev: EventListItem): boolean {
  if (ev.status !== 'scheduled') return true;
  const at = new Date(ev.scheduledAt).getTime();
  return !Number.isNaN(at) && at <= Date.now();
}

// Which round eliminated the fan, for the ELIMINATED badge subtitle: the first
// round they either picked wrong or left unpicked once it locked. Null if none
// resolves (shouldn't happen for an eliminated entry, but the badge degrades to
// no round rather than guessing).
function eliminationRound(rounds: SurvivorRound[]): number | null {
  for (const r of rounds) {
    if (r.pick && r.pick.isCorrect === false) return r.round;
    if (!r.pick && r.locked) return r.round;
  }
  return null;
}

// ---------------------------------------------------------------------------
// One matchup in a round's slate: two thumb-sized team buttons. A team already
// used in ANOTHER round is disabled with a "Used R#" tag (a team may ride only
// once); the round's own current pick shows selected. A started game is inert.
// ---------------------------------------------------------------------------

function TeamButton({
  teamId,
  name,
  picked,
  usedInRound,
  disabled,
  onPick,
}: {
  teamId: string | null;
  name: string | null;
  picked: boolean;
  usedInRound: number | null;
  disabled: boolean;
  onPick: () => void;
}) {
  const used = usedInRound != null;
  return (
    <button
      type="button"
      className={`survivor-team${picked ? ' survivor-team--on' : ''}${
        used ? ' survivor-team--used' : ''
      }`}
      aria-pressed={picked}
      disabled={disabled || used || teamId == null}
      onClick={onPick}
    >
      <span className="survivor-team__name">{name ?? 'TBD'}</span>
      {used && <span className="survivor-team__used">Used R{usedInRound}</span>}
    </button>
  );
}

function MatchupRow({
  ev,
  currentPickTeamId,
  usedByRound,
  round,
  disabled,
  onPick,
}: {
  ev: EventListItem;
  currentPickTeamId: string | null;
  usedByRound: Map<string, number>;
  round: number;
  disabled: boolean;
  onPick: (eventId: string, teamId: string) => void;
}) {
  const started = gameStarted(ev);
  // A team is "used elsewhere" only if its winning round isn't this one — riding
  // the same team you already picked THIS round is the re-pick, not a reuse.
  const usedElsewhere = (teamId: string | null): number | null => {
    if (!teamId) return null;
    const r = usedByRound.get(teamId);
    return r != null && r !== round ? r : null;
  };
  return (
    <li className={`survivor-matchup${started ? ' survivor-matchup--locked' : ''}`}>
      <div className="survivor-matchup__head">
        <span className="survivor-matchup__when">{formatWhen(ev.scheduledAt)}</span>
        {started && <span className="survivor-matchup__status">Started</span>}
      </div>
      <div className="survivor-matchup__sides">
        <TeamButton
          teamId={ev.awayTeamId}
          name={ev.awayTeam}
          picked={currentPickTeamId != null && currentPickTeamId === ev.awayTeamId}
          usedInRound={usedElsewhere(ev.awayTeamId)}
          disabled={disabled || started}
          onPick={() => ev.awayTeamId && onPick(ev.id, ev.awayTeamId)}
        />
        <span className="survivor-matchup__at">@</span>
        <TeamButton
          teamId={ev.homeTeamId}
          name={ev.homeTeam}
          picked={currentPickTeamId != null && currentPickTeamId === ev.homeTeamId}
          usedInRound={usedElsewhere(ev.homeTeamId)}
          disabled={disabled || started}
          onPick={() => ev.homeTeamId && onPick(ev.id, ev.homeTeamId)}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The picked-team readout, shown prominently once a round has a pick: team vs
// opponent, kickoff, live/final score, and the ✓ survived / ✗ eliminated mark
// once graded.
// ---------------------------------------------------------------------------

function PickReadout({ pick }: { pick: SurvivorPick }) {
  const hasScore = pick.homeScore !== null && pick.awayScore !== null;
  const graded = pick.isCorrect !== null;
  const survived = pick.isCorrect === true;
  const whenLine =
    pick.gameStatus === 'final'
      ? 'Final'
      : pick.gameStatus === 'live'
      ? 'Live'
      : formatWhen(pick.scheduledAt);
  return (
    <div
      className={`survivor-pick${
        graded ? (survived ? ' survivor-pick--won' : ' survivor-pick--lost') : ''
      }`}
    >
      <div className="survivor-pick__main">
        <span className="survivor-pick__team">{pick.teamName}</span>
        <span className="survivor-pick__vs">vs {pick.opponent}</span>
      </div>
      <div className="survivor-pick__foot">
        <span className="survivor-pick__when">
          {whenLine}
          {hasScore && (
            <span className="survivor-pick__score">
              {' '}
              · {pick.awayScore}–{pick.homeScore}
            </span>
          )}
        </span>
        {graded && (
          <span
            className={`survivor-pick__mark${
              survived ? ' survivor-pick__mark--ok' : ' survivor-pick__mark--no'
            }`}
          >
            {survived ? '✓ Survived' : '✗ Eliminated'}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One round in the timeline.
// ---------------------------------------------------------------------------

function RoundCard({
  round,
  slate,
  eventsById,
  usedByRound,
  expanded,
  submitting,
  loadingEvents,
  eventsError,
  error,
  // The board-level conflict refusal, flattened to a boolean. THE SENTENCE IS
  // NOT PASSED DOWN ON PURPOSE: it is a fact about the board, so it is stated
  // once above the timeline and never repeated per round. All a round needs to
  // know is that its pick affordance is closed.
  covered,
  onToggle,
  onPick,
}: {
  round: SurvivorRound;
  slate: string[];
  eventsById: Map<string, EventListItem> | null;
  usedByRound: Map<string, number>;
  expanded: boolean;
  submitting: boolean;
  loadingEvents: boolean;
  eventsError: string | null;
  error: string | null;
  covered: boolean;
  onToggle: () => void;
  onPick: (eventId: string, teamId: string) => void;
}) {
  const { round: n, locked, pick } = round;
  // The three faces of a round: picked (show it), unpicked+unlocked (offer the
  // slate), unpicked+locked (they missed it — that's an elimination).
  const missed = !pick && locked;

  return (
    <li className={`survivor-round${missed ? ' survivor-round--missed' : ''}`}>
      <div className="survivor-round__head">
        <span className="survivor-round__label">Round {n}</span>
        <span
          className={`survivor-round__lock${
            locked ? ' survivor-round__lock--locked' : ''
          }`}
        >
          {locked ? 'Locked' : 'Open'}
        </span>
      </div>

      {pick && <PickReadout pick={pick} />}

      {missed && (
        <p className="survivor-round__missed">No pick — eliminated this round.</p>
      )}

      {/* Pre-lock, a round is always changeable: offer the slate whether or not
          there's already a pick (tapping a different team replaces it — the PUT
          upserts, so no confirm is needed pre-lock).

          A COVERED BOARD DROPS THE TOGGLE ENTIRELY rather than disabling it. On
          every other surface the greyed control is the point — it shows what
          you'd otherwise be doing. Here the control opens a PANEL, and a dead
          "Pick your team" button that refuses to expand is a worse answer than
          no button: the readout above still shows any pick they made, so the
          round is not left blank. */}
      {!locked && !covered && (
        <div className="survivor-round__pickarea">
          <button
            type="button"
            className="survivor-round__toggle"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? 'Close' : pick ? 'Change pick' : 'Pick your team'}
          </button>

          {expanded && (
            <div className="survivor-slate">
              {loadingEvents ? (
                <p className="muted survivor-slate__note">Loading this round&apos;s games…</p>
              ) : eventsError ? (
                <div className="error">{eventsError}</div>
              ) : slate.length === 0 ? (
                <p className="muted survivor-slate__note">
                  No games listed for this round yet.
                </p>
              ) : (
                <ul className="survivor-matchup__list">
                  {slate.map((eventId) => {
                    const ev = eventsById?.get(eventId);
                    if (!ev) {
                      return (
                        <li key={eventId} className="survivor-matchup survivor-matchup--missing">
                          <span className="muted">Game unavailable</span>
                        </li>
                      );
                    }
                    return (
                      <MatchupRow
                        key={eventId}
                        ev={ev}
                        currentPickTeamId={pick?.teamId ?? null}
                        usedByRound={usedByRound}
                        round={n}
                        disabled={submitting}
                        onPick={onPick}
                      />
                    );
                  })}
                </ul>
              )}
              {error && <div className="survivor-slate__error">{error}</div>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function SurvivorBoard({
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

  const [picks, setPicks] = useState<SurvivorPicks | null>(null);
  const [loading, setLoading] = useState(entered);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The round slate resolves against the full events list — no per-id/batch read
  // exists, so we fetch it once (getEvents) and index by id, LAZILY the first time
  // a round is opened to pick.
  const [eventsById, setEventsById] = useState<Map<string, EventListItem> | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Which round's slate is open, which round has a pick in flight, and any
  // per-round error (a 409 "already used" / round-locked), keyed by round.
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [submittingRound, setSubmittingRound] = useState<number | null>(null);
  const [roundError, setRoundError] = useState<{ round: number; message: string } | null>(
    null,
  );

  // Withdraw is a two-step inline confirm (no window.confirm), same as the pick'em
  // chassis — refunds the entry and drops the fan back to the enter hero. Only
  // offered while the contest is still open.
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Config slate, indexed by round number.
  const slateByRound = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const cr of contest.config.rounds ?? []) m.set(cr.round, cr.eventIds);
    return m;
  }, [contest.config.rounds]);

  // teamId -> the round it's committed to, across every picked round. The used-set
  // that disables a team everywhere else (a team rides only once).
  const usedByRound = useMemo(() => {
    const m = new Map<string, number>();
    if (picks) for (const r of picks.rounds) if (r.pick) m.set(r.pick.teamId, r.round);
    return m;
  }, [picks]);

  // Silent reload (no loading flash) — the live poll and post-submit reconcile.
  const refresh = useCallback(async () => {
    if (!token || !entered) return;
    try {
      setPicks(await getSurvivorPicks(token, contest.id));
    } catch {
      /* keep the prior timeline; a transient read failure isn't worth blanking it */
    }
  }, [token, entered, contest.id]);

  // Initial load (entered fans only — the picks read 403s for non-entrants).
  useEffect(() => {
    if (!token || !entered) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getSurvivorPicks(token, contest.id)
      .then((p) => {
        if (!cancelled) setPicks(p);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load rounds');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, entered, contest.id]);

  // Live poll — only while the contest is LIVE, mirroring the scorecard/grid.
  const live = picks?.contestStatus === 'live';
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => void refresh(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, refresh]);

  // Resolve the events index on demand (the first round opened).
  const ensureEvents = useCallback(async () => {
    if (!token || eventsById || loadingEvents) return;
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const list = await getEvents(token);
      setEventsById(new Map(list.map((e) => [e.id, e])));
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setLoadingEvents(false);
    }
  }, [token, eventsById, loadingEvents]);

  const onToggleRound = useCallback(
    (round: number) => {
      setRoundError(null);
      setExpandedRound((cur) => (cur === round ? null : round));
      // Resolve the events index the first time any round is opened — guarded and
      // idempotent, so calling it on a close (or twice) costs at most one fetch.
      void ensureEvents();
    },
    [ensureEvents],
  );

  const onPick = useCallback(
    async (round: number, eventId: string, teamId: string) => {
      if (!token || !picks || submittingRound != null) return;
      const roundRow = picks.rounds.find((r) => r.round === round);
      // Re-tapping the team already committed this round is a no-op — just close.
      if (roundRow?.pick?.teamId === teamId) {
        setExpandedRound(null);
        return;
      }
      const ev = eventsById?.get(eventId);
      const prev = picks;

      // Optimistic: paint the round's pick from the event so the tap feels
      // instant. teamName/opponent come off the event's two sides.
      if (ev) {
        const teamName = ev.homeTeamId === teamId ? ev.homeTeam : ev.awayTeam;
        const opponent = ev.homeTeamId === teamId ? ev.awayTeam : ev.homeTeam;
        const optimistic: SurvivorPick = {
          eventId,
          teamId,
          teamName: teamName ?? 'Your team',
          opponent: opponent ?? 'TBD',
          scheduledAt: ev.scheduledAt,
          gameStatus: ev.status,
          homeScore: ev.homeScore,
          awayScore: ev.awayScore,
          isCorrect: null,
        };
        setPicks((p) =>
          p
            ? {
                ...p,
                rounds: p.rounds.map((r) =>
                  r.round === round ? { ...r, pick: optimistic } : r,
                ),
              }
            : p,
        );
      }
      setSubmittingRound(round);
      setRoundError(null);

      try {
        // The PUT returns the rebuilt timeline — reconcile from it rather than
        // trusting the optimistic paint (keeps alive/eliminated counts honest).
        // Through the 18+ gate — see age-gate.tsx. The optimistic paint stays
        // up while the prompt is open, and stands if the retry lands.
        const next = await runGated(() =>
          submitSurvivorPick(token, contest.id, { round, eventId, teamId }),
        );
        setPicks(next);
        setSubmittingRound(null);
        setExpandedRound(null);
      } catch (err) {
        // Revert the optimistic paint and say what went wrong on that round — the
        // 409 "You already used <team> in round <N>" carries its own round, so the
        // verbatim message is the kind inline note the task asks for.
        setPicks(prev);
        setSubmittingRound(null);
        setRoundError({
          round,
          message: err instanceof Error ? err.message : 'Could not save your pick',
        });
      }
    },
    [token, picks, submittingRound, eventsById, contest.id, runGated],
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

  // Non-entrant on a closed contest (the page routes open+not-entered to the enter
  // hero, so this is the locked/live/final spectator case).
  if (!entered) {
    return (
      <div className="contest-detail__body">
        <div className="results-empty">
          <p className="results-empty__title">You didn&apos;t enter this one</p>
          <p className="results-empty__hint">
            Survivor picks are closed. Browse the contest lobby for what&apos;s open.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="card muted">Loading your rounds…</div>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!picks) return null;

  const alive = picks.entryStatus === 'active';
  const elimRound = alive ? null : eliminationRound(picks.rounds);
  const canWithdraw = picks.contestStatus === 'open';
  const covering = entryRefusal(picks.entry);

  return (
    <div className="contest-detail__body survivor">
      {/* ---- Status header: my standing + the field counts ---- */}
      <header className="survivor-head">
        <div className="survivor-status">
          {alive ? (
            <span className="survivor-badge survivor-badge--alive">Alive</span>
          ) : (
            <span className="survivor-badge survivor-badge--out">
              Eliminated
              {elimRound != null && (
                <span className="survivor-badge__sub">Round {elimRound}</span>
              )}
            </span>
          )}
        </div>
        <div className="survivor-counts">
          <span className="survivor-counts__alive">{picks.alive} alive</span>
          <span className="survivor-counts__sep">·</span>
          <span className="survivor-counts__out">{picks.eliminated} out</span>
        </div>
      </header>

      {/* ---- The conflict refusal, ONCE, between the standing and the timeline.
              A fact about the board, not about round 4: repeating it down every
              round would turn one statement into a drumbeat, and the fan's
              standing above it is still theirs — a correspondent assigned
              mid-run stays alive on the picks they already made. ---- */}
      {covering && <EntryAdvisoryNotice refusal={covering} />}

      {/* ---- The rounds timeline ---- */}
      <ol className="survivor-timeline">
        {picks.rounds.map((r) => (
          <RoundCard
            key={r.round}
            round={r}
            slate={slateByRound.get(r.round) ?? []}
            eventsById={eventsById}
            usedByRound={usedByRound}
            expanded={expandedRound === r.round}
            submitting={submittingRound === r.round}
            loadingEvents={loadingEvents}
            eventsError={eventsError}
            error={roundError?.round === r.round ? roundError.message : null}
            covered={covering !== null}
            onToggle={() => onToggleRound(r.round)}
            onPick={(eventId, teamId) => void onPick(r.round, eventId, teamId)}
          />
        ))}
      </ol>

      {/* ---- Withdraw (open only) ---- */}
      {canWithdraw && (
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
      )}
    </div>
  );
}
