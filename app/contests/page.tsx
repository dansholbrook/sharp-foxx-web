'use client';

// /contests — the contest lobby: browse open pick'em contests, then enter and
// play on the contest page. POINTS ONLY, the same closed loop as predictions:
// entry costs points, payouts pay points, nothing here is money.
//
// Open to every authenticated role (staff play too — see roles.ts). The list is
// server-paged like /discover: 20 a page, "Show more" appends the next offset.
// The backend orders open + live first (the playable lobby), then newest.
//
// A HONEST LIMITATION worth stating: GET /contests returns bare contest rows —
// no entrant count and no "have I entered?" flag. Those live only on the detail
// read (GET /contests/:id), so a card here shows title, type, cost, a status
// pill and a lock countdown, and the entrant count + Entered state appear once
// you open the contest. That keeps the lobby to one request instead of a
// detail fan-out per card.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getContests,
  contestTypeLabel,
  contestCost,
  Contest,
  ContestStatus,
} from '../api';

const PAGE_SIZE = 20;

// The filter chips. `null` is "All" (no status param); the rest map straight to
// the backend's status filter. Draft/locked/canceled aren't offered — a fan's
// lobby is about what's playable now and what just wrapped.
const FILTERS: Array<{ value: ContestStatus | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'live', label: 'Live' },
  { value: 'final', label: 'Final' },
];

// The status pill's words + tone. Only the statuses a fan meets get a face; the
// rest fall back to the raw status (a draft/canceled contest is a rare sight
// here but shouldn't render blank).
function statusFace(status: ContestStatus): { label: string; tone: string } {
  switch (status) {
    case 'open':
      return { label: 'Open', tone: 'open' };
    case 'live':
      return { label: 'Live', tone: 'live' };
    case 'locked':
      return { label: 'Locked', tone: 'locked' };
    case 'final':
      return { label: 'Final', tone: 'final' };
    case 'canceled':
      return { label: 'Canceled', tone: 'canceled' };
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
  }
}

// A coarse countdown to lock: "Locks in 3h", "Locks in 2d", "Locking now". Only
// rendered when the contest carries an explicit locksAt (a generated pick'em
// often doesn't — it locks off the slate's earliest kickoff, which the list
// payload can't see, so the card simply omits the countdown there rather than
// guessing). Returns null once past, so a stale open row doesn't say "in -1h".
function lockCountdown(locksAt: string | null): string | null {
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

function ContestCard({ contest }: { contest: Contest }) {
  const face = statusFace(contest.status);
  const countdown =
    contest.status === 'open' ? lockCountdown(contest.locksAt) : null;
  const payoutRanks = contest.config.payouts?.length ?? 0;

  return (
    <Link href={`/contests/${contest.id}`} className="contest-card">
      <div className="contest-card__top">
        <span className="contest-card__type">{contestTypeLabel(contest.type)}</span>
        <span className={`contest-pill contest-pill--${face.tone}`}>
          {face.tone === 'live' && (
            <span className="live-badge__dot" aria-hidden="true" />
          )}
          {face.label}
        </span>
      </div>
      <h2 className="contest-card__title">{contest.title}</h2>
      {contest.description && (
        <p className="contest-card__desc">{contest.description}</p>
      )}
      <div className="contest-card__foot">
        <span className="contest-card__cost">{contestCost(contest.entryCost)}</span>
        {payoutRanks > 0 && (
          <span className="contest-card__meta">
            {payoutRanks === 1 ? '1 payout' : `${payoutRanks} payouts`}
          </span>
        )}
        {countdown && <span className="contest-card__meta">{countdown}</span>}
      </div>
    </Link>
  );
}

export default function ContestsPage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], '/contests');

  const [filter, setFilter] = useState<ContestStatus | null>(null);
  const [contests, setContests] = useState<Contest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Overlapping requests (a filter click while a page is still in flight) — only
  // the newest may touch state. Same counter idiom as /discover.
  const reqSeq = useRef(0);

  const load = useCallback(
    async (offset: number, status: ContestStatus | null) => {
      if (!token) return;
      const seq = ++reqSeq.current;
      const current = () => seq === reqSeq.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const page = await getContests(token, {
          status: status ?? undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (!current()) return;
        setContests((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      } catch (err) {
        if (!current()) return;
        setError(err instanceof Error ? err.message : 'Failed to load contests');
      } finally {
        if (current()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    load(0, filter);
  }, [token, router, allowed, filter, load]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const showSkeleton = loading && contests.length === 0;
  const busy = loading && contests.length > 0;
  const canShowMore = contests.length < total;

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

      <header className="masthead">
        <span className="masthead-kicker">Contests</span>
        <h1 className="masthead-title">Pick&apos;em contests</h1>
        <p className="masthead-standfirst">
          Enter with points, fill your sheet, climb the board. Points have no cash
          value — they can&apos;t be bought, redeemed, or cashed out.
        </p>
      </header>

      <div className="filter-row" role="group" aria-label="Filter contests by status">
        {FILTERS.map((f) => {
          const on = filter === f.value;
          return (
            <button
              key={f.label}
              type="button"
              className={`chip${on ? ' chip--on' : ''}`}
              aria-pressed={on}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && <div className="error">{error}</div>}

      {showSkeleton && <div className="card muted">Loading contests…</div>}

      {!showSkeleton && !error && (
        <>
          {contests.length === 0 ? (
            <div className="results-empty">
              <p className="results-empty__title">No contests here yet</p>
              <p className="results-empty__hint">
                {filter === null
                  ? 'Nothing running right now — check back when a new pick’em opens.'
                  : 'Nothing matches this filter. Try “All”.'}
              </p>
            </div>
          ) : (
            <div
              className={`contest-grid${busy ? ' contest-grid--busy' : ''}`}
            >
              {contests.map((c) => (
                <ContestCard key={c.id} contest={c} />
              ))}
            </div>
          )}

          {canShowMore && (
            <button
              type="button"
              className="show-all"
              disabled={loadingMore}
              onClick={() => load(contests.length, filter)}
            >
              {loadingMore ? 'Loading…' : `Show more (${total - contests.length})`}
            </button>
          )}
        </>
      )}
    </main>
  );
}
