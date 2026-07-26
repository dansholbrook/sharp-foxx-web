'use client';

// ============================================================================
// /arena — THE ARENA HUB. One nav link, and inside it the fan chooses a game.
//
// WHY A HUB AND NOT MORE NAV ITEMS. The Arena is a family of free games — two
// daily, one weekly — and it is going to keep growing; a nav that grows a link
// per game would push the daily habit into a menu that no longer fits on a
// phone, and would make
// "the Arena" a category nobody can see. One door, and the games compete for
// the tap INSIDE it — which is also what makes the game cards worth building as
// live status tiles rather than as a list of names.
//
// THREE READS, IN PARALLEL, EACH FAILING ALONE. The Oracle's today-endpoint, the
// Trail's and the Call's are independent: none gates the page, each has its own
// loading and failure flags, and a card whose read died still renders its shell
// and still links through. Nothing here awaits them before painting — the whole
// point of the hub is the fan seeing, at a glance, what still wants them today,
// and a hub that blanks until the slowest call returns has thrown that away.
//
// NO POLLING. The hub is a departures board, not a game screen: the split moves
// on the game pages (which do poll), and a fan sitting on the hub is a fan about
// to leave it. One read on mount.
//
// THE STRIP IS THE CROSS-GAME IDENTITY, and it is the reason the hub is not just
// a menu — streaks live per game on the backend, so this is the only surface
// where a fan sees all of them at once. It self-hides when there is nothing true
// to say yet, rather than showing a row of zeroes to someone who has never
// played.
//
// THE CALL IS NOT IN THE STRIP, and that is not an oversight. Its endpoint
// returns `streaks: null` on purpose: ArenaStreakService counts ET calendar days,
// so a weekly game would hand it a 7-day gap every week, burn both banked
// freezes and reset a play streak the fan never broke. The Call therefore has no
// streak in v1 — no chip, and no contribution to the strip's "is there anything
// true to say" test, which a zeroed third game would silently corrupt.
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { CallGameCard, OracleGameCard, TrailGameCard } from './game-cards';
import {
  getCallCurrent,
  getOracleToday,
  getTrailToday,
  oracleBadgeMeta,
  ArenaStreaks,
  CallCurrent,
  OracleBadge,
  OracleToday,
  TrailToday,
} from '../api';

// The freeze cap, mirroring MAX_FREEZES in arena-streak.service.ts. Only used to
// draw the empty ❄️ slot — the earned count always comes from the server.
const MAX_FREEZES = 2;

// ---------------------------------------------------------------------------
// THE SHARED STRIP — every game's streak, the freezes, the medallions, one row.
//
// PER-GAME, NOT SUMMED. The backend keeps one streak row per (user, game) and a
// combined "🔥 7" would be a number that exists nowhere and that no game would
// ever agree with. Two chips that each say which game they belong to is both
// honest and better copy: "🔥 4 Oracle · 🔥 2 Trail" is a fan with two habits.
//
// FREEZES RIDE ON THEIR OWN GAME'S CHIP for the same reason — a freeze earned on
// the Trail cannot save an Oracle streak.
// ---------------------------------------------------------------------------
function StreakChip({
  game,
  icon,
  streaks,
}: {
  game: string;
  icon: string;
  streaks: ArenaStreaks;
}) {
  // "Where active" — a game the fan has never touched contributes nothing to
  // the row rather than a chip full of zeroes.
  const active =
    streaks.playStreak > 0 || streaks.winStreak > 0 || streaks.freezes > 0;
  if (!active) return null;

  return (
    <span className="arena-chip">
      <span className="arena-chip__game">
        <span aria-hidden="true">{icon}</span> {game}
      </span>
      {streaks.playStreak > 0 && (
        <span className="arena-chip__stat" title={`${game} play streak`}>
          <span aria-hidden="true">🔥</span> {streaks.playStreak}
        </span>
      )}
      {streaks.winStreak > 0 && (
        <span className="arena-chip__stat" title={`${game} win streak`}>
          <span aria-hidden="true">🎯</span> {streaks.winStreak}
        </span>
      )}
      <span
        className="arena-chip__freezes"
        title={`${streaks.freezes} of ${MAX_FREEZES} freezes banked on ${game}`}
      >
        {Array.from({ length: MAX_FREEZES }, (_, i) => (
          <span
            key={i}
            className={`arena-freeze${
              i < streaks.freezes ? ' arena-freeze--on' : ''
            }`}
            aria-hidden="true"
          >
            ❄️
          </span>
        ))}
        <span className="sr-only">
          {streaks.freezes} of {MAX_FREEZES} freezes
        </span>
      </span>
    </span>
  );
}

function ArenaStrip({
  oracle,
  trail,
  badges,
}: {
  oracle: OracleToday | null;
  trail: TrailToday | null;
  badges: OracleBadge[];
}) {
  const pennants = trail?.progress?.pennants ?? 0;

  // Is there anything true to say? A brand-new fan gets the invitation instead
  // of a row of empties — same self-hiding discipline as the feed's bands.
  const anyStreak = [oracle?.streaks, trail?.streaks].some(
    (s) => s && (s.playStreak > 0 || s.winStreak > 0 || s.freezes > 0),
  );
  const anything = anyStreak || badges.length > 0 || pennants > 0;

  return (
    <section className="arena-strip" aria-label="Your Arena">
      <span className="arena-strip__label">Your Arena</span>

      {!anything ? (
        <p className="arena-strip__empty">
          Play a game today and your streaks start here.
        </p>
      ) : (
        <div className="arena-strip__row">
          {oracle && (
            <StreakChip game="Oracle" icon="🔮" streaks={oracle.streaks} />
          )}
          {trail && <StreakChip game="Trail" icon="🚌" streaks={trail.streaks} />}

          {/* MEDALLIONS — the durable half of the identity. Oracle badges come
              down with the day card; the pennant count is the Trail's
              equivalent and rides as one medallion rather than as N flags,
              because a fan mid-season holds dozens and the strip is one row. */}
          {(badges.length > 0 || pennants > 0) && (
            <span className="arena-medallions">
              {pennants > 0 && (
                <Link
                  href="/arena/trail"
                  className="arena-medallion"
                  title={`${pennants} pennant${pennants === 1 ? '' : 's'} collected`}
                >
                  <span className="arena-medallion__icon" aria-hidden="true">
                    🏁
                  </span>
                  <span className="arena-medallion__name">{pennants}</span>
                </Link>
              )}
              {badges.map((b) => {
                const meta = oracleBadgeMeta(b.key);
                return (
                  <span key={b.key} className="arena-medallion" title={meta.hint}>
                    <span className="arena-medallion__icon" aria-hidden="true">
                      {meta.icon}
                    </span>
                    <span className="arena-medallion__name">{meta.name}</span>
                  </span>
                );
              })}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
export default function ArenaPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [oracle, setOracle] = useState<OracleToday | null>(null);
  const [trail, setTrail] = useState<TrailToday | null>(null);
  const [call, setCall] = useState<CallCurrent | null>(null);
  // Per-card flags, not one page-wide pair — see the header.
  const [oracleLoading, setOracleLoading] = useState(true);
  const [trailLoading, setTrailLoading] = useState(true);
  const [callLoading, setCallLoading] = useState(true);
  const [oracleFailed, setOracleFailed] = useState(false);
  const [trailFailed, setTrailFailed] = useState(false);
  const [callFailed, setCallFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;

    // Fired together, settled independently. Neither .catch rethrows, so one
    // dead game never takes the other card's render with it.
    getOracleToday(token)
      .then((next) => {
        if (!cancelled) setOracle(next);
      })
      .catch(() => {
        if (!cancelled) setOracleFailed(true);
      })
      .finally(() => {
        if (!cancelled) setOracleLoading(false);
      });

    getTrailToday(token)
      .then((next) => {
        if (!cancelled) setTrail(next);
      })
      .catch(() => {
        if (!cancelled) setTrailFailed(true);
      })
      .finally(() => {
        if (!cancelled) setTrailLoading(false);
      });

    getCallCurrent(token)
      .then((next) => {
        if (!cancelled) setCall(next);
      })
      .catch(() => {
        if (!cancelled) setCallFailed(true);
      })
      .finally(() => {
        if (!cancelled) setCallLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home arena-page">
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

      {/* ---- THE MARQUEE. The fox mark at scale, the name in the masthead
          serif, and one line that says what the whole place is for. ---- */}
      <header className="arena-hero">
        <div className="arena-hero__mark" aria-hidden="true">
          <span className="arena-hero__fox">🦊</span>
        </div>
        <h1 className="arena-hero__title">Sharp Foxx Arena</h1>
        {/* NAMES BOTH CADENCES. "Free daily games" was true of the two games
            this hub opened with and became a lie the week the Call shipped —
            it files once a week, and a standfirst that promises a daily habit
            is the first thing a fan reads and the last thing they check. */}
        <p className="arena-hero__standfirst">
          Free games, daily and weekly. Real sports. Bragging rights forever.
        </p>
      </header>

      <ArenaStrip
        oracle={oracle}
        trail={trail}
        badges={oracle?.badges ?? []}
      />

      {/* ---- THE GAMES. One card each — two dailies and the week's Call. ---- */}
      <section className="arena-games" aria-label="Games">
        <OracleGameCard
          today={oracle}
          loading={oracleLoading}
          failed={oracleFailed}
        />
        <TrailGameCard
          today={trail}
          loading={trailLoading}
          failed={trailFailed}
        />
        <CallGameCard
          current={call}
          loading={callLoading}
          failed={callFailed}
        />
      </section>

      {/* The cadence is spelled out per game rather than averaged: "once a day"
          across a hub with a weekly game in it is a promise the Call cannot
          keep, and this line sits directly under the tile that breaks it. */}
      <p className="arena-fineprint">
        Points only · no cash value · never redeemable. Arena games are free to
        play, forever — the dailies once a day, the Call once a week.
      </p>
    </main>
  );
}
