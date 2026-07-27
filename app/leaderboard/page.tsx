'use client';

// /leaderboard — the points board. POINTS ONLY: a closed-loop score, no cash
// value, never redeemable. Open to every authenticated role (see roles.ts).
//
// SCOPE: global is the page's home state. The event-scoped board is a TAB rather
// than a deferral — it costs one query param, the backend already serves it, and
// it's the version that actually matters courtside ("who's winning tonight?").
// It only appears when the page is reached WITH an ?eventId (the Predictions
// section on a game page links in that way), because a standalone "pick a game"
// selector would be a second browse surface that /games already is. Arriving
// with an eventId defaults to that game's board; without one, global is all
// there is.
//
// The two boards deliberately measure DIFFERENT things, which is why they can't
// be one list: global ranks lifetime_earned (everything EARNED, never
// subtracts), event ranks net points on that game (payout − stake, so it can go
// negative).
//
// "EARNED", NOT "WON" — and the difference is the whole reason the global
// board's standfirst reads the way it does. lifetime_earned is raised by every
// positive ledger earn, which includes the engagement verbs (daily_checkin,
// national_pick, article_read, ...) alongside real winnings. A fan's first 35
// points can be a check-in plus making one pick, no game won. This board is a
// legitimate "who's biggest on the platform" ranking; it is NOT a skill
// ranking, and no copy on this page may imply that it is. See the long note
// above globalLeaderboard() in the API's predictions.service.ts for why the
// board can't currently be split.
//
// The EVENT board is different and its copy is correct as-is: it reads
// prediction_picks directly (payout − stake on one game) and genuinely is net
// winnings.

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { FanCard } from '../fan-card';
import { canAccess } from '../roles';
import {
  getPointsLeaderboard,
  points,
  signedPoints,
  LeaderboardEntry,
  PointsLeaderboard,
} from '../api';

// Medal treatment for the podium; everyone else gets a plain number.
function rankBadge(rank: number | null): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return rank === null ? '—' : `${rank}`;
}

function Row({
  entry,
  scope,
  me,
  pinned,
  onOpen,
}: {
  entry: LeaderboardEntry;
  scope: 'global' | 'event';
  // Highlight the caller's own row wherever it lands in the top 20.
  me: boolean;
  // This is the pinned copy below the cut, not a row of the board itself.
  pinned?: boolean;
  // Opens this fan's card. Every row on both boards gets one, including the
  // pinned "you" row -- your own card is the same card.
  onOpen: () => void;
}) {
  return (
    <li
      className={`points-lb__row${me ? ' points-lb__row--me' : ''}${
        pinned ? ' points-lb__row--pinned' : ''
      }`}
    >
      <span className="points-lb__rank">{rankBadge(entry.rank)}</span>
      {/* The name is the affordance: a button, not the whole row, so the score
          stays selectable and the click target is the thing that reads like a
          person. Styled to look like the text it replaced -- see .fancard-open. */}
      <span className="points-lb__name">
        <button
          type="button"
          className="fancard-open"
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {entry.displayName ?? 'You'}
        </button>
        {me && <span className="points-lb__you">You</span>}
      </span>
      {/* An event board is net points and can be negative, so it's signed; the
          global board is lifetime EARNED (winnings + engagement — see the file
          header) and only ever climbs. */}
      <span className="points-lb__score">
        {scope === 'event' ? signedPoints(entry.score) : points(entry.score)}
        <span className="points-lb__unit">pts</span>
      </span>
      {entry.pending !== undefined && entry.pending > 0 && (
        <span className="points-lb__pending">
          {entry.pending === 1 ? '1 live' : `${entry.pending} live`}
        </span>
      )}
    </li>
  );
}

function Leaderboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const eventId = params.get('eventId');
  // Arriving from a game page means that game's board is the one you came for.
  const [scope, setScope] = useState<'global' | 'event'>(
    eventId ? 'event' : 'global',
  );
  const [board, setBoard] = useState<PointsLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The fan whose card is open, held as the entry rather than just an id so the
  // card can title itself from the row instantly instead of waiting on a fetch.
  // Mounting the card IS opening it (SlideOver's contract), so null = closed.
  const [openFan, setOpenFan] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    // Guard against a scope=event read with no id (the backend 400s on it).
    const effective = scope === 'event' && eventId ? 'event' : 'global';
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getPointsLeaderboard(
          token,
          effective,
          effective === 'event' ? eventId ?? undefined : undefined,
        );
        if (!cancelled) setBoard(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load leaderboard',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed, scope, eventId]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  // The caller's row is returned alongside the top 20 by the backend. Pin it
  // below the board ONLY when they didn't make the cut — a fan outside the top
  // should still see exactly where they stand instead of guessing.
  const inTop = board?.top.some((t) => t.userId === board.me.userId) ?? false;
  const showPinned = board !== null && !inTop;

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
          <h1 className="masthead-title">Leaderboard</h1>
          {/* Reads the LOADED board's scope, not the tab intent: the two
              boards measure different things, so this line must describe the
              numbers actually on screen — including mid-switch, when the tab
              has moved but the fetch hasn't landed. */}
          <p className="masthead-standfirst">
            {(board?.scope ?? scope) === 'event'
              ? 'Net points won on this game. Still-live picks count as staked until they settle.'
              : 'Total points earned — from games, contests and everyday activity. It only ever climbs; a loss never drags you down.'}
          </p>
        </div>
        <div className="masthead-actions">
          <Link href="/picks" className="link-btn">
            My picks →
          </Link>
        </div>
      </div>

      {/* The scope tabs only exist when there's a game in context to scope TO. */}
      {eventId && (
        <div className="points-tabs">
          <button
            type="button"
            className={`points-tab${scope === 'event' ? ' points-tab--on' : ''}`}
            onClick={() => setScope('event')}
          >
            This game
          </button>
          <button
            type="button"
            className={`points-tab${scope === 'global' ? ' points-tab--on' : ''}`}
            onClick={() => setScope('global')}
          >
            Global
          </button>
          <Link href={`/games/${eventId}`} className="points-tabs__back">
            Back to the game →
          </Link>
        </div>
      )}

      {loading && <div className="card muted">Loading leaderboard…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && board && (
        <section className="points-lb">
          {board.top.length > 0 ? (
            <>
              <ul className="points-lb__list">
                {board.top.map((entry) => (
                  <Row
                    key={entry.userId}
                    entry={entry}
                    scope={board.scope}
                    me={entry.userId === board.me.userId}
                    onOpen={() => setOpenFan(entry)}
                  />
                ))}
              </ul>
              {showPinned && (
                <div className="points-lb__pin">
                  <span className="points-lb__pin-label">Your rank</span>
                  <ul className="points-lb__list">
                    <Row
                      entry={board.me}
                      scope={board.scope}
                      me
                      pinned
                      onOpen={() => setOpenFan(board.me)}
                    />
                  </ul>
                  {board.me.rank === null && (
                    <p className="muted points-lb__hint">
                      {board.scope === 'event'
                        ? "You haven't picked on this game yet."
                        : "You haven't earned any points yet — make a pick or check in daily to get on the board."}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="results-empty">
              <p className="results-empty__title">Nobody on the board yet</p>
              <p className="results-empty__hint">
                {board.scope === 'event'
                  ? 'No picks have been made on this game yet. Be the first.'
                  : 'No points have been won yet. Open a live game and call it.'}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Mounting is opening (SlideOver's contract). Keyed by fan so clicking a
          second name while one card is open remounts rather than leaving the
          previous fan's numbers under a new title. */}
      {openFan && (
        <FanCard
          key={openFan.userId}
          userId={openFan.userId}
          fallbackName={openFan.displayName}
          isMe={openFan.userId === board?.me.userId}
          onClose={() => setOpenFan(null)}
        />
      )}
    </main>
  );
}

// useSearchParams must render inside a Suspense boundary (Next.js App Router).
export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <main className="feed-home">
          <div className="card muted">Loading leaderboard…</div>
        </main>
      }
    >
      <Leaderboard />
    </Suspense>
  );
}
