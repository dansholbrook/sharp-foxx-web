'use client';

// /contests — the contest lobby: browse open contests, then enter and
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
  squaresPerSquareLabel,
  parlayStakeRangeLabel,
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
    /* The type on the ELEMENT, so a treatment can key off it. There was no
       per-type hook at all before this -- every one of the six contest types
       rendered the identical panel with a different word at the top. */
    <Link
      href={`/contests/${contest.id}`}
      className={`contest-card contest-card--${contest.type}`}
    >
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
        {/* Squares and parlay boards are FREE to enter — the SQUARE / the TICKET
            is the buy — so their cards show that price where a pick'em shows its
            entry cost. A parlay's buy is a RANGE (the fan sets the stake). */}
        <span className="contest-card__cost">
          {contest.type === 'squares'
            ? squaresPerSquareLabel(contest.config)
            : contest.type === 'parlay_board'
            ? parlayStakeRangeLabel(contest.config)
            : contestCost(contest.entryCost)}
        </span>
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
    <main className="feed-home--bleed feed-home">
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

      {/* ---- Title and the status filter on one row. The masthead wrapper and
          its kicker are gone: the kicker said "Contests" above an h1 saying
          "Contests", and the wrapper's rule and margins were 53px of frame
          around six words.

          IT WILL WRAP TO TWO LINES BELOW ~410px, and that is the accepted
          outcome rather than a miss: title + four chips measure ~381px against
          358px of content width at 390px. Shrinking the chips or the title to
          force one line would trade legibility on the narrowest phones for a
          layout nicety, which is the wrong way round. ---- */}
      <div className="page-head">
        <h1 className="row-title page-head__title">Contests</h1>
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
      </div>

      <div className="contests-compliance">
        {/* THE SECOND SENTENCE ONLY. "Enter with points, fill your sheet, climb
            the board" is how-it-works for a fan who is already on the contests
            page and has therefore worked it out. The no-cash-value line is not
            copy — it is the legal positioning of the whole points economy, and
            this is a surface where a fan is one tap from spending. It stays,
            and it is the reason there is still a standfirst here at all.

            ---- NO CASH VALUE IS SAID IN TWO DIFFERENT PATTERNS. THIS IS
            PLACEMENT, NOT DRIFT, AND IT WAS COUNTED. ----

            1. THIS CLAUSE, in the standfirst, on the surfaces where a fan is
               about to spend or is looking at their own balance: here, /picks,
               /profile. Plus the first-run explainer on /feed, which says it
               twice — the points hero and the masthead — both gated on
               lifetimeEarned === 0, so a returning fan sees neither.

            2. `.arena-fineprint`, a different sentence ("Points only · no cash
               value · never redeemable") ending every Arena play surface: the
               hub, Oracle, Trail, the Call, bingo. That is the Arena's own
               convention for a terms line under a game, and it is not this.

            Two strays sit outside both: the "Ways to earn" menu sub-label, and
            /economy, which is staff prose describing the economy rather than a
            fan being told about it.

            Consolidating to one canonical placement was considered and
            rejected. The argument for it would have to be that the line is
            ignored THROUGH repetition, and nobody has evidence of that; the
            argument against is that each of these is a moment where a fan
            could form a wrong belief about what a point is worth, and the
            cheapest answer is having already said so on that screen. A fan
            should meet it where the money language is, not once on a page they
            last opened in March. Evidence of banner-blindness is the thing
            that would reopen this — not the count. */}
        {/* ---- IT STAYS AT THE TOP, above the grid, and that was decided
            rather than defaulted. It is the single largest band on this page at
            390px (~94px, four wrapped lines) and moving it under the grid would
            have bought all of that back. It is not worth it: this is the surface
            where a fan is one tap from spending, and compliance copy below the
            fold is compliance copy nobody reads. The cost is known and
            accepted. ---- */}
        <p className="contests-compliance__text">
          Points have no cash value — they can&apos;t be bought, redeemed, or
          cashed out.
        </p>
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
                  ? 'Nothing running right now — check back when a new contest opens.'
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
