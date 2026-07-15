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
import { canAccess } from '../roles';
import { getMyPicks, points, signedPoints, MyPick, MyPicksReport } from '../api';

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
        {/* Every pick links back to the game it was made on — the question only
            means something next to the score. */}
        <Link href={`/games/${pick.eventId}`} className="points-row__question">
          {pick.question}
        </Link>
        <span className="points-row__pick">
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
