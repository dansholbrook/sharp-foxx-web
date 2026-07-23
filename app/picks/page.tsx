'use client';

// /picks — the fan's points identity: what they're holding, what they've won,
// and every pick they've made. POINTS ONLY: a closed-loop score with no monetary
// value, never bought and never cashed out. Nothing here formats through usd().
//
// Open to every authenticated role (staff can pick too), though only the fan
// roles carry the nav link — see roles.ts.

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { usePoints } from '../points-context';
import { AppNav, AccessDenied } from '../nav';
import { FanRecordLine, recordFromPicks } from '../fan-card';
import { canAccess } from '../roles';
import {
  getMyPicks,
  getContests,
  getContest,
  getPointsLedger,
  contestCost,
  ledgerActionLabel,
  points,
  signedPoints,
  MyPick,
  MyPicksReport,
  ContestDetail,
  ContestStatus,
  PointEvent,
} from '../api';

// Date + time — a pick is a moment in a game, so the clock matters as much as
// the day.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// The outcome pill's words. 'pending' is the live one and says so — a fan
// scanning this list wants to know what's still in play.
function outcomeLabel(pick: MyPick): string {
  switch (pick.outcome) {
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'refunded':
      return 'Refunded';
    case 'pending':
      return 'In play';
  }
}

function PickRow({ pick }: { pick: MyPick }) {
  return (
    <li className={`points-row points-row--${pick.outcome}`}>
      <div className="points-row__main">
        {/* A GAME pick links back to the game it was made on — the question only
            means something next to the score.
            A NATIONAL pick has no game to link to (eventId is null by design:
            it's tied to no event we cover), so it renders as plain text and is
            captioned by its context instead. Interpolating the null id into a
            href would have produced a live link to /games/null — TypeScript
            can't catch that, since a template literal stringifies null happily.
            The context label is what a national pick has INSTEAD of a matchup;
            without it the question would sit here with no home at all. */}
        {pick.eventId ? (
          <Link href={`/games/${pick.eventId}`} className="points-row__question">
            {pick.question}
          </Link>
        ) : (
          <span className="points-row__question">{pick.question}</span>
        )}
        <span className="points-row__pick">
          {pick.scope === 'national' && (
            <span className="points-row__ctx">{pick.context ?? 'National'}</span>
          )}
          Your pick: <strong>{pick.pickLabel}</strong>
        </span>
      </div>
      <div className="points-row__side">
        <span className={`pill predict-pill predict-pill--${pick.outcome}`}>
          {outcomeLabel(pick)}
        </span>
        {/* net is what the pick did to the balance: a refund nets 0, and a pick
            still in play reads negative because those points ARE debited now. */}
        <span
          className={`points-row__net points-row__net--${
            pick.net > 0 ? 'up' : pick.net < 0 ? 'down' : 'flat'
          }`}
        >
          {signedPoints(pick.net)}
        </span>
        <span className="points-row__when">{formatWhen(pick.pickedAt)}</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// MY CONTESTS — the fan's contest entries, with status/score/rank, linking in.
//
// There is no /contests/mine endpoint (the contests module has list + detail
// only), so "which have I entered?" is DERIVED: list a bounded page of contests
// (the backend orders open + live first, then newest) and read each one's
// detail to see if myEntry is set. That's a small detail fan-out, capped and
// best-effort — a dedicated mine endpoint would replace it. Older finals past
// the cap won't appear; the contest lobby is the full record.
// ---------------------------------------------------------------------------

const MY_CONTESTS_SCAN = 24;

function contestStatusLabel(status: ContestStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
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

function MyContestsSection({ token }: { token: string }) {
  const [entries, setEntries] = useState<ContestDetail[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await getContests(token, { limit: MY_CONTESTS_SCAN });
        // Resolve each contest's detail to find the caller's entry. Per-item
        // best-effort so one failed read doesn't blank the section.
        const details = await Promise.all(
          page.items.map((c) => getContest(token, c.id).catch(() => null)),
        );
        if (!cancelled) {
          setEntries(
            details.filter(
              (d): d is ContestDetail => d !== null && d.myEntry !== null,
            ),
          );
        }
      } catch {
        // Best-effort: the section just doesn't render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Hide entirely until loaded and only when there's something to show — same
  // rule as the feed bands: a fan who's entered nothing never sees it.
  if (!entries || entries.length === 0) return null;

  return (
    <section className="points-history">
      <h2 className="game-articles__head">My contests</h2>
      <ul className="mycontests-list">
        {entries.map((c) => {
          const entry = c.myEntry!;
          const score = Math.round(Number(entry.score));
          return (
            <li key={c.id} className="mycontests-row">
              <Link href={`/contests/${c.id}`} className="mycontests-row__main">
                <span className="mycontests-row__title">{c.title}</span>
                <span className="mycontests-row__meta">
                  <span className={`pill contest-pill--${c.status}`}>
                    {contestStatusLabel(c.status)}
                  </span>
                  <span className="mycontests-row__cost">
                    {contestCost(c.entryCost)}
                  </span>
                </span>
              </Link>
              <div className="mycontests-row__side">
                {entry.rank != null && (
                  <span className="mycontests-row__rank">#{entry.rank}</span>
                )}
                <span className="mycontests-row__score">
                  {points(score)}
                  <span className="mycontests-row__unit">pts</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// RECENT ACTIVITY — the immutable points ledger made visible. The last 10 moves
// (action, signed points, when), newest first. Contest entries, payouts,
// refunds and engagement earns all land here; predictions do NOT (that path
// doesn't write ledger rows yet — see points-ledger.service.ts), so this reads
// as "points economy activity", not a second pick history.
// ---------------------------------------------------------------------------

function RecentActivitySection({ token }: { token: string }) {
  const [events, setEvents] = useState<PointEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPointsLedger(token, { limit: 10 })
      .then((page) => {
        if (!cancelled) setEvents(page.items);
      })
      .catch(() => {
        // Best-effort — the section self-hides on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!events || events.length === 0) return null;

  return (
    <section className="points-history">
      <h2 className="game-articles__head">Recent activity</h2>
      <ul className="ledger-list">
        {events.map((e) => (
          <li key={e.id} className="ledger-row">
            <div className="ledger-row__main">
              <span className="ledger-row__action">
                {ledgerActionLabel(e.actionType)}
              </span>
              {e.note && <span className="ledger-row__note">{e.note}</span>}
            </div>
            <div className="ledger-row__side">
              <span
                className={`ledger-row__pts ledger-row__pts--${
                  e.points > 0 ? 'up' : e.points < 0 ? 'down' : 'flat'
                }`}
              >
                {signedPoints(e.points)}
              </span>
              <span className="ledger-row__when">{formatWhen(e.createdAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MyPicksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { applyBalance } = usePoints();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [report, setReport] = useState<MyPicksReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getMyPicks(token);
        if (cancelled) return;
        setReport(data);
        // This read is the freshest wallet there is — push its balance into the
        // shared context so the ⚡ chip can't disagree with the hero right
        // beneath it. (lifetimeEarned only moves on a resolve, which happens
        // courtside, so a fan can land here with a stale chip.)
        applyBalance(data.balance);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load picks');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed, applyBalance]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const live = report?.picks.filter((p) => p.outcome === 'pending').length ?? 0;

  // Your own W-L-R, so this page answers the record question the fan cards ask
  // everywhere else. Derived from the picks already loaded rather than fetched
  // from /fans/:id/points-summary: that endpoint's record is counted off the
  // same server-derived `outcome` this list carries, so a second round-trip
  // would buy identical numbers at the cost of another request and a second
  // loading state. The shared helper keeps the two derivations one derivation.
  const record = report ? recordFromPicks(report.picks) : null;

  return (
    <main className="feed-home">
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

      <div className="masthead masthead-head">
        <div>
          <span className="masthead-kicker">Points</span>
          <h1 className="masthead-title">My picks</h1>
          <p className="masthead-standfirst">
            Pick with points, climb the leaderboard. Points have no cash value —
            they can&apos;t be bought, redeemed, or cashed out.
          </p>
          {/* The same line, from the same numbers, that everyone else sees on
              your fan card. Only once something has resolved: a fan whose first
              pick is still live has a record of "nothing yet", and 0-0-0 at a
              "—" win rate says that worse than saying nothing. */}
          {record && record.totalResolved > 0 && (
            <FanRecordLine record={record} />
          )}
        </div>
        <div className="masthead-actions">
          <Link href="/leaderboard" className="link-btn">
            Leaderboard →
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Loading your picks…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && report && (
        <>
          {/* ---- The hero: balance leads, lifetime is the brag ---- */}
          <div className="points-hero">
            <div className="points-hero__stat">
              <span className="points-hero__label">Balance</span>
              <span className="points-hero__value">
                {points(report.balance)}
                <span className="points-hero__unit">pts</span>
              </span>
              {live > 0 && (
                <span className="points-hero__caption">
                  {live === 1 ? '1 pick' : `${live} picks`} still in play
                </span>
              )}
            </div>
            {/* The quieter treatment rides on the VALUE, not the stat wrapper —
                the label and caption are identical to the balance's. */}
            <div className="points-hero__stat">
              <span className="points-hero__label">Lifetime earned</span>
              <span className="points-hero__value points-hero__value--minor">
                {points(report.lifetimeEarned)}
                <span className="points-hero__unit">pts</span>
              </span>
              <span className="points-hero__caption">
                Winnings only — losses don&apos;t subtract.
              </span>
            </div>
          </div>

          {/* My contests + the points ledger. Both self-fetch and self-hide
              (nothing entered / no ledger rows -> the section doesn't render),
              so a fan who only makes predictions sees the page unchanged. */}
          <MyContestsSection token={token} />
          <RecentActivitySection token={token} />

          <section className="points-history">
            <h2 className="game-articles__head">Pick history</h2>
            {report.picks.length > 0 ? (
              <ul className="points-list">
                {report.picks.map((p) => (
                  <PickRow key={p.pickId} pick={p} />
                ))}
              </ul>
            ) : (
              <div className="results-empty">
                <p className="results-empty__title">No picks yet</p>
                <p className="results-empty__hint">
                  Open a live game and call it — every fan starts with{' '}
                  {points(report.balance)} points. Browse what&apos;s on over on{' '}
                  <Link href="/games">Games</Link>.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
