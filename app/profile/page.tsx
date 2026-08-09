'use client';

// ============================================================================
// /profile — THE FAN'S OWN PAGE. Standing, streaks, badges, activity, follows,
// in one place. POINTS ONLY: a closed-loop score with no monetary value, never
// bought and never cashed out. Nothing here formats through usd().
//
// ----------------------------------------------------------------------------
// IT IS THE OWN PAGE, AND THERE IS DELIBERATELY NO PUBLIC ONE.
//
// The public fan profile already exists and is called FanCard: a slide-over off
// any leaderboard row, showing rank, lifetime total, W-L-R, win rate and a
// start date. Its thinness is not a gap — it is enforced from the backend, which
// sends `balanceHidden: true` on /fans/:id/points-summary specifically so the
// missing wallet reads as a decision.
//
// A public /fans/[id] ROUTE COULD NOT SHOW ANYTHING THE CARD DOESN'T. That
// endpoint is the ONLY by-user-id fan read in the API. Streaks, badges,
// pennants, the ledger, picks, contests and follows are every one of them
// caller-scoped with no :userId variant, so a public page would be the same six
// facts at full width — a leaderboard row with more whitespace. Worse, it would
// reintroduce the "but only if it's you" branch around real data that FanCard
// was written to avoid, giving one privacy rule two places to be wrong.
//
// So: everything on THIS page is here because it is the caller's own. If a
// section here ever wants to be public, the question to ask first is which new
// backend read makes it possible — not how to render it twice.
//
// ----------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOESN'T DUPLICATE.
//
//   • THE PICK HISTORY stays on /picks. Two full pick lists in one product is
//     the failure mode this page is most likely to grow into; the masthead
//     links there instead.
//   • WAYS TO EARN stays on /picks, directly above Recent activity, where the
//     reading order (here's how points arrive → here's the record of them
//     arriving) is deliberate. Splitting it would break the pair.
//   • MY CONTESTS stays on /picks. It is one call now (GET /contests/mine)
//     rather than the 1 + 24 + N fan-out it used to be, so the reason is no
//     longer the bill — it is that the contest entries belong beside the pick
//     list and the ledger, which is what /picks is.
//   • THE PENNANT BOOK stays on /arena/trail. This page shows the COUNT and the
//     trophies; a fan mid-season holds dozens of pennants and the book is a
//     surface of its own.
//   • NO AVATAR, NO COVER, NO BIO, NO DISPLAY-NAME EDITING. There is no fan
//     identity to edit: the only user write in the API is POST /users (admin
//     creates), there is no PATCH /users/me, and signup takes a display name
//     once and never offers it again. An "Edit profile" button here would open
//     a form with nothing in it.
//
// ----------------------------------------------------------------------------
// FIVE READS, EACH FAILING ALONE. Only the wallet gates the page (it is the
// page's subject); the summary, the two Arena today-endpoints (streaks) and the
// inventory (the shelf) are best-effort and each section self-hides on a failed
// or empty read — same discipline as the feed's bands and /picks' own sections.
// A fan whose Trail read dies still sees their Oracle streak, and a fan whose
// inventory read dies still sees both.
//
// THE EMPTY PAGE IS THE FIRST-RUN GUIDE. A fan with no picks, no streaks and no
// badges gets four sections that each say what would fill them and where to go.
// That is a how-it-works that appears exactly when it's wanted and disappears
// permanently the moment it stops being true, which no separate explainer page
// can do.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { usePoints } from '../points-context';
import { useFollows } from '../follows-context';
import { AppNav, AccessDenied } from '../nav';
import { FanRecordLine, recordFromPicks } from '../fan-card';
import { StreakChip, anyStreakActive } from '../arena-streaks';
import { CarouselItem } from '../follow-carousel';
import { canAccess } from '../roles';
import {
  getFanPointsSummary,
  getMyItems,
  getMyPicks,
  getOracleToday,
  getPointsLedger,
  getTrailToday,
  followTargetId,
  itemMeta,
  ledgerActionLabel,
  trailTrophyMeta,
  points,
  signedPoints,
  etDateTime,
  FanPointsSummary,
  MyItems,
  MyPicksReport,
  OracleToday,
  PointEvent,
  TrailToday,
} from '../api';

// How many ledger rows per page. Twenty is a screenful; the expander appends
// rather than replacing, so the history reads as one continuous statement.
const LEDGER_PAGE = 20;

// Month + year — "Playing since March 2026". Same treatment FanCard uses, for
// the same reason: the exact day is noise on a line about longevity.
function formatSince(iso: string | null): string | null {
  return etDateTime(iso, { month: 'long', year: 'numeric' }) || null;
}

// ET date + time for a ledger row — a points move is a moment, and two earns on
// the same day want telling apart.
function formatWhen(iso: string): string {
  return etDateTime(iso) || iso;
}

// Matches the board's podium treatment, so a rank carries the same medal here
// that it wears on the row it came from.
function rankMedal(rank: number | null): string | null {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return null;
}

// ---------------------------------------------------------------------------
// STANDING — the two boards side by side, which is the thing that exists
// nowhere else in the product.
//
// /leaderboard shows one board at a time and FanCard shows whichever board the
// name was clicked from (its `board` prop exists precisely because showing the
// wrong pair is the bug). A fan sitting at #3 for winnings and #47 for earned is
// ordinary, and this is the only surface where they can see both facts at once.
//
// EACH TOTAL IS CAPTIONED BY ITS OWN RANK so the pairing can't be misread:
// lifetimeEarned belongs to globalRank, lifetimeWon to skillRank. Reading a rank
// off the wrong total is exactly the mistake the pairing prevents.
//
// NULL IS "OFF THE BOARD", NEVER ZERO. skillRank and lifetimeWon are null
// TOGETHER for a fan who has never won; that is not last place and not #0, and
// it gets its own words.
// ---------------------------------------------------------------------------
function Standing({
  balance,
  live,
  summary,
  lifetimeEarnedFallback,
}: {
  balance: number;
  live: number;
  // Null when the summary read failed or 404'd (never picked). The earned
  // total still renders from the wallet, which always has one.
  summary: FanPointsSummary | null;
  lifetimeEarnedFallback: number;
}) {
  const earned = summary?.lifetimeEarned ?? lifetimeEarnedFallback;
  const globalRank = summary?.globalRank ?? null;
  const skillRank = summary?.skillRank ?? null;
  const won = summary?.lifetimeWon ?? null;
  const earnedMedal = rankMedal(globalRank);
  const wonMedal = rankMedal(skillRank);

  return (
    <div className="points-hero">
      {/* Balance leads. It is the one number the PUBLIC card refuses to show
          (balanceHidden), which is exactly why it belongs at the top of the
          page that is nobody's but yours. */}
      <div className="points-hero__stat">
        <span className="points-hero__label">Balance</span>
        <span className="points-hero__value">
          {points(balance)}
          <span className="points-hero__unit">pts</span>
        </span>
        <span className="points-hero__caption">
          {live > 0
            ? `${live === 1 ? '1 pick' : `${live} picks`} still in play`
            : 'Yours to call games with'}
        </span>
      </div>

      <div className="points-hero__stat">
        <span className="points-hero__label">Lifetime earned</span>
        <span className="points-hero__value points-hero__value--minor">
          {points(earned)}
          <span className="points-hero__unit">pts</span>
        </span>
        <span className="points-hero__caption">
          {globalRank === null ? (
            'Not on the board yet'
          ) : (
            <>
              {earnedMedal && <span aria-hidden="true">{earnedMedal} </span>}
              Most earned · #{globalRank}
            </>
          )}
        </span>
      </div>

      <div className="points-hero__stat">
        <span className="points-hero__label">Lifetime won</span>
        {won === null ? (
          <span className="points-hero__value points-hero__value--minor">—</span>
        ) : (
          <span className="points-hero__value points-hero__value--minor">
            {points(won)}
            <span className="points-hero__unit">pts</span>
          </span>
        )}
        <span className="points-hero__caption">
          {skillRank === null ? (
            'No wins yet'
          ) : (
            <>
              {wonMedal && <span aria-hidden="true">{wonMedal} </span>}
              Most won · #{skillRank}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE ARENA — streaks and the badge shelf, the half of a fan's identity that
// isn't a number.
//
// STREAKS ARE PER GAME, NEVER SUMMED (see arena-streaks.tsx). The chip component
// is shared with the Arena hub's strip so the two can't disagree.
//
// ----------------------------------------------------------------------------
// THE SHELF IS ONE READ: GET /me/items, every item the fan owns from every game.
//
// It used to assemble the inventory from three GAME-SPECIFIC reads — Oracle
// badges off /arena/oracle/today, Trail trophies and pennants off
// /arena/trail/pennants — and it silently missed every game those two didn't
// name. CALLER OF THE WEEK was the proof: minted into user_items by the
// Correspondent's Call, carried only by /arena/call/current, which serves THIS
// week's card. Once the week turned, a fan who'd won the title could see it
// nowhere in the product. The platform notified them about an honour and then
// had no screen on which it was true.
//
// It is visible here now, and so is whatever game #4 mints, because the read is
// unfiltered rather than a list of games this file knows about.
//
// STREAKS STILL COME OFF THE TWO TODAY-READS, and correctly: a streak is a live
// counter on the fan's play, not an item they own. Only the SHELF consolidated.
//
// GROUPING IS BY WHAT AN ITEM LOOKS LIKE, not by an allowlist of types — a type
// this build has never heard of lands in the medallion row rather than being
// dropped, for the same reason an unknown key still gets copy: a fan who EARNED
// something must always see it.
// ---------------------------------------------------------------------------
function ArenaSection({
  oracle,
  trail,
  inventory,
}: {
  oracle: OracleToday | null;
  trail: TrailToday | null;
  inventory: MyItems | null;
}) {
  const items = inventory?.items ?? [];
  // UNCLASSIFIED FIRST, and held apart from everything below. `game: null` means
  // the backend could not place the key — it does NOT mean the item is a badge,
  // so it must not fall into the medallion row on a guess.
  const unclassified = items.filter((i) => i.game === null);
  const trophies = items.filter((i) => i.game !== null && i.type === 'trophy');
  // Every remaining classified item that isn't counted as a pennant. Stated as
  // an exclusion rather than as `type === 'badge'` so a future cosmetic or title
  // renders instead of vanishing.
  const medallions = items.filter(
    (i) => i.game !== null && i.type !== 'trophy' && i.type !== 'pennant',
  );
  // THE PENNANT COUNT, SOURCE #1 OF THREE: /me/items totals, counted off the
  // item rows themselves. Chosen here because this shelf is a LIFETIME brag and
  // this is the only lifetime count of the three — the pennant book's totals are
  // the same number but cost a second read for items this page doesn't render,
  // and trail_progress.pennant_count is PER SEASON, so a fan holding last
  // season's pennants would see their shelf undercount them. Absent key = none.
  const pennants = inventory?.totals.pennant ?? 0;
  const anyStreak = anyStreakActive([oracle?.streaks, trail?.streaks]);
  const anything =
    anyStreak ||
    medallions.length > 0 ||
    trophies.length > 0 ||
    unclassified.length > 0 ||
    pennants > 0;

  return (
    <section className="points-history profile-arena">
      <div className="feedpicks__head">
        <h2 className="game-articles__head">The Arena</h2>
        <Link href="/arena" className="feedpicks__all">
          Play today →
        </Link>
      </div>

      {!anything ? (
        // The first-run guide, in the only form that retires itself.
        <div className="results-empty">
          <p className="results-empty__title">Nothing collected yet</p>
          <p className="results-empty__hint">
            The Arena is free, every day: call the Oracle&apos;s game, take a
            town on the Foxx Trail, file a card for the week&apos;s Call. Streaks
            and badges start on your first play.
          </p>
        </div>
      ) : (
        <>
          {anyStreak && (
            <div className="arena-strip__row profile-streaks">
              {oracle && (
                <StreakChip game="Oracle" icon="🔮" streaks={oracle.streaks} />
              )}
              {trail && (
                <StreakChip game="Trail" icon="🚌" streaks={trail.streaks} />
              )}
            </div>
          )}

          {/* Trophies first — a leg or season trophy is rarer than any badge,
              and there are usually none, so the block self-hides. Rendered from
              the earn-time SNAPSHOT (trailTrophyMeta), which is the same copy
              the pennant book uses and the reason an archived season still
              reads correctly here. */}
          {trophies.length > 0 && (
            <ul className="trail-trophies profile-trophies">
              {trophies.map((t) => {
                const meta = trailTrophyMeta(t);
                return (
                  <li key={`${t.type}:${t.key}`} className="trail-trophy">
                    <span className="trail-trophy__icon" aria-hidden="true">
                      {meta.icon}
                    </span>
                    <span className="trail-trophy__text">
                      <span className="trail-trophy__title">{meta.title}</span>
                      {meta.sub && (
                        <span className="trail-trophy__sub">{meta.sub}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {(medallions.length > 0 || pennants > 0) && (
            <div className="arena-strip__row profile-medallions">
              {/* The pennant count rides as ONE medallion linking to the book,
                  not as N flags: a fan mid-season holds dozens, and the book is
                  already a surface of its own on /arena/trail. */}
              {pennants > 0 && (
                <Link
                  href="/arena/trail"
                  className="arena-medallion"
                  title={`${pennants} pennant${
                    pennants === 1 ? '' : 's'
                  } collected — open the pennant book`}
                >
                  <span className="arena-medallion__icon" aria-hidden="true">
                    🏁
                  </span>
                  <span className="arena-medallion__name">
                    {pennants} pennant{pennants === 1 ? '' : 's'}
                  </span>
                </Link>
              )}
              {/* Every game's badges in one row, Caller of the Week included.
                  Keyed on type:key because the key alone is only unique WITHIN a
                  namespace. */}
              {medallions.map((b) => {
                const meta = itemMeta(b);
                return (
                  <span
                    key={`${b.type}:${b.key}`}
                    className="arena-medallion"
                    title={meta.hint}
                  >
                    <span className="arena-medallion__icon" aria-hidden="true">
                      {meta.icon}
                    </span>
                    <span className="arena-medallion__name">{meta.name}</span>
                  </span>
                );
              })}
            </div>
          )}

          {/* UNCLASSIFIED — its own row, never merged into the one above.
              These are items the backend could not place: a key shape shipped
              without its mapping in gameForItem(). Showing them apart is the
              whole point — the fan keeps what they earned, and the orphan is
              visible to anyone looking at the screen instead of being silently
              filed under a plausible game. If this row ever renders, the fix is
              a case in arena-items.service.ts's gameForItem. */}
          {unclassified.length > 0 && (
            <>
              <div className="arena-strip__row profile-medallions">
                {unclassified.map((b) => {
                  const meta = itemMeta(b);
                  return (
                    <span
                      key={`${b.type}:${b.key}`}
                      className="arena-medallion"
                      title={meta.hint}
                    >
                      <span className="arena-medallion__icon" aria-hidden="true">
                        {meta.icon}
                      </span>
                      <span className="arena-medallion__name">{meta.name}</span>
                    </span>
                  );
                })}
              </div>
              <p className="muted profile-note">
                {unclassified.length === 1 ? 'This one is' : 'These are'} yours —
                this version of the app just doesn&apos;t have a name for{' '}
                {unclassified.length === 1 ? 'it' : 'them'} yet.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ACTIVITY — the immutable points ledger, paged.
//
// /picks shows the last ten as a garnish beside the pick list. THIS is the
// history: every earn, spend, payout and refund the fan has, oldest reachable by
// asking for more. point_events is written by every game — predictions and
// parlays included — so this is a complete account of the economy touching one
// fan.
//
// IT IS STILL NOT THE PICK HISTORY, which is why the header links to /picks
// rather than absorbing it. This is the MONEY (what moved, which way, when);
// the pick list is the CALLS (the question, the side taken, what's still live).
// ---------------------------------------------------------------------------
function ActivitySection({ token }: { token: string }) {
  const [events, setEvents] = useState<PointEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      const page = await getPointsLedger(token, { limit: LEDGER_PAGE, offset });
      return page;
    },
    [token],
  );

  useEffect(() => {
    let cancelled = false;
    load(0)
      .then((page) => {
        if (cancelled) return;
        setEvents(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        // Best-effort: an empty list renders the same invitation a failed read
        // would have nothing better to say than.
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onMore() {
    if (!events) return;
    setLoadingMore(true);
    try {
      const page = await load(events.length);
      setEvents((prev) => [...(prev ?? []), ...page.items]);
      setTotal(page.total);
    } catch {
      // Leave what's on screen; the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  }

  if (events === null) return null;

  return (
    <section className="points-history">
      <div className="feedpicks__head">
        <h2 className="game-articles__head">Activity</h2>
        <Link href="/picks" className="feedpicks__all">
          Pick history →
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="results-empty">
          <p className="results-empty__title">No activity yet</p>
          <p className="results-empty__hint">
            Every point you earn or spend lands here — check-ins, picks, contest
            entries, Arena wins, payouts and refunds. Making a pick is the
            quickest way to start; the calls themselves are on{' '}
            <Link href="/picks">My picks</Link>.
          </p>
        </div>
      ) : (
        <>
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
                  <span className="ledger-row__when">
                    {formatWhen(e.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {events.length < total && (
            <button
              type="button"
              className="show-all"
              onClick={onMore}
              disabled={loadingMore}
            >
              {loadingMore
                ? 'Loading…'
                : `Show more (${total - events.length} older)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// FOLLOWING — who this fan follows, off the membership the whole app already
// shares (follows-context). No fetch of its own; the carousel tile is the same
// component the feed renders.
// ---------------------------------------------------------------------------
function FollowingSection() {
  const { mine, loaded } = useFollows();
  if (!loaded) return null;

  return (
    <section className="points-history">
      <div className="feedpicks__head">
        <h2 className="game-articles__head">Following</h2>
        <Link href="/discover" className="feedpicks__all">
          Find teams →
        </Link>
      </div>

      {mine.length === 0 ? (
        <div className="results-empty">
          <p className="results-empty__title">Not following anyone yet</p>
          <p className="results-empty__hint">
            Follow a team or an athlete and their games and stories come to your
            feed. Start on <Link href="/discover">Discover</Link>.
          </p>
        </div>
      ) : (
        <div className="row-track follow-carousel">
          {mine.map((e) => (
            <CarouselItem key={`${e.targetType}:${followTargetId(e)}`} entry={e} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
export default function ProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { applyBalance } = usePoints();
  const allowed = canAccess(user?.roles ?? [], pathname);

  // The wallet gates the page — it is the page's subject.
  const [report, setReport] = useState<MyPicksReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Everything else is best-effort and self-hiding.
  const [summary, setSummary] = useState<FanPointsSummary | null>(null);
  const [oracle, setOracle] = useState<OracleToday | null>(null);
  const [trail, setTrail] = useState<TrailToday | null>(null);
  const [inventory, setInventory] = useState<MyItems | null>(null);

  const userId = user?.id;

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    getMyPicks(token)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        // The freshest wallet there is — push it at the shared context so the ⚡
        // chip can't disagree with the hero directly beneath it.
        applyBalance(data.balance);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load profile');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, router, allowed, applyBalance]);

  // The standing read. Resolves to null on a 404, which means this fan has never
  // picked — a state the page renders (ranks read "not on the board yet"), not
  // an error.
  useEffect(() => {
    if (!token || !allowed || !userId) return;
    let cancelled = false;
    getFanPointsSummary(token, userId)
      .then((data) => {
        if (!cancelled && data) setSummary(data);
      })
      .catch(() => {
        /* best-effort: the wallet's own totals still render the block */
      });
    return () => {
      cancelled = true;
    };
  }, [token, allowed, userId]);

  // The Arena's reads, fired together and settled independently: a dead Trail
  // must not cost the fan their Oracle streak, and vice versa.
  //
  // THE TWO TODAY-READS ARE HERE FOR THE STREAKS ONLY. The shelf they used to
  // feed is now one call — GET /me/items — which is why the pennant book read
  // that used to sit alongside them is gone: this page never rendered a pennant
  // CARD, only the count and the trophies, and both come off the inventory now.
  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    getOracleToday(token)
      .then((next) => {
        if (!cancelled) setOracle(next);
      })
      .catch(() => {
        /* best-effort */
      });
    getTrailToday(token)
      .then((next) => {
        if (!cancelled) setTrail(next);
      })
      .catch(() => {
        /* best-effort */
      });
    getMyItems(token)
      .then((next) => {
        if (!cancelled) setInventory(next);
      })
      .catch(() => {
        /* best-effort: the shelf falls back to the streaks it can still show */
      });
    return () => {
      cancelled = true;
    };
  }, [token, allowed]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const live = report?.picks.filter((p) => p.outcome === 'pending').length ?? 0;
  // The record, preferring the server's counts and falling back to the picks
  // already in hand. Both count the SAME server-derived `outcome` field, so the
  // two derivations agree by construction rather than by coincidence.
  const record = summary
    ? { ...summary.record, winRate: summary.winRate }
    : report
      ? recordFromPicks(report.picks)
      : null;
  const since = formatSince(summary?.firstPickAt ?? null);

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
          <span className="masthead-kicker">Your profile</span>
          {/* The display name IS the identity — there is nothing else to show
              and nothing to edit (no PATCH /users/me exists). It falls back to
              the id rather than rendering an empty heading. */}
          <h1 className="masthead-title">{user?.displayName ?? 'Your profile'}</h1>
          <p className="masthead-standfirst">
            {since
              ? `Playing since ${since}. `
              : ''}
            Everything you&apos;ve earned, won and collected. Points only — a
            score with no cash value, never bought and never cashed out.
          </p>
          {/* Your own W-L-R, the same line everyone else sees on your fan card.
              Only once something has resolved: 0-0-0 at a "—" win rate says
              "nothing yet" worse than saying nothing. */}
          {record && record.totalResolved > 0 && (
            <FanRecordLine record={record} />
          )}
        </div>
        <div className="masthead-actions">
          <Link href="/picks" className="link-btn">
            My picks →
          </Link>
          <Link href="/leaderboard" className="link-btn">
            Leaderboard →
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Loading your profile…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && report && (
        <>
          <Standing
            balance={report.balance}
            live={live}
            summary={summary}
            lifetimeEarnedFallback={report.lifetimeEarned}
          />

          {/* The record's own caveat, stated once and where the numbers are.
              KNOWN GAP (backend P6): FanPointsSummary.record counts PREDICTIONS
              ONLY, so on a fan whose points came from the Arena, contests or
              parlays this line can look thin beside a large "lifetime won". */}
          {record && record.totalResolved > 0 && (
            <p className="muted profile-note">
              Won-lost-refunded counts your predictions. Arena calls, contests
              and parlays pay into your totals above but aren&apos;t scored here
              yet.
            </p>
          )}

          <ArenaSection oracle={oracle} trail={trail} inventory={inventory} />
          <ActivitySection token={token} />
          <FollowingSection />
        </>
      )}
    </main>
  );
}
