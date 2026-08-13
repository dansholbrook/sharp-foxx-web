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
import { usePoints } from '../points-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  BingoGameCard,
  CallGameCard,
  ClashGameCard,
  OracleGameCard,
  ScoutGameCard,
  TrailGameCard,
} from './game-cards';
import { StreakChip, anyStreakActive } from '../arena-streaks';
import {
  getBingoToday,
  getCallCurrent,
  getClashTug,
  getOracleToday,
  getScoutBook,
  getTrailToday,
  oracleBadgeMeta,
  BingoToday,
  CallCurrent,
  ClashTug,
  OracleBadge,
  OracleToday,
  ScoutBook,
  TrailToday,
} from '../api';

// ---------------------------------------------------------------------------
// THE SHARED STRIP — every game's streak, the freezes, the medallions, one row.
//
// The chip itself lives in ../arena-streaks, because /profile renders the same
// row: two surfaces, one component, so the freeze cap and the "hide a game the
// fan has never touched" rule can only ever be wrong in one place.
// ---------------------------------------------------------------------------
function ArenaStrip({
  oracle,
  trail,
  badges,
}: {
  oracle: OracleToday | null;
  trail: TrailToday | null;
  badges: OracleBadge[];
}) {
  // THE PENNANT COUNT, SOURCE #3 OF THREE: trail_progress.pennant_count, off the
  // Trail's today read. It is the odd one out of the three — a DENORMALIZED
  // counter (the other two count the item rows themselves) and, more importantly
  // here, a PER-SEASON one: trail_progress is keyed (user_id, season_id), so a
  // fan who collected forty pennants last season and none this one reads 0.
  //
  // CHOSEN ANYWAY, because this strip sits on the "play today" hub directly
  // above the Trail tile's season progress bar, and every other number in that
  // column is this season's. A lifetime count here would be the one figure on
  // the page not describing the trip the fan is on. It costs nothing extra: the
  // today read is already loaded for the streak chips.
  //
  // THE COPY CARRIES THE SCOPE. Without "this season" the medallion reads as the
  // lifetime shelf — which is /profile's, off GET /me/items — and a fan who sees
  // 3 here, 40 there and 40 in the book has no way to tell which is wrong.
  const pennants = trail?.progress?.pennants ?? 0;

  // Is there anything true to say? A brand-new fan gets the invitation instead
  // of a row of empties — same self-hiding discipline as the feed's bands.
  const anyStreak = anyStreakActive([oracle?.streaks, trail?.streaks]);
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
                  title={`${pennants} pennant${
                    pennants === 1 ? '' : 's'
                  } this season — open the pennant book`}
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
// ---- THE MARQUEE. The fox mark at scale, the name in the masthead serif, and
// — for a first-timer only — one line that says what the whole place is for.
//
// THE STANDFIRST RETIRES ITSELF, on the same lifetimeEarned === 0 gate the feed
// masthead uses. This hub is the surface a fan opens out of habit, most days,
// forever; a permanent "Free games, daily and weekly. Real sports. Bragging
// rights forever." is the product still pitching itself to someone who plainly
// bought it months ago. A first-timer arriving at the free front door gets the
// sentence; everyone else gets straight to the games, which is what they came
// for. Hidden while lifetimeEarned is null (in flight) so it never flashes.
//
// The line itself is unchanged and still NAMES BOTH CADENCES: "Free daily
// games" was true of the two games this hub opened with and became a lie the
// week the Call shipped — it files once a week, and a standfirst that promises
// a daily habit is the first thing a fan reads and the last thing they check.
function ArenaHero() {
  const { lifetimeEarned } = usePoints();
  return (
    <header className="arena-hero">
      <div className="arena-hero__mark" aria-hidden="true">
        <span className="arena-hero__fox">🦊</span>
      </div>
      <h1 className="arena-hero__title">Sharp Foxx Arena</h1>
      {lifetimeEarned === 0 && (
        <p className="arena-hero__standfirst">
          Free games, daily and weekly. Real sports. Bragging rights forever.
        </p>
      )}
    </header>
  );
}

export default function ArenaPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [oracle, setOracle] = useState<OracleToday | null>(null);
  const [trail, setTrail] = useState<TrailToday | null>(null);
  const [call, setCall] = useState<CallCurrent | null>(null);
  const [bingo, setBingo] = useState<BingoToday | null>(null);
  const [clash, setClash] = useState<ClashTug | null>(null);
  const [scout, setScout] = useState<ScoutBook | null>(null);
  // Per-card flags, not one page-wide pair — see the header.
  const [oracleLoading, setOracleLoading] = useState(true);
  const [trailLoading, setTrailLoading] = useState(true);
  const [callLoading, setCallLoading] = useState(true);
  const [bingoLoading, setBingoLoading] = useState(true);
  const [clashLoading, setClashLoading] = useState(true);
  const [scoutLoading, setScoutLoading] = useState(true);
  const [oracleFailed, setOracleFailed] = useState(false);
  const [trailFailed, setTrailFailed] = useState(false);
  const [callFailed, setCallFailed] = useState(false);
  const [bingoFailed, setBingoFailed] = useState(false);
  const [clashFailed, setClashFailed] = useState(false);
  const [scoutFailed, setScoutFailed] = useState(false);

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

    // FOUR READS NOW, and the hub's rule is unchanged by the fourth: fired
    // together, settled independently, none gating the page. Bingo's today-read
    // also LAZY-OPENS tonight's night, exactly as the Oracle's does — which is
    // one more reason it must not be allowed to block the paint.
    getBingoToday(token)
      .then((next) => {
        if (!cancelled) setBingo(next);
      })
      .catch(() => {
        if (!cancelled) setBingoFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBingoLoading(false);
      });

    // FIVE READS NOW. Clash is the only one of them that is not a "today" —
    // it has no day and nothing to open lazily, so it is the cheapest of the
    // five and still gets the same treatment: fired with the rest, gating
    // nothing, failing alone.
    getClashTug(token)
      .then((next) => {
        if (!cancelled) setClash(next);
      })
      .catch(() => {
        if (!cancelled) setClashFailed(true);
      })
      .finally(() => {
        if (!cancelled) setClashLoading(false);
      });

    // SIX READS NOW. The Scout Book's is the fan's BOOK rather than a "today" —
    // it is the read that answers whether a season exists at all, which is what
    // decides between a live tile and a dead one. Same treatment as the other
    // five: fired together, gating nothing, failing alone.
    getScoutBook(token)
      .then((next) => {
        if (!cancelled) setScout(next);
      })
      .catch(() => {
        if (!cancelled) setScoutFailed(true);
      })
      .finally(() => {
        if (!cancelled) setScoutLoading(false);
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

      <ArenaHero />

      <ArenaStrip
        oracle={oracle}
        trail={trail}
        badges={oracle?.badges ?? []}
      />

      {/* ---- THE GAMES. ORDERED BY CADENCE, not by ship date: the two dailies
          that take a pick, then the nightly draw, then the week's Call. That is
          also the order the fineprint below names them in, so a fan reading down
          the page meets each game's rhythm twice in the same sequence. ---- */}
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
        <BingoGameCard
          today={bingo}
          loading={bingoLoading}
          failed={bingoFailed}
        />
        <CallGameCard
          current={call}
          loading={callLoading}
          failed={callFailed}
        />
        {/* LAST, AND THE ONLY TILE THAT ASKS NOTHING OF TODAY. The four above
            are things the fan can still do; Clash is a thing already being
            done for them by the four above. A column sorted by urgency puts
            it here. */}
        <ClashGameCard
          tug={clash}
          loading={clashLoading}
          failed={clashFailed}
        />
        {/* BELOW CLASH, because it is the only tile on the hub that is not
            playable today — no Scout Book season is running, so it renders
            dead and unlinked. A column sorted by urgency puts a game the fan
            cannot open beneath the one being played on their behalf. When a
            season opens it goes live in place; it does not need to move, since
            it is season-long and never the most urgent thing on the page. */}
        <ScoutGameCard
          book={scout}
          loading={scoutLoading}
          failed={scoutFailed}
        />
      </section>

      {/* The cadence is spelled out per game rather than averaged: "once a day"
          across a hub with a weekly game in it is a promise the Call cannot
          keep, and this line sits directly under the tile that breaks it.
          BINGO BROKE IT A SECOND WAY — it is nightly, and it is neither a daily
          pick nor a weekly one, so it gets its own clause rather than being
          folded into "the dailies". This line has now been wrong twice for the
          same reason; the next game gets a clause too.
          CLASH BREAKS IT A THIRD WAY, and its clause is the odd one out on
          purpose: every other clause names a RATE at which the fan does
          something, and Clash has no rate because the fan does nothing. Saying
          "the Clash once a week" would describe when it RESOLVES and imply a
          weekly action that does not exist. So its clause names the input
          instead — which is also the one sentence that explains what the game
          is to someone who has not opened it. */}
      <p className="arena-fineprint">
        Points only · no cash value · never redeemable. Arena games are free to
        play, forever — the dailies once a day, bingo every night, the Call once
        a week, and the Clash off everything you already play.
      </p>
    </main>
  );
}
