'use client';

// ============================================================================
// /oracle — BEAT THE ORACLE. The daily ride-or-fade ritual, and the flagship
// daily-habit surface: the whole game is one card, above the fold, on a phone.
//
// THREE READS, THREE INDEPENDENCES. today / history / leaderboard are fetched
// separately and each fails alone: a fan whose leaderboard call 500s still gets
// their card and their streak. Only the `today` read gates the page, because it
// is the game; the other two are context.
//
// POLLING: 30s, and ONLY while the day is open and unlocked. The split is the
// only thing moving then (the crowd picking), and it is the thing worth
// watching. A locked day changes when it grades — minutes to hours later — and
// a graded day never changes at all, so both stop the timer. Same cadence and
// same "only while it can move" discipline as the contest boards.
//
// NO EARN TOAST FIRES HERE, deliberately. Oracle points are paid by GRADING, in
// a transaction this client never observes — a toast at pick time would promise
// money that hasn't been decided. The ⚡ chip moves on the next wallet read; the
// pick response carries a streak, not a balance, which is exactly the honest
// shape. Nothing on this page calls applyBalance.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { useAgeGate } from '../../age-gate';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { TodayCard } from './today-card';
import {
  getOracleHistory,
  getOracleLeaderboard,
  getOracleToday,
  oracleBadgeMeta,
  points,
  submitOraclePick,
  OracleChoice,
  OracleHistory,
  OracleHistoryItem,
  OracleLeaderboards,
  OraclePickResult,
  OracleStreaks,
  OracleToday,
  OracleBadge,
} from '../../api';

// The split moves while the crowd picks; nothing else on the card does. Same
// 30s the contest boards use.
const LIVE_POLL_MS = 30_000;

// The freeze cap, mirroring MAX_FREEZES in arena-streak.service.ts. Only used to
// draw the empty ❄️ slots — the earned count always comes from the server.
const MAX_FREEZES = 2;

// ---------------------------------------------------------------------------
// THE STREAKS RAIL
//
// Two streaks, and the rail keeps them visually apart because the game does:
// play streak is SHOWING UP (forgiven by a freeze), win streak is BEING RIGHT
// (never forgiven, never touched by a void). A fan who reads them as one number
// will feel cheated the first time a loss leaves their 🔥 alone.
// ---------------------------------------------------------------------------
function StreaksRail({
  streaks,
  badges,
}: {
  streaks: OracleStreaks;
  badges: OracleBadge[];
}) {
  const capped = streaks.freezes >= MAX_FREEZES;

  return (
    <section className="oracle-rail" aria-label="Your streaks">
      <div className="oracle-rail__streaks">
        <div className="oracle-stat oracle-stat--play">
          <span className="oracle-stat__icon" aria-hidden="true">
            🔥
          </span>
          <span className="oracle-stat__value">{streaks.playStreak}</span>
          <span className="oracle-stat__label">Play streak</span>
        </div>
        <div className="oracle-stat oracle-stat--win">
          <span className="oracle-stat__icon" aria-hidden="true">
            🎯
          </span>
          <span className="oracle-stat__value">{streaks.winStreak}</span>
          <span className="oracle-stat__label">Win streak</span>
        </div>
        <div className="oracle-stat">
          <span className="oracle-stat__icon" aria-hidden="true">
            ⭐
          </span>
          <span className="oracle-stat__value">{streaks.bestWinStreak}</span>
          <span className="oracle-stat__label">Best ever</span>
        </div>
      </div>

      {/* FREEZES as tokens, not a number: "❄️ ❄️" reads as two things you HAVE,
          where "2" reads as a score. Empty slots are drawn so the cap is
          legible without a sentence explaining it. */}
      <div className="oracle-freezes">
        <div className="oracle-freezes__tokens" role="img"
          aria-label={`${streaks.freezes} of ${MAX_FREEZES} freezes banked`}>
          {Array.from({ length: MAX_FREEZES }, (_, i) => (
            <span
              key={i}
              className={`oracle-freeze${
                i < streaks.freezes ? ' oracle-freeze--on' : ''
              }`}
              aria-hidden="true"
            >
              ❄️
            </span>
          ))}
          <span className="oracle-freezes__count">
            {streaks.freezes}/{MAX_FREEZES}
          </span>
        </div>

        {/* At the cap the server still reports daysToNextFreeze honestly (it
            counts down regardless), but promising a freeze that can't land
            would be a lie — so the cap gets its own line instead. */}
        {capped ? (
          <p className="oracle-freezes__hint">
            Freezes full — a missed day is already covered.
          </p>
        ) : (
          <>
            <div
              className="oracle-freezes__progress"
              style={{
                ['--pct' as string]: `${(streaks.freezeProgress / 7) * 100}%`,
              }}
              role="img"
              aria-label={`${streaks.freezeProgress} of 7 days toward your next freeze`}
            >
              <div className="oracle-freezes__fill" />
            </div>
            <p className="oracle-freezes__hint">
              {streaks.daysToNextFreeze === 1
                ? '1 day to your next freeze'
                : `${streaks.daysToNextFreeze} days to your next freeze`}
            </p>
          </>
        )}
      </div>

      {/* Badges. Self-hides — an empty "Badges" heading over nothing is worse
          than no heading, same rule the earn menu follows. */}
      {badges.length > 0 && (
        <div className="oracle-badges">
          {badges.map((b) => {
            const meta = oracleBadgeMeta(b.key);
            return (
              <span key={b.key} className="oracle-badge" title={meta.hint}>
                <span className="oracle-badge__icon" aria-hidden="true">
                  {meta.icon}
                </span>
                <span className="oracle-badge__name">{meta.name}</span>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// HISTORY — the last 30 calls as compact rows.
//
// VOIDS ARE ROWS, not gaps. A fan who remembers picking on a night the game got
// called off needs to see it was washed, not silently missing — which is why
// the backend returns them and why '—' is a first-class glyph here.
// ---------------------------------------------------------------------------
function outcomeGlyph(outcome: OracleHistoryItem['outcome']): string {
  switch (outcome) {
    case 'win':
      return '✓';
    case 'loss':
      return '✗';
    case 'void':
      return '—';
    default:
      return '·';
  }
}

function HistoryStrip({ history }: { history: OracleHistory }) {
  if (history.items.length === 0) {
    return (
      <section className="oracle-history">
        <h2 className="oracle-section__title">Your calls</h2>
        <div className="results-empty">
          <p className="results-empty__title">No calls yet</p>
          <p className="results-empty__hint">
            Ride or fade today&apos;s Oracle and this is where it lands.
          </p>
        </div>
      </section>
    );
  }

  const { wins, losses, fadeWins, window } = history.record;

  return (
    <section className="oracle-history">
      <div className="oracle-section__head">
        <h2 className="oracle-section__title">Your calls</h2>
        {/* The record over exactly the window on screen, so the line and the
            rows can't disagree. Voids count toward neither side. */}
        <span className="oracle-history__record">
          {wins}-{losses} in your last {window}
          {fadeWins > 0 && (
            <span className="oracle-history__fades">
              {' · '}
              {fadeWins} fade {fadeWins === 1 ? 'win' : 'wins'}
            </span>
          )}
        </span>
      </div>

      <ul className="oracle-hlist">
        {history.items.map((item) => (
          <li
            key={item.pickId}
            className={`oracle-hrow oracle-hrow--${item.outcome}`}
          >
            <span className="oracle-hrow__date">{shortDate(item.date)}</span>
            <span
              className={`oracle-hrow__choice oracle-hrow__choice--${item.choice}`}
            >
              {item.choice === 'fade' ? 'F' : 'R'}
            </span>
            <span className="oracle-hrow__matchup">{item.matchup}</span>
            <span className="oracle-hrow__glyph" aria-hidden="true">
              {outcomeGlyph(item.outcome)}
            </span>
            <span className="sr-only">{item.outcome}</span>
            <span className="oracle-hrow__pts">
              {item.outcome === 'win' && item.pointsAwarded
                ? `+${points(item.pointsAwarded)}`
                : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE BOARDS — weekly points and Oracle Slayers, as tabs.
//
// TABS RATHER THAN TWO STACKED LISTS because they rank the same fans by two
// incomparable measures, and stacking invites the reading that one is the real
// board and the other a footnote. They aren't: weekly is "who is hot", slayers
// is the career status symbol.
// ---------------------------------------------------------------------------
function Boards({
  boards,
  meId,
}: {
  boards: OracleLeaderboards;
  meId: string | undefined;
}) {
  const [tab, setTab] = useState<'weekly' | 'slayers'>('weekly');
  const board = tab === 'weekly' ? boards.weekly : boards.slayers;
  // Widened to an array of the UNION rather than a union of two arrays: the
  // latter has no callable .map (TS can't pick one signature), and the rows
  // differ only in their score field, which `in` narrows per row below.
  const items: Array<
    OracleLeaderboards['weekly']['items'][number]
    | OracleLeaderboards['slayers']['items'][number]
  > = board.items;

  return (
    <section className="oracle-boards">
      <div className="oracle-section__head">
        <h2 className="oracle-section__title">Boards</h2>
        <span className="oracle-boards__window">{board.window}</span>
      </div>

      <div className="points-tabs">
        <button
          type="button"
          className={`points-tab${tab === 'weekly' ? ' points-tab--on' : ''}`}
          onClick={() => setTab('weekly')}
        >
          This week
        </button>
        <button
          type="button"
          className={`points-tab${tab === 'slayers' ? ' points-tab--on' : ''}`}
          onClick={() => setTab('slayers')}
        >
          🏆 Oracle Slayers
        </button>
      </div>

      {items.length === 0 ? (
        <div className="results-empty">
          <p className="results-empty__title">
            {tab === 'weekly'
              ? 'Nobody on the board yet this week'
              : 'No Slayers yet'}
          </p>
          <p className="results-empty__hint">
            {tab === 'weekly'
              ? 'The week resets Monday. Win today and the board is yours.'
              : 'Fade the Oracle and be right. That is the only way onto this one.'}
          </p>
        </div>
      ) : (
        // Same row furniture as /leaderboard, on purpose — a board is a board,
        // and a fan shouldn't have to relearn one.
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
                {'hasBadge' in entry && entry.hasBadge && (
                  <span className="oracle-slayer-mark" title="Oracle Slayer">
                    🏆
                  </span>
                )}
              </span>
              <span className="points-lb__score">
                {'points' in entry
                  ? points(entry.points)
                  : points(entry.fadeWins)}
                <span className="points-lb__unit">
                  {'points' in entry ? 'pts' : 'fades'}
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

// "Jul 25" — the compact history date. Parsed as local noon for the same reason
// friendlyDate is: a bare YYYY-MM-DD through `new Date` is UTC midnight, which
// renders as the day before for every ET fan.
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
export default function OraclePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { runGated } = useAgeGate();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [today, setToday] = useState<OracleToday | null>(null);
  const [history, setHistory] = useState<OracleHistory | null>(null);
  const [boards, setBoards] = useState<OracleLeaderboards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The pick in flight (drives the optimistic button state) and the response
  // that landed (drives the inline streak celebration).
  const [picking, setPicking] = useState<OracleChoice | null>(null);
  const [justPicked, setJustPicked] = useState<OraclePickResult | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    if (!token) return;
    const next = await getOracleToday(token);
    setToday(next);
  }, [token]);

  // Initial load. The card gates on `today`; the other two are best-effort and
  // simply don't render their sections on failure.
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
        const next = await getOracleToday(token);
        if (!cancelled) {
          setToday(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load the Oracle');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    getOracleHistory(token)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        /* best-effort: the section self-hides */
      });
    getOracleLeaderboard(token)
      .then((b) => {
        if (!cancelled) setBoards(b);
      })
      .catch(() => {
        /* best-effort: the section self-hides */
      });

    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  // The live poll. ONLY while the day is open and unlocked — see the header.
  const day = today?.day ?? null;
  const live = day !== null && day.status === 'open' && !day.locked;
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => {
      void loadToday().catch(() => {
        // A failed poll leaves what's on screen. The next tick tries again, and
        // the 401 path inside the client tears the session down.
      });
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, loadToday]);

  async function onPick(choice: OracleChoice) {
    if (!token || picking) return;
    setPicking(choice);
    setPickError(null);
    try {
      // Through the 18+ gate — see age-gate.tsx. An un-attested fan is prompted
      // and, on affirming, this same call is retried so the tap completes.
      const result = await runGated(() => submitOraclePick(token, choice));
      setJustPicked(result);
      // Fold the pick into the card WITHOUT a round-trip: the fan's own choice
      // is the one part of the day we now know authoritatively, and the split
      // is one greater on that side by definition. The 30s poll (or the reload
      // below) reconciles everything else.
      setToday((prev) =>
        prev && prev.day
          ? {
              ...prev,
              streaks: result.streaks,
              day: {
                ...prev.day,
                myPick: { choice, outcome: 'pending', pointsAwarded: null },
                split: {
                  ride: prev.day.split.ride + (choice === 'ride' ? 1 : 0),
                  fade: prev.day.split.fade + (choice === 'fade' ? 1 : 0),
                  total: prev.day.split.total + 1,
                },
              },
            }
          : prev,
      );
      // The history strip now has a pending row in it. Best-effort refresh so
      // the fan's own record includes today without a page reload.
      getOracleHistory(token)
        .then(setHistory)
        .catch(() => {});
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not record your call';
      setPickError(message);
      // A 409 means the screen is STALE, not that the fan did something wrong:
      // either they already picked (another tab, their phone) or kickoff passed
      // between the render and the tap. Re-read so the card catches up to the
      // truth instead of leaving two open buttons over a locked day.
      if (message.startsWith('409') || message.startsWith('404')) {
        void loadToday().catch(() => {});
      }
    } finally {
      setPicking(null);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home oracle-page">
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
          <span className="masthead-kicker">The Arena</span>
          <h1 className="masthead-title">Beat the Oracle</h1>
          <p className="masthead-standfirst">
            One call a day from the house engine. Ride with it or fade it —
            free, once per day, and the streak is the reason you come back.
          </p>
        </div>
        <div className="masthead-actions">
          <Link href="/picks" className="link-btn">
            My points →
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Consulting the Oracle…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && today && (
        <>
          <TodayCard
            day={today.day}
            date={today.date}
            justPicked={justPicked}
            onPick={onPick}
            picking={picking}
            pickError={pickError}
          />

          <StreaksRail streaks={today.streaks} badges={today.badges} />

          {history && <HistoryStrip history={history} />}

          {boards && <Boards boards={boards} meId={user?.id} />}

          <p className="oracle-fineprint">
            Points only · no cash value · never redeemable. Oracle payouts land
            when the game grades, not when you pick.
          </p>
        </>
      )}
    </main>
  );
}
