'use client';

// ============================================================================
// /arena/trail — THE FOXX TRAIL. A season-long road trip: one town a day, one
// game, and a pennant for every town you take.
//
// FOUR READS, FOUR INDEPENDENCES, same discipline as the Oracle page. `today`
// gates the screen because it IS the game; the map, the pennant book and the
// boards are context and each fails alone — a fan whose leaderboard call 500s
// still gets their town, their buttons and their route.
//
// POLLING: 30s, and ONLY while the day is open and unlocked. The split is the
// only thing moving then. A locked day changes when it grades, minutes to hours
// later, and a graded day never changes at all — both stop the timer.
//
// THE MAP RE-READS AFTER A PICK, and only then. A pennant is minted by GRADING,
// not by picking, so the route cannot change under a fan mid-session — but the
// pick DOES move the fan's Scenic Route counter and (on the seventh day) their
// freezes, and the map read carries the progress block those live in. One
// refresh at the one moment it can matter, rather than a poll that would re-pull
// 120 towns every 30 seconds to find nothing new.
//
// NO EARN TOAST, for the same reason the Oracle fires none: Trail points are
// paid by grading, in a transaction this client never observes. The one
// exception is the SCENIC ROUTE CHEST, which is paid inside the pick's own
// transaction and comes back on the pick response — the town card announces it
// there, because that response is the only place it will ever appear.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { useAgeGate } from '../../age-gate';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { TownCard } from './town-card';
import { TrailMap } from './trail-map';
import {
  entryRefusal,
  getTrailLeaderboard,
  getTrailMap,
  getTrailPennants,
  getTrailToday,
  submitTrailPick,
  trailItemMeta,
  trailTrophyMeta,
  CoveringThisGameError,
  TrailItem,
  TrailLeaderboards,
  TrailMap as TrailMapData,
  TrailPennants,
  TrailPickResult,
  TrailSide,
  TrailToday,
} from '../../api';

// The split moves while the crowd picks; nothing else on the card does. Same
// 30s the Oracle and the contest boards use.
const LIVE_POLL_MS = 30_000;

// The freeze cap, mirroring MAX_FREEZES in arena-streak.service.ts. Only used to
// draw the empty ❄️ slots — the earned count always comes from the server.
const MAX_FREEZES = 2;

// ---------------------------------------------------------------------------
// THE TRAIL'S STREAK RAIL — the same two streaks the Oracle keeps, plus the one
// thing that is the Trail's alone: the SCENIC ROUTE, seven played days in one ET
// week for a chest.
//
// The scenic counter is drawn as a week of pips rather than "5/7", because the
// ask is "come back twice more" and seven boxes say that where a fraction makes
// the fan do the subtraction.
// ---------------------------------------------------------------------------
function TrailRail({ today }: { today: TrailToday }) {
  const { streaks } = today;
  const scenic = today.scenicRoute;
  const capped = streaks.freezes >= MAX_FREEZES;

  return (
    <section className="trail-rail" aria-label="Your streaks">
      <div className="trail-rail__streaks">
        <div className="trail-stat">
          <span className="trail-stat__icon" aria-hidden="true">
            🔥
          </span>
          <span className="trail-stat__value">{streaks.playStreak}</span>
          <span className="trail-stat__label">Play streak</span>
        </div>
        <div className="trail-stat">
          <span className="trail-stat__icon" aria-hidden="true">
            🏁
          </span>
          <span className="trail-stat__value">{streaks.winStreak}</span>
          <span className="trail-stat__label">Town run</span>
        </div>
        <div className="trail-stat">
          <span className="trail-stat__icon" aria-hidden="true">
            ⭐
          </span>
          <span className="trail-stat__value">{streaks.bestWinStreak}</span>
          <span className="trail-stat__label">Best ever</span>
        </div>
      </div>

      <div className="trail-freezes">
        <div
          className="trail-freezes__tokens"
          role="img"
          aria-label={`${streaks.freezes} of ${MAX_FREEZES} freezes banked`}
        >
          {Array.from({ length: MAX_FREEZES }, (_, i) => (
            <span
              key={i}
              className={`trail-freeze${
                i < streaks.freezes ? ' trail-freeze--on' : ''
              }`}
              aria-hidden="true"
            >
              ❄️
            </span>
          ))}
          <span className="trail-freezes__count">
            {streaks.freezes}/{MAX_FREEZES}
          </span>
        </div>
        {capped && (
          <p className="trail-freezes__hint">
            Freezes full — a missed day is already covered.
          </p>
        )}
      </div>

      {/* THE SCENIC ROUTE. Self-hides between seasons (there is no week to
          count against), which is the same null the progress block carries. */}
      {scenic && (
        <div className="trail-scenic">
          <div className="trail-scenic__head">
            <span className="trail-scenic__title">
              <span aria-hidden="true">🧳</span> Scenic Route
            </span>
            <span className="trail-scenic__hint">
              {scenic.earnedThisWeek
                ? 'Chest opened this week'
                : scenic.daysToChest === 1
                  ? '1 more day this week'
                  : `${scenic.daysToChest} more days this week`}
            </span>
          </div>
          <div
            className="trail-scenic__pips"
            role="img"
            aria-label={`${scenic.daysPlayed} of 7 days played this week`}
          >
            {Array.from({ length: 7 }, (_, i) => (
              <span
                key={i}
                className={`trail-pip${i < scenic.daysPlayed ? ' trail-pip--on' : ''}`}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE PENNANT BOOK — the scrapbook, and the reason a fan stays through a losing
// week. Every card is rendered from the SNAPSHOT captured at earn time, not from
// a live town row, which is exactly why the snapshot exists: a season the
// platform later archives must still read correctly in three years.
//
// Trophies sit above the pennants, and there are usually none — a leg trophy is
// a whole region of towns. The section self-hides when the fan holds neither,
// replaced by an invitation that names the first leg they'll be driving.
//
// THE PENNANT COUNT, SOURCE #2 OF THREE: this book's own `totals`, off
// GET /arena/trail/pennants. Non-negotiable here, for a reason the other two
// surfaces don't have — the number is a CAPTION ON THE LIST BENEATH IT. It must
// be counted from the same rows it is describing, or a fan reads "12 pennants"
// above eleven cards. /me/items totals would be the same lifetime figure from a
// second request and could still disagree under a slow render;
// trail_progress.pennant_count is per-season and would disagree by design.
// ---------------------------------------------------------------------------
function PennantBook({
  book,
  firstRegion,
}: {
  book: TrailPennants;
  firstRegion: string | null;
}) {
  if (book.totals.pennants === 0 && book.totals.trophies === 0) {
    return (
      <section className="trail-book">
        <h2 className="trail-section__title">Pennant book</h2>
        <div className="results-empty">
          <p className="results-empty__title">The book is empty — for now</p>
          <p className="results-empty__hint">
            {firstRegion
              ? `Your first pennant awaits in ${firstRegion}.`
              : 'Call a town right and its pennant is yours forever.'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="trail-book">
      <div className="trail-section__head">
        <h2 className="trail-section__title">Pennant book</h2>
        <span className="trail-book__count">
          {book.totals.pennants} pennant{book.totals.pennants === 1 ? '' : 's'}
          {book.totals.trophies > 0 && ` · ${book.totals.trophies} 🏆`}
        </span>
      </div>

      {book.trophies.length > 0 && (
        <ul className="trail-trophies">
          {book.trophies.map((t: TrailItem) => {
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

      <ul className="trail-pennants">
        {book.pennants.map((p: TrailItem) => {
          const meta = trailItemMeta(p);
          return (
            <li key={`${p.type}:${p.key}`} className="trail-pennant">
              <span className="trail-pennant__flag" aria-hidden="true">
                🏁
              </span>
              <span className="trail-pennant__town">{meta.title}</span>
              {meta.region && (
                <span className="trail-pennant__region">{meta.region}</span>
              )}
              {meta.date && (
                <span className="trail-pennant__date">{shortDate(meta.date)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE BOARDS — pennants this week, and season position.
//
// TABS, not two stacked lists, for the same reason the Oracle's are: they rank
// the same fans by two incomparable measures, and stacking invites the reading
// that one is the real board. Weekly is what keeps a late joiner competitive —
// they cannot catch a 40-town position, but they can absolutely win this week.
//
// Row furniture is /leaderboard's, on purpose. A board is a board.
// ---------------------------------------------------------------------------
function Boards({
  boards,
  meId,
}: {
  boards: TrailLeaderboards;
  meId: string | undefined;
}) {
  const [tab, setTab] = useState<'weekly' | 'season'>('weekly');
  // `seasonBoard` is OPTIONAL, not merely nullable: the backend's no-season
  // branch omits the key entirely (it returns `season_board: null`). Read
  // through ?? rather than asserted — see the api.ts Trail header.
  const weekly = boards.weekly;
  const season = boards.seasonBoard ?? null;
  const board = tab === 'weekly' ? weekly : season;
  // Widened to an array of the UNION rather than a union of two arrays: the
  // latter has no callable .map (TS can't pick one signature). The rows differ
  // only in their score field, which `in` narrows per row below — same shape
  // the Oracle's boards use.
  const items: Array<
    NonNullable<TrailLeaderboards['weekly']>['items'][number]
    | NonNullable<NonNullable<TrailLeaderboards['seasonBoard']>>['items'][number]
  > = board ? board.items : [];

  return (
    <section className="trail-boards">
      <div className="trail-section__head">
        <h2 className="trail-section__title">Boards</h2>
        {board && <span className="trail-boards__window">{board.window}</span>}
      </div>

      <div className="points-tabs">
        <button
          type="button"
          className={`points-tab${tab === 'weekly' ? ' points-tab--on' : ''}`}
          onClick={() => setTab('weekly')}
        >
          🏁 Pennants this week
        </button>
        <button
          type="button"
          className={`points-tab${tab === 'season' ? ' points-tab--on' : ''}`}
          onClick={() => setTab('season')}
        >
          Season position
        </button>
      </div>

      {items.length === 0 ? (
        <div className="results-empty">
          <p className="results-empty__title">
            {tab === 'weekly'
              ? 'Nobody on the board yet this week'
              : 'Nobody has left the depot yet'}
          </p>
          <p className="results-empty__hint">
            {tab === 'weekly'
              ? 'The week resets Monday. Take a town today and the board is yours.'
              : 'Every pennant moves you one town down the road.'}
          </p>
        </div>
      ) : (
        <ul className="points-lb__list">
          {items.map((entry) => (
            <li
              key={entry.userId}
              className={`points-lb__row${
                entry.userId === meId ? ' points-lb__row--me' : ''
              }`}
            >
              <span className="points-lb__rank">{rankBadge(entry.rank)}</span>
              <span className="points-lb__name">
                {entry.displayName}
                {entry.userId === meId && (
                  <span className="points-lb__you">You</span>
                )}
              </span>
              <span className="points-lb__score">
                {'position' in entry ? entry.position : entry.pennants}
                <span className="points-lb__unit">
                  {'position' in entry ? 'towns' : 'pennants'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function rankBadge(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}`;
}

// "Jul 25" — the compact collection date. Local noon, same reason as everywhere
// else on this surface.
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
export default function TrailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { runGated } = useAgeGate();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [today, setToday] = useState<TrailToday | null>(null);
  const [map, setMap] = useState<TrailMapData | null>(null);
  const [book, setBook] = useState<TrailPennants | null>(null);
  const [boards, setBoards] = useState<TrailLeaderboards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [picking, setPicking] = useState<TrailSide | null>(null);
  const [justPicked, setJustPicked] = useState<TrailPickResult | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    if (!token) return;
    setToday(await getTrailToday(token));
  }, [token]);

  const loadMap = useCallback(async () => {
    if (!token) return;
    setMap(await getTrailMap(token));
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const next = await getTrailToday(token);
        if (!cancelled) {
          setToday(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to find the bus');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // The three context reads. Best-effort: each section self-hides on failure.
    getTrailMap(token)
      .then((m) => {
        if (!cancelled) setMap(m);
      })
      .catch(() => {});
    getTrailPennants(token)
      .then((b) => {
        if (!cancelled) setBook(b);
      })
      .catch(() => {});
    getTrailLeaderboard(token)
      .then((b) => {
        if (!cancelled) setBoards(b);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  // The live poll. ONLY while today's game is open and unlocked.
  const day = today?.day ?? null;
  const live =
    day !== null && day.status === 'open' && !day.restStop && !day.locked;
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => {
      void loadToday().catch(() => {
        // A failed poll leaves what's on screen; the next tick tries again, and
        // the 401 path inside the client tears the session down.
      });
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, loadToday]);

  async function onPick(side: TrailSide) {
    if (!token || picking) return;
    setPicking(side);
    setPickError(null);
    try {
      // Through the 18+ gate — see age-gate.tsx. An un-attested fan is prompted
      // and, on affirming, this same call is retried so the tap completes.
      const result = await runGated(() => submitTrailPick(token, side));
      setJustPicked(result);
      // Fold the call into the card WITHOUT a round trip: the fan's own side is
      // the one part of the day we now know authoritatively, and the split is
      // one greater on that side by definition. The poll reconciles the rest.
      setToday((prev) =>
        prev && prev.day
          ? {
              ...prev,
              streaks: result.streaks,
              scenicRoute: prev.scenicRoute
                ? {
                    ...prev.scenicRoute,
                    daysPlayed: result.scenicRoute.daysPlayed,
                    daysToChest: result.scenicRoute.daysToChest,
                    earnedThisWeek:
                      prev.scenicRoute.earnedThisWeek ||
                      result.scenicRoute.chest !== null,
                  }
                : prev.scenicRoute,
              day: {
                ...prev.day,
                myPick: { side, outcome: 'pending', pointsAwarded: null },
                split: {
                  home: prev.day.split.home + (side === 'home' ? 1 : 0),
                  away: prev.day.split.away + (side === 'away' ? 1 : 0),
                  total: prev.day.split.total + 1,
                },
              },
            }
          : prev,
      );
      // The map's progress block moved (the weekly counter, and possibly a
      // freeze). One refresh, at the one moment it can matter — see the header.
      void loadMap().catch(() => {});
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not record your call';
      setPickError(message);
      // A COVERING refusal is not a stale screen and gets NO re-read — see the
      // Call page. Guarded on the TYPE, never on the sentence.
      if (err instanceof CoveringThisGameError) return;
      // A 409/404 means the screen is STALE, not that the fan did something
      // wrong: they already called it in another tab, or first pitch passed
      // between the render and the tap. Re-read so the card catches up rather
      // than leaving two live buttons over a locked game.
      if (message.startsWith('409') || message.startsWith('404')) {
        void loadToday().catch(() => {});
      }
    } finally {
      setPicking(null);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  // The invitation copy on an empty pennant book names the leg the fan is
  // actually about to drive, which needs the map — so it degrades to null and
  // the book falls back to a generic line rather than naming a wrong region.
  const firstRegion = map?.regions[0]?.region ?? null;

  return (
    <main className="feed-home trail-page">
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

      <div className="page-head">
        <div>
          <h1 className="row-title page-head__title">The Foxx Trail</h1>
        </div>
        <div className="masthead-actions">
          <Link href="/arena" className="link-btn">
            ← The Arena
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Finding the bus…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && today && (
        <>
          <TownCard
            season={today.season}
            day={today.day}
            progress={today.progress}
            date={today.date}
            justPicked={justPicked}
            onPick={onPick}
            picking={picking}
            pickError={pickError}
            covering={entryRefusal(today.entry, 'GET /arena/trail/today')}
          />

          <TrailRail today={today} />

          {map && (
            <TrailMap
              towns={map.towns}
              regions={map.regions}
              currentTownId={today.day?.town.id ?? null}
              seasonTrophyHeld={map.seasonTrophyHeld ?? false}
            />
          )}

          {book && <PennantBook book={book} firstRegion={firstRegion} />}

          {boards && <Boards boards={boards} meId={user?.id} />}

          <p className="trail-fineprint">
            Points only · no cash value · never redeemable. Trail payouts land
            when the game grades, not when you call it.
          </p>
        </>
      )}
    </main>
  );
}
