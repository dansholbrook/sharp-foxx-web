'use client';

// The prediction engine's PRESENCE ON THE FEED — three bands, in the order a fan
// needs them:
//
//   1. YourPicksBand   — "Your picks": what you're holding right now, above the
//                        follows band. Answers "how am I doing?" before the feed
//                        shows you anything else.
//   2. NationalBoardBand — "National board": the house questions, pickable right
//                        here. The feed IS the National Board's surface; there
//                        is no /national page.
//   3. OpenGamesBand   — "Make your picks": games with a question open now.
//
// POINTS ONLY, same as everywhere else in this engine: "points", "picks",
// "stake" — never "bet", "wager", "odds".
//
// Every band hides ENTIRELY when it has nothing (no empty states, no skeletons).
// These sit on top of a feed that already works; a fan who has never picked
// should not be able to tell they exist. That rule is why each band returns null
// rather than rendering a placeholder, and why every fetch here is best-effort.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PickCard, usePickBoard } from './predictions';
import { usePoints } from './points-context';
import { useEngagementEarn } from './earn-context';
import {
  getMyPicks,
  getNationalPredictions,
  getOpenPickGames,
  getContests,
  isNationalOverdue,
  isFeedEvent,
  contestCost,
  contestTypeLabel,
  squaresPerSquareLabel,
  parlayStakeRangeLabel,
  points,
  signedPoints,
  etDateTime,
  Contest,
  EventListItem,
  FollowMineEntry,
  MyPick,
  NationalPrediction,
  OpenPickGame,
} from './api';

// A settled pick stays in the band for two days — long enough that a fan who
// picked last night still lands on their result, short enough that the band
// stays about NOW rather than becoming a second pick history (that's /picks).
const RECENT_MS = 48 * 60 * 60 * 1000;

// The National Board's feed cap. The endpoint returns up to 20 (open+locked
// first, then recently resolved); four is what reads as a band rather than a
// page. The rest are one tap away — see the expander in NationalBoardBand.
const NATIONAL_FEED_CAP = 4;

// Tip-off time for a game that hasn't started — the clock is what a fan waiting
// on a pick actually wants. Same treatment as the rest of the feed's dates, and
// labelled ET because a fan reads this one to decide when to be back.
function formatKickoff(iso: string): string {
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

// The resolve-by DATE ('2026-07-15'), which is a promise to fans, not an
// instant. Parsed as UTC-noon rather than through the plain Date constructor:
// `new Date('2026-07-15')` is midnight UTC, which renders as the 14th for every
// fan west of Greenwich — the one day the house promised not to slip.
function formatResolvesBy(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The shared pulsing LIVE badge — same scoped .live-badge treatment the feed,
// game page, and rail already use.
function LiveBadge() {
  return (
    <span className="live-badge">
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1. YOUR PICKS
// ---------------------------------------------------------------------------

// What the band shows: picks still in play, plus anything that settled in the
// last 48h.
//
// Note what this does NOT catch: a VOIDED pick. The backend never stamps
// resolvedAt on a void (only status moves), so a refund has no date to be recent
// BY, and including every voided pick forever would be worse than the omission —
// the band would fill with questions staff pulled months ago. A refunded fan
// still sees it on /picks, which is the one place a fan looks for their own
// points, and their balance already moved. Nothing is lost here but a caption.
function isRecentlySettled(p: MyPick, now: number): boolean {
  if (p.outcome !== 'won' && p.outcome !== 'lost') return false;
  if (!p.resolvedAt) return false;
  const at = new Date(p.resolvedAt).getTime();
  return !Number.isNaN(at) && now - at <= RECENT_MS;
}

// One in-play pick. The caption is the pick's CONTEXT: a game pick gets its
// game's status (live pulse / tip-off), a national pick gets its context label
// ("NBA Finals 2026") — which is the only thing a national pick HAS, since it is
// tied to no game and its eventId is null.
function PendingPickCard({
  pick,
  event,
}: {
  pick: MyPick;
  // The game this pick rides on, if the feed has it loaded. /predictions/my-picks
  // carries no status or scheduledAt, so this is joined in client-side from the
  // events the feed already fetched — free, rather than a second read per pick.
  // Null for a national pick (no game) or a game outside the feed's window.
  event: EventListItem | null;
}) {
  // A national pick has nowhere to go but the fan's own history; a game pick
  // opens the board it was made on.
  const href = pick.eventId ? `/games/${pick.eventId}` : '/picks';

  return (
    <Link href={href} className="feedpicks-card">
      <span className="feedpicks-card__q">{pick.question}</span>
      <span className="feedpicks-card__mine">
        Your pick: <strong>{pick.pickLabel}</strong>
      </span>
      <span className="feedpicks-card__foot">
        {pick.scope === 'national' ? (
          <span className="feedpicks-card__ctx">{pick.context ?? 'National'}</span>
        ) : event?.status === 'live' ? (
          <LiveBadge />
        ) : event ? (
          <span className="feedpicks-card__when">
            {event.status === 'final' ? 'Final' : formatKickoff(event.scheduledAt)}
          </span>
        ) : (
          // The game isn't in the feed's event list — say nothing about it
          // rather than guess. The stake still tells the fan what's riding.
          <span className="feedpicks-card__when">In play</span>
        )}
        <span className="feedpicks-card__stake">{points(pick.stake)} pts</span>
      </span>
    </Link>
  );
}

// A just-settled pick, compact: the badge IS the card. A fan scanning this band
// wants the verdict, not the question re-litigated.
function SettledPickCard({ pick }: { pick: MyPick }) {
  const won = pick.outcome === 'won';
  const href = pick.eventId ? `/games/${pick.eventId}` : '/picks';
  return (
    <Link
      href={href}
      className={`feedpicks-card feedpicks-card--settled feedpicks-card--${pick.outcome}`}
    >
      <span className="feedpicks-badge">{won ? 'Won' : 'Lost'}</span>
      <span className="feedpicks-card__q">{pick.question}</span>
      <span className="feedpicks-card__foot">
        <span className="feedpicks-card__mine">{pick.pickLabel}</span>
        {/* `net` is what the pick did to the balance — already net of the stake,
            so a 100-point win reads +100, never the gross 200. */}
        <span
          className={`feedpicks-card__net feedpicks-card__net--${won ? 'up' : 'down'}`}
        >
          {signedPoints(pick.net)}
        </span>
      </span>
    </Link>
  );
}

export function YourPicksBand({ token, events }: { token: string; events: EventListItem[] }) {
  const [picks, setPicks] = useState<MyPick[] | null>(null);
  // The shared balance is a PICK SIGNAL, and that's why it's a dependency below:
  // it only ever moves when a pick's response comes back carrying the new
  // wallet (applyBalance). A fan picking a house question in the National Board
  // band further down this same page would otherwise leave this band — sitting
  // right above it, claiming to show what they're holding — silently missing the
  // pick they just made. The National Board being pickable in-feed is the whole
  // point of that band, so this is the primary path, not an edge.
  //
  // The cost is one extra /predictions/my-picks read per feed load: this band
  // re-reads once when the wallet's own initial load settles the balance from
  // null. That's the honest price of the band never lying, and it's the same
  // read the `pending=` note on getMyPicks would shrink.
  const { balance } = usePoints();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const report = await getMyPicks(token);
        if (!cancelled) setPicks(report.picks);
      } catch {
        // Best-effort: the band just doesn't render. It is an addition to a feed
        // that works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, balance]);

  // Index the feed's events once so the join below is a lookup, not a scan per
  // pick.
  const eventsById = useMemo(() => {
    const m = new Map<string, EventListItem>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  // The 48h window is computed ONCE per render rather than per pick, so every
  // card in a pass is judged against the same instant.
  const { pending, settled } = useMemo(() => {
    const now = Date.now();
    const all = picks ?? [];
    return {
      pending: all.filter((p) => p.outcome === 'pending'),
      settled: all.filter((p) => isRecentlySettled(p, now)),
    };
  }, [picks]);

  // Nothing in play and nothing just settled -> the band does not exist. A fan
  // who has never picked never sees it.
  if (pending.length === 0 && settled.length === 0) return null;

  return (
    <section className="row feedpicks">
      <div className="feedpicks__head">
        <h2 className="row-title">Your picks</h2>
        <Link href="/picks" className="feedpicks__all">
          All my picks →
        </Link>
      </div>
      <div className="row-track feedpicks__track">
        {/* In-play first: what's still live matters more than what's done. */}
        {pending.map((p) => (
          <PendingPickCard
            key={p.pickId}
            pick={p}
            event={p.eventId ? (eventsById.get(p.eventId) ?? null) : null}
          />
        ))}
        {settled.map((p) => (
          <SettledPickCard key={p.pickId} pick={p} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. NATIONAL BOARD
// ---------------------------------------------------------------------------

// The context line under a national question: what it's about, and who asked.
// `openedByName` is a real staff member, not a house brand — the backend is
// deliberate about that, so don't dress it up as one here.
function NationalCaption({ p }: { p: NationalPrediction }) {
  const overdue = isNationalOverdue(p);
  return (
    <div className="natboard-caption">
      {p.context && <span className="natboard-ctx">{p.context}</span>}
      {p.openedByName && (
        <span className="natboard-by">asked by {p.openedByName}</span>
      )}
      {/* Only worth saying while the fan's points are still riding on it. */}
      {p.resolvesBy && (p.status === 'open' || p.status === 'locked') && (
        <span className={`natboard-by${overdue ? ' natboard-by--late' : ''}`}>
          {overdue ? 'Resolution overdue' : `Resolves by ${formatResolvesBy(p.resolvesBy)}`}
        </span>
      )}
    </div>
  );
}

export function NationalBoardBand({ token }: { token: string }) {
  const [expanded, setExpanded] = useState(false);
  const fetchRows = useCallback(() => getNationalPredictions(token), [token]);
  // Calling a house question is an EARN (national_pick, 10 pts, capped at 2/day).
  // Wired here and not in usePickBoard because a GAME pick is not this action —
  // the game board shares the same state machine and must stay silent.
  const earn = useEngagementEarn();
  const onPicked = useCallback(() => void earn('national_pick'), [earn]);
  // The SAME state machine the game board runs on — optimistic taps, per-card
  // 409s, the balance push. A fan picks a house question right here on the feed.
  // No poll: a national question settles on a scale of weeks, so there is
  // nothing to poll for, and the feed shouldn't pay for a timer that never
  // changes anything. The board re-reads itself after each pick.
  const { rows, onPick, optimistic, errors } = usePickBoard({
    token,
    fetchRows,
    onPicked,
  });

  // The accordion. These cards are FULL pick cards stacked one-per-row at rail
  // width, so two open questions used to make the rail enormous. Here each card
  // collapses to a header + one summary row and only ONE is expanded at a time
  // (openId); tapping a header expands it and collapses whichever was open.
  const [openId, setOpenId] = useState<string | null>(null);
  // Smart default, computed ONCE per board load rather than on every render, so
  // a fan expanding then collapsing every card isn't overruled on the next
  // poll. Auto-expand the sole question that's open AND unpicked — the one thing
  // asking for an action — and only when it's alone; anything else (nothing to
  // do, or several waiting) starts fully collapsed. Resolved/voided never
  // auto-open: they're a record, not a prompt.
  const [didAutoOpen, setDidAutoOpen] = useState(false);
  useEffect(() => {
    if (didAutoOpen || !rows) return;
    const actionable = rows.filter(
      (p) => p.status === 'open' && p.myPick === null,
    );
    setOpenId(actionable.length === 1 ? actionable[0].id : null);
    setDidAutoOpen(true);
  }, [rows, didAutoOpen]);

  const toggle = useCallback(
    (id: string) => setOpenId((cur) => (cur === id ? null : id)),
    [],
  );

  if (!rows || rows.length === 0) return null;

  const shown = expanded ? rows : rows.slice(0, NATIONAL_FEED_CAP);

  return (
    <section className="row natboard">
      <div className="feedpicks__head">
        <h2 className="row-title">National board</h2>
        <span className="natboard__sub">House questions · points only</span>
      </div>
      <div className="natboard__list">
        {shown.map((p) => (
          <PickCard
            key={p.id}
            prediction={p}
            caption={<NationalCaption p={p} />}
            optimisticKey={optimistic[p.id] ?? null}
            error={errors[p.id] ?? null}
            onPick={(key) => void onPick(p.id, key)}
            collapsed={openId !== p.id}
            onToggleCollapse={() => toggle(p.id)}
          />
        ))}
      </div>
      {/* "See all" expands IN PLACE rather than linking out — the feed band is
          the National Board's only surface, and the endpoint has already sent
          every row (it caps at 20). Same idiom as the follows band's Show-all. */}
      {rows.length > NATIONAL_FEED_CAP && (
        <button
          type="button"
          className="show-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `See all (${rows.length}) →`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. MAKE YOUR PICKS
// ---------------------------------------------------------------------------

// `isFeed` flags an ingested feed game (source != null). "Make your picks" is a
// PLAY surface, so it lists games of BOTH kinds -- a feed entry just gets the
// muted "Scores" tag (no watch language, no live pulse card) so a fan reads it
// as external contest material, not a Sharp Foxx broadcast. See THE RULE in
// api.ts. The link still points at /games/[id], which renders the lean
// feed-variant page for these.
function OpenGameCard({ game, isFeed }: { game: OpenPickGame; isFeed: boolean }) {
  const home = game.homeTeamName ?? 'TBD';
  const away = game.awayTeamName ?? 'TBD';
  return (
    <Link
      href={`/games/${game.eventId}`}
      className="feedpicks-game"
      aria-label={`Make picks on ${home} vs ${away}`}
    >
      <span className="feedpicks-game__top">
        {game.status === 'live' ? (
          <LiveBadge />
        ) : (
          <span className="feedpicks-game__when">
            {formatKickoff(game.scheduledAt)}
          </span>
        )}
        {isFeed && <span className="playcard-scorestag">Scores</span>}
      </span>
      <span className="feedpicks-game__matchup">
        {home} <span className="feedpicks-game__vs">vs</span> {away}
      </span>
      <span className="feedpicks-game__foot">
        <span className="feedpicks-game__open">
          {game.openCount === 1 ? '1 open pick' : `${game.openCount} open picks`}
        </span>
        <span className="feedpicks-game__stake">from {points(game.minStake)} pts</span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// 4. CONTESTS
// ---------------------------------------------------------------------------

// The feed's window onto the contest lobby: open pick'em contests as compact
// rail rows, linking to /contests/[id]. Best-effort and self-hiding, same as the
// bands above — a fan with no open contest never sees it.
//
// Shows title, cost and a lock countdown from the list payload. It deliberately
// does NOT show an "Entered ✓" flag: GET /contests carries no per-fan entry
// state (that lives on the detail read), and a detail fan-out per row is exactly
// what a compact rail band shouldn't do. The Entered state shows once the fan
// opens the contest.
const CONTESTS_RAIL_CAP = 4;

function contestLockCountdown(locksAt: string | null): string | null {
  if (!locksAt) return null;
  const at = new Date(locksAt).getTime();
  if (Number.isNaN(at)) return null;
  const ms = at - Date.now();
  if (ms <= 0) return 'Locking now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Locks in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `Locks in ${hrs}h`;
  return `Locks in ${Math.round(hrs / 24)}d`;
}

function ContestRailRow({ contest }: { contest: Contest }) {
  const countdown = contestLockCountdown(contest.locksAt);
  return (
    <Link href={`/contests/${contest.id}`} className="railcontest">
      <span className="railcontest__title">{contest.title}</span>
      <span className="railcontest__foot">
        {/* The type tag distinguishes a Survivor / Squares / Pick'em row at a
            glance — the lobby leans on it, so the rail should too. */}
        <span className="railcontest__type">{contestTypeLabel(contest.type)}</span>
        {/* Squares and parlay boards enter free — show the per-square price /
            the ticket stake range, not "Free". */}
        <span className="railcontest__cost">
          {contest.type === 'squares'
            ? squaresPerSquareLabel(contest.config)
            : contest.type === 'parlay_board'
            ? parlayStakeRangeLabel(contest.config)
            : contestCost(contest.entryCost)}
        </span>
        {countdown && <span className="railcontest__when">{countdown}</span>}
      </span>
    </Link>
  );
}

export function ContestsBand({ token }: { token: string }) {
  const [contests, setContests] = useState<Contest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Open contests only — the ones a fan can still enter and play.
        const page = await getContests(token, { status: 'open', limit: 10 });
        if (!cancelled) setContests(page.items);
      } catch {
        // Best-effort, same as the bands above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!contests || contests.length === 0) return null;
  const shown = contests.slice(0, CONTESTS_RAIL_CAP);

  return (
    <section className="row feedpicks">
      <div className="feedpicks__head">
        <h2 className="row-title">Contests</h2>
        <Link href="/contests" className="feedpicks__all">
          All contests →
        </Link>
      </div>
      <div className="railcontest__list">
        {shown.map((c) => (
          <ContestRailRow key={c.id} contest={c} />
        ))}
      </div>
    </section>
  );
}

export function OpenGamesBand({
  token,
  follows,
  events,
}: {
  token: string;
  // Already in context on the feed (FollowsProvider loads it once per token), so
  // sorting by it costs nothing extra. See the sort note below.
  follows: FollowMineEntry[];
  // The feed's already-loaded events, indexed by id to tell covered from feed
  // games -- /predictions/open-games carries no source, and this join is the
  // same free lookup YourPicksBand uses. A game absent from the list (outside
  // the feed's window) is treated as covered: no "Scores" tag rather than a
  // wrong one.
  events: EventListItem[];
}) {
  const [games, setGames] = useState<OpenPickGame[] | null>(null);

  const feedIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (isFeedEvent(e.source)) set.add(e.id);
    return set;
  }, [events]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await getOpenPickGames(token);
        if (!cancelled) setGames(rows);
      } catch {
        // Best-effort, same as the bands above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // The names of the teams this fan follows. NAMES, not ids, because
  // /predictions/open-games returns team names and no team ids at all — so this
  // is the only join available without a second read per game, which is exactly
  // what the "cheap sort or skip it" rule rules out.
  //
  // The cost of that: two different teams sharing a name ("Lincoln Lions") sort
  // a game the fan doesn't follow to the front. That is a stable, harmless
  // wrong-order in a 12-card strip — nobody is misinformed, a card is just early
  // — and it's the honest trade for not fetching. If the strip ever needs to be
  // RIGHT rather than roughly right, the fix is team ids on the endpoint, not a
  // fan-out of reads from here.
  const followedNames = useMemo(() => {
    const set = new Set<string>();
    for (const f of follows) {
      if (f.targetType === 'team') set.add(f.name.toLowerCase());
    }
    return set;
  }, [follows]);

  const sorted = useMemo(() => {
    const rows = games ?? [];
    if (followedNames.size === 0) return rows;
    const followed = (g: OpenPickGame) =>
      (g.homeTeamName && followedNames.has(g.homeTeamName.toLowerCase())) ||
      (g.awayTeamName && followedNames.has(g.awayTeamName.toLowerCase()));
    // A STABLE partition, not a comparator sort: the backend already ordered
    // these (live first, then soonest) and that order is worth keeping inside
    // each group. Re-sorting with a boolean comparator would preserve it too,
    // but this says what it means.
    return [...rows.filter(followed), ...rows.filter((g) => !followed(g))];
  }, [games, followedNames]);

  if (sorted.length === 0) return null;

  return (
    <section className="row feedpicks">
      <div className="feedpicks__head">
        <h2 className="row-title">Make your picks</h2>
        <span className="natboard__sub">Games with questions open now</span>
      </div>
      <div className="row-track feedpicks__track">
        {sorted.map((g) => (
          <OpenGameCard key={g.eventId} game={g} isFeed={feedIds.has(g.eventId)} />
        ))}
      </div>
    </section>
  );
}
