'use client';

import { Children, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { useFollows } from '../follows-context';
import { usePoints } from '../points-context';
import { FollowButton } from '../follow-button';
import { ArenaTeaser } from '../arena-teaser';
import { FollowDisc, followHref } from '../follow-carousel';
import {
  InPlayBand,
} from '../feed-picks';
import { CorrespondentBand } from '../feed-work';
import {
  getPublishedContent,
  getEvents,
  getFollowFeed,
  getFollowSuggestions,
  followTargetId,
  followTargetName,
  isCoveredEvent,
  isUpcomingEvent,
  points,
  etDateTime,
  teamDisplay,
  FeedItem,
  EventListItem,
  FollowMineEntry,
  FollowSuggestion,
  FollowFeedEntry,
} from '../api';

// Format the timestamptz string the API returns, in ET; fall back to the raw
// value if it somehow doesn't parse. Date-only for compact thumbnail metadata.
function formatDate(iso: string): string {
  return etDateTime(iso, { dateStyle: 'medium' }) || iso;
}

// The shared pulsing LIVE badge (dot + wordmark) — same scoped .live-badge
// treatment used on the game page, search cards, and the rail.
function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={`live-badge${className ? ` ${className}` : ''}`}>
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Sport -> thumbnail gradient class. The card itself is the artwork (there are
// no real images), so each sport gets its own branded, gold-anchored gradient.
// Unknown/missing sports fall back to the neutral 'other' treatment.
const SPORTS = new Set([
  'basketball',
  'football',
  'baseball',
  'hockey',
  'soccer',
  'other',
]);
function thumbClass(sport: string | null): string {
  const key = sport && SPORTS.has(sport) ? sport : 'other';
  return `thumb thumb--${key}`;
}

// The special "all sports" sentinel for the sport filter chips (mirrors /search).
const ALL = 'all';

// SearchBar MOVED TO site-header.tsx, unchanged. It lived inside this page's
// `.header-row`, and when the header became a layout-level component the field
// had to travel with the bar it sits in. Still rendered on /feed only.

// How many cards a feed row shows before the Show-all expander. Two grid rows
// at 1280 and 1440 (three columns each), one and a half at 1728.
const ROW_CAP = 6;

// ---- A row: title + a GRID OF CARDS THAT FILLS THE WIDTH.
//
// IT WAS A FIXED-WIDTH HORIZONTAL SCROLLER, and at the widths people actually
// use that was the wrong component. `.tcard` was `flex: 0 0 280px` (380px on the
// live row) inside an overflow-x track, so the row laid out to a whole number of
// fixed cards and left the remainder as dead space -- measured against the real
// column: 2 cards and 280px of air at 1280, and the LIVE row showed two cards
// with up to 247px of air all the way to 1512, because 380px is simply too wide
// for a 72fr column. Widening the page moved that remainder around; it could not
// remove it.
//
// `repeat(auto-fill, minmax(260px, 1fr))` fills exactly at every width instead:
// 3 x 274px at 1280 (where the scroller managed two), 3 x 312px at 1440, 3 x
// 330px at 1512, 4 x 282px at 1728. The card is now RESPONSIVE rather than
// fixed, which is also why the 380px live-row special case is gone -- a row that
// needs to read bigger gets it from the column count, not from a hardcoded
// width that stops fitting.
//
// THE PRECEDENT IS ALREADY IN THIS FILE'S STYLESHEET: /games has laid its
// results out with `repeat(auto-fill, minmax(240px, 1fr))` and a
// `.results-grid .tcard { flex: initial; width: auto }` reset since it shipped.
// This is that, at the feed's slightly wider minimum.
//
// A GRID WRAPS WHERE A SCROLLER OVERFLOWED, so the vertical direction now needs
// the bound the horizontal one used to provide for free -- hence ROW_CAP and the
// expander, the shape FOLLOW_FEED_CAP already uses below. /games stays uncapped:
// browsing every game is that page's whole job.
//
// The optional className still lets a row flag itself; it no longer carries a
// size. ----
function Row({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // toArray rather than a count prop, so every existing call site is unchanged
  // and a row rendering a single `.row-empty` notice counts as one item and
  // never trips the expander.
  const items = Children.toArray(children);
  const shown = expanded ? items : items.slice(0, ROW_CAP);
  return (
    <section className={`row${className ? ` ${className}` : ''}`}>
      <h2 className="row-title">{title}</h2>
      <div className="row-grid">{shown}</div>
      {items.length > ROW_CAP && (
        <button
          type="button"
          className="show-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all (${items.length})`}
        </button>
      )}
    </section>
  );
}

// ---- Game thumbnail card: the gradient block IS the visual. Matchup front and
// center, venue + date beneath. When a result is in, the score replaces the
// "vs" and a FINAL badge shows; when a replay link is set, a watch indicator
// appears. The whole card links to the game's watch page at /games/[id]. ----
function GameCard({ event }: { event: EventListItem }) {
  // The stored names carry the sport (and often a gender) as a suffix, which the
  // corner tag already says -- see teamDisplay in api.ts. Display only: the raw
  // event.homeTeam is untouched and is still what OpenGamesBand sorts on.
  const h = teamDisplay(event.homeTeam);
  const a = teamDisplay(event.awayTeam);
  const home = h.name || 'TBD';
  const away = a.name || 'TBD';
  // Both sides of a fixture share a gender, so it belongs on the event's tag
  // rather than on each team -- one pill, no second absolutely-positioned tag.
  const genderTag = h.gender ?? a.gender;
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';
  const hasVideo = Boolean(event.videoUrl);

  return (
    <article className="tcard">
      <Link
        className="tcard-open"
        href={`/games/${event.id}`}
        aria-label={`View ${home} vs ${away}`}
      >
        <div className={thumbClass(event.sport)}>
          <span className="thumb-tag">
            {event.sport ?? 'event'}
            {genderTag ? ` · ${genderTag}` : ''}
          </span>
          {isLive ? (
            <LiveBadge className="thumb-live" />
          ) : (
            isFinal && <span className="thumb-final">Final</span>
          )}
          {hasVideo && (
            <span className="thumb-watch">
              <span className="thumb-watch__icon" aria-hidden="true">
                ▶
              </span>
              Watch
            </span>
          )}
          <div className="thumb-matchup">
            <span className="thumb-team">{home}</span>
            {hasScore ? (
              <span className="thumb-score">
                {event.homeScore} – {event.awayScore}
              </span>
            ) : (
              <span className="thumb-vs">vs</span>
            )}
            <span className="thumb-team">{away}</span>
          </div>
        </div>
        <div className="tcard-body">
          <div className="tcard-meta">
            {event.venue && (
              <span className="tcard-meta__seg">{event.venue}</span>
            )}
            <span className="tcard-meta__seg">
              {formatDate(event.scheduledAt)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

// ---- Article thumbnail card: branded block with the title; author/sport/date
// beneath. The whole card links to the article's own page at /articles/[id]. ----
function ArticleThumb({ item }: { item: FeedItem }) {
  const meta = [item.author, item.eventSport, formatDate(item.publishedAt)].filter(
    Boolean,
  );

  return (
    <article className="tcard">
      <Link
        className="tcard-open"
        href={`/articles/${item.id}`}
        aria-label={`Read article: ${item.title}`}
      >
        <div className={`${thumbClass(item.eventSport)} thumb--article`}>
          <span className="thumb-tag">{item.eventSport ?? 'Feature'}</span>
          <h3 className="thumb-headline">{item.title}</h3>
        </div>
        <div className="tcard-body">
          <div className="tcard-meta">
            {meta.map((seg, i) => (
              <span key={i} className="tcard-meta__seg">
                {seg}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </article>
  );
}

function SuggestionCard({ s }: { s: FollowSuggestion }) {
  const name = followTargetName(s);
  const href = followHref(s);
  return (
    <article className="follow-sugcard">
      <FollowDisc entry={s} size="lg" />
      {href ? (
        <Link href={href} className="follow-sugcard__name">
          {name}
        </Link>
      ) : (
        <span className="follow-sugcard__name">{name}</span>
      )}
      <span className="follow-sugcard__reason">{s.reason}</span>
      <FollowButton entry={s} showCount={false} size="sm" />
    </article>
  );
}

// A game from your follows: matchup, a live/final/score pill, and a "via …"
// source tag. Links to the game watch page.
function FollowGameCard({ entry }: { entry: Extract<FollowFeedEntry, { kind: 'game' }> }) {
  const hasScore = entry.homeScore !== null && entry.awayScore !== null;
  const isLive = entry.status === 'live';
  const isFinal = entry.status === 'final';
  // THE ENTRY STAYS; ONLY THE CLAIM GOES. "From your follows" is a mixed
  // activity track -- finals belong in it -- so this is NOT an upcoming set and
  // the fan-facing filter would be the wrong tool. The bug here was narrower and
  // it was a LIE: every non-live, non-final game got an "Upcoming" pill, so a
  // followed team's game that tipped off three weeks ago and never had a result
  // filed sat in the feed labelled as still to come.
  //
  // So a game we cannot honestly describe gets NO pill rather than a wrong one.
  // The card still carries the matchup, the date and the "via ..." source, which
  // is everything the fan needs; inventing a fourth state ("Result pending")
  // would be putting our housekeeping on a fan surface. See THE RULE in api.ts.
  const isUpcoming = isUpcomingEvent(entry);
  return (
    <Link href={`/games/${entry.id}`} className="ffeed-card">
      <div className="ffeed-card__top">
        {isLive ? (
          <LiveBadge />
        ) : isFinal ? (
          <span className="ffeed-pill">Final</span>
        ) : isUpcoming ? (
          <span className="ffeed-pill ffeed-pill--soon">Upcoming</span>
        ) : null}
        {hasScore && (
          <span className="ffeed-card__score">
            {entry.homeScore} – {entry.awayScore}
          </span>
        )}
      </div>
      <div className="ffeed-card__matchup">{entry.matchup}</div>
      <div className="ffeed-card__meta">
        <span className="ffeed-card__src">via {entry.source.name}</span>
        <span className="ffeed-card__date">{formatDate(entry.scheduledAt)}</span>
      </div>
    </Link>
  );
}

// An article from your follows: title, date, and a "via …" source tag. Links to
// the article page.
function FollowArticleCard({
  entry,
}: {
  entry: Extract<FollowFeedEntry, { kind: 'article' }>;
}) {
  return (
    <Link href={`/articles/${entry.id}`} className="ffeed-card ffeed-card--article">
      <span className="ffeed-card__kind">Article</span>
      <div className="ffeed-card__title">{entry.title}</div>
      <div className="ffeed-card__meta">
        <span className="ffeed-card__src">via {entry.source.name}</span>
        {entry.publishedAt && (
          <span className="ffeed-card__date">{formatDate(entry.publishedAt)}</span>
        )}
      </div>
    </Link>
  );
}

// How many "From your follows" cards to show before the Show-more expander.
const FOLLOW_FEED_CAP = 8;

// THE PERSONALIZED BAND, cut down to what a fan actually comes back for.
//
// WHAT WENT, AND WHY. Two bands of avatars sat here between Upcoming Games and
// Recent Results, costing about a screen height:
//
//   FOLLOWING  -- a carousel of every account the fan follows. That is a NAV
//     concern, not a feed one: /profile already lists their follows, and a fan
//     does not manage their follow set on the way to tonight's games.
//   SUGGESTED  -- a strip of accounts to follow, shown forever. Onboarding is
//     real in week one and clutter in week fifty.
//
// SUGGESTED SURVIVES IN THE EMPTY STATE ONLY, which is where it was always
// doing its job: a fan with zero follows sees it exactly where the Following
// band would have been. It retires itself on the fan's first follow -- the
// points-hero standfirst's shape (a gate on a fact the app already knows),
// holding no state of its own and needing no "seen it" flag.
//
// "FROM YOUR FOLLOWS" STAYS, and it is NOT one of the avatar bands -- it is
// game and article CARDS from the teams a fan chose, which is the whole payoff
// of following anything. It reads from getFollowFeed, its OWN endpoint, so
// nothing above it feeds it and cutting the carousel cannot empty it.
function FollowingSection({
  mine,
  followFeed,
  suggestions,
}: {
  mine: FollowMineEntry[];
  followFeed: FollowFeedEntry[] | null;
  suggestions: FollowSuggestion[] | null;
}) {
  const [expanded, setExpanded] = useState(false);

  // Empty state -> "Suggested for you" (or nothing to show at all).
  if (mine.length === 0) {
    const sugs = suggestions ?? [];
    if (sugs.length === 0) return null;
    return (
      <section className="row follow-section">
        <h2 className="row-title">Suggested for you</h2>
        <p className="follow-sub">
          Follow athletes and teams to build your personalized feed.
        </p>
        <div className="row-track follow-sugrow">
          {sugs.map((s) => (
            <SuggestionCard
              key={`${s.targetType}:${followTargetId(s)}`}
              s={s}
            />
          ))}
        </div>
      </section>
    );
  }

  // Following state -> the content row, and nothing else.
  const feed = followFeed ?? [];
  const shown = expanded ? feed : feed.slice(0, FOLLOW_FEED_CAP);

  // Nothing from their follows yet -> no section at all, rather than a heading
  // over a void. Same rule the band already applied to its inner track.
  if (shown.length === 0) return null;

  return (
    <section className="row follow-section">
      {/* The emptiness rule moved UP to an early return: with the carousel gone
          this row is the section's only content, so "nothing to show" now means
          "no section", not "a titled box with an empty track in it". */}
      <h2 className="row-title">From your follows</h2>
      {/* The same grid as the rows above it. This band keeps its OWN cap
          (FOLLOW_FEED_CAP, 8) rather than borrowing ROW_CAP -- it is not a
          Row, and its expander already existed. */}
      <div className="row-grid">
        {shown.map((entry) =>
          entry.kind === 'game' ? (
            <FollowGameCard key={`g-${entry.id}`} entry={entry} />
          ) : (
            <FollowArticleCard key={`a-${entry.id}`} entry={entry} />
          ),
        )}
      </div>
      {feed.length > FOLLOW_FEED_CAP && (
        <button
          type="button"
          className="show-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all (${feed.length})`}
        </button>
      )}
    </section>
  );
}

// ---- Right rail: the points economy -------------------------------------
// New markup, no new data — the rail is a layout of things this page (and its
// shared contexts) already hold.

// POINTS HERO: the fan's balance, large, with the lifetime score under it and
// the two doors into the points surfaces. Balance + lifetime both come from the
// shared wallet (points-context), which loaded them together from the one
// /predictions/my-picks read it already makes.
//
// Renders for EVERY role — staff pick too — and shows the starting state
// gracefully: a fan with no wallet row reads back the untouched 1,000-point
// grant, so there's no "no points" empty state to guard. It shows nothing only
// while the wallet is still in flight (balance null), so it never flashes a
// wrong zero.
//
// THE OPENING LINE, AND WHY IT'S CONDITIONAL. A fan who signed up ninety seconds
// ago has already been shown this number three times — the ⚡ chip, this hero,
// and a "+25 ⚡" check-in toast that fired before they touched anything — and
// nothing anywhere has said what points ARE, where the 1,000 came from, or that
// they aren't money. This is the one line that answers all three, and it is
// gated on lifetimeEarned === 0, which is precisely "has never earned anything,
// so every point on screen is the grant".
//
// It survives the whole first session and then retires itself: applyBalance
// deliberately doesn't touch lifetimeEarned (no pick response carries it), so
// the check-in that fires on this very page load can't yank the explanation out
// from under the fan who is still reading it. The next login has a real earned
// total and the line is gone for good.
function PointsHero() {
  const { balance, lifetimeEarned } = usePoints();
  if (balance === null) return null;
  const untouched = lifetimeEarned === 0;
  return (
    <section className="frail-points">
      <span className="frail-points__label">Your points</span>
      <div className="frail-points__balance">
        <span className="frail-points__bolt" aria-hidden="true">
          ⚡
        </span>
        <span className="frail-points__value">{points(balance)}</span>
        <span className="frail-points__unit">pts</span>
      </div>
      {untouched ? (
        <span className="frail-points__lifetime">
          Free points to start — call a game with them. No cash value: points
          can&apos;t be bought, redeemed, or cashed out.
        </span>
      ) : (
        lifetimeEarned !== null && (
          <span className="frail-points__lifetime">
            {points(lifetimeEarned)} pts earned all-time
          </span>
        )
      )}
      <div className="frail-points__links">
        <Link href="/profile" className="frail-points__link">
          My profile →
        </Link>
        <Link href="/leaderboard" className="frail-points__link">
          Leaderboard →
        </Link>
      </div>
    </section>
  );
}

// ---- THE MASTHEAD, and why the feed of all pages needs one.
// Every other fan surface answers "what is this?" in its first forty words —
// the Arena hero, both leaderboard standfirsts, /picks, /contests. The feed was
// the only one that didn't, and it is the page a fan lands on the instant they
// finish signing up: straight from a signup form to a search box, a gold ⚡
// number and a card about an "Oracle" nobody has introduced.
//
// THIS IS THE HOW-IT-WORKS, and it is deliberately not a page. A separate
// explainer would restate standfirsts that already exist, one screen away from
// where each is useful, and would be read by the fans who need it least. What
// was actually missing is the connective sentence: that the games, the points,
// the Arena and the board are ONE thing.
//
// IT NOW RETIRES ITSELF, which is the part that was wrong. It held no state and
// never went away, so a fan 1,892 points deep was still being pitched the
// product they had plainly already bought — the pitch on every page, forever,
// is worse than no pitch. It rides the SAME GATE as the points hero's opening
// line (lifetimeEarned === 0, "has never earned anything"), for the same reason
// and with the same property: applyBalance deliberately doesn't touch
// lifetimeEarned, so the check-in that fires on this very page load can't yank
// the explanation out from under the fan still reading it. The next login has a
// real earned total and both lines are gone for good.
//
// Still not dismissible and still holding no state of its own — the wallet
// already knows the only thing a "seen it" flag would have tracked. And it
// stays hidden while lifetimeEarned is null (in flight), so a returning fan
// never sees it flash in and out. ---- */
function FeedIntro() {
  const { lifetimeEarned } = usePoints();
  if (lifetimeEarned !== 0) return null;
  return (
    <div className="feed-intro">
      {lifetimeEarned === 0 && (
        <p className="feed-intro__text">
          Sharp Foxx covers the local games the big networks skip, with a
          correspondent in the building. Follow your teams, call the games with
          free points, and play the Arena daily — one score, no cash value, and
          bragging rights on the leaderboard.
        </p>
      )}
    </div>
  );
}

export default function FeedPage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { mine, loaded: followsLoaded } = useFollows();

  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [articles, setArticles] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The personalized band's data — loaded separately from the browse rows and
  // re-fetched whenever the set of follows changes (follow/unfollow), so "From
  // your follows" and the suggestions stay in sync after a toggle.
  const [followFeed, setFollowFeed] = useState<FollowFeedEntry[] | null>(null);
  const [suggestions, setSuggestions] = useState<FollowSuggestion[] | null>(null);

  // REMOVED WITH THE TEASER: the global board state, its fetch, the open-fan
  // state and the FanCard slide-over. Nothing else on this page opened a fan
  // card, so all four went together rather than leaving a fetch feeding a
  // component nothing can reach.
  // (was: the global board, best-effort (a failure just
  // hides the teaser). Held whole so its `me.userId` can flag the caller's own
  // row and title the fan card the way /leaderboard does.
  // The fan whose card is open from a teaser row, held as the entry so the card
  // titles itself instantly. Mounting the card IS opening it — null = closed.

  // Active sport filter (ALL = show everything). Client-side over fetched data.
  const [sport, setSport] = useState<string>(ALL);

  // A stable signature of the current follows so the personalized fetch below
  // re-runs on follow/unfollow (membership changes) but not on every render.
  const followsSignature = useMemo(
    () =>
      mine
        .map((e) => `${e.targetType}:${followTargetId(e)}`)
        .sort()
        .join(','),
    [mine],
  );

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Both rows load together; if only one fails we still show the other.
        //
        // allSettled, NOT all -- AND THE DIFFERENCE IS THE WHOLE POINT OF THIS
        // BLOCK. The comment above has always said this; the code said
        // Promise.all, which rejects on the FIRST failure and throws both rows
        // away. That is not a theoretical gap: GET /content refused the athlete
        // role until 2026-08-14, so every athlete who opened the platform's main
        // surface got the error box instead of a feed -- one 403 on the
        // decorative row taking down the row that IS the page. The role list is
        // fixed, but the shape that turned a missing row into a broken page
        // outlives any one endpoint's gate, so it is fixed here too.
        //
        // Fetch every event (not just scheduled) so finished games -- the ones
        // that carry a replay videoUrl -- reach the "Recent Results" row and
        // render as clickable video cards. Filtering to scheduled here would
        // strip out every game with a video (they're all status 'final').
        const [evResult, artResult] = await Promise.allSettled([
          getEvents(token),
          getPublishedContent(token),
        ]);
        if (!cancelled) {
          if (evResult.status === 'fulfilled') setEvents(evResult.value);
          if (artResult.status === 'fulfilled') setArticles(artResult.value);
          // THE ERROR BOX IS FOR A FEED WITH NOTHING IN IT, which is the only
          // state a reader cannot tell apart from a quiet night. One row down is
          // a thinner page and says so by being thinner; both rows down is a
          // failure and has to be named. Reporting the events failure first:
          // it's the row that carries the page.
          if (evResult.status === 'rejected' && artResult.status === 'rejected') {
            const err = evResult.reason;
            setError(err instanceof Error ? err.message : 'Failed to load feed');
          }
        }
      } catch (err) {
        // allSettled does not reject, so this now catches only a genuine bug in
        // the block above rather than either row's 4xx. Kept: an unhandled
        // rejection here would leave the page stuck on its loading state.
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load feed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  // Personalized band: the follows feed + suggestions. Best-effort (a failure
  // just hides the band), and keyed on followsSignature so a follow/unfollow
  // refreshes it. followsLoaded gates the first run so we don't fetch before we
  // know whether the user follows anything.
  useEffect(() => {
    if (!token || !followsLoaded) return;
    let cancelled = false;
    (async () => {
      // SUGGESTIONS ARE FETCHED ONLY FOR A FAN WHO HAS NO FOLLOWS. They can no
      // longer be RENDERED for anyone else -- the strip is gone and the empty
      // state is the only consumer -- so asking for them was a request whose
      // response had nowhere to go. One fewer round trip on every feed load for
      // every fan past their first follow.
      const [feed, sugs] = await Promise.all([
        getFollowFeed(token).catch(() => [] as FollowFeedEntry[]),
        mine.length === 0
          ? getFollowSuggestions(token).catch(() => [] as FollowSuggestion[])
          : Promise.resolve([] as FollowSuggestion[]),
      ]);
      if (!cancelled) {
        setFollowFeed(feed);
        setSuggestions(sugs);
      }
    })();
    return () => {
      cancelled = true;
    };
    // followsSignature stands in for the identity of the follow set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, followsLoaded, followsSignature]);


  // Sports present across BOTH rows — the union drives which chips to show.
  // Games carry a non-null sport enum; articles carry a nullable eventSport.
  // Sorted for a stable chip order. Only COVERED games feed the chips: the main
  // column is a watch surface (feed games live in the rail's pick bands, not
  // here), so a sport with only feed games would otherwise show a chip that
  // filters every row to empty.
  const availableSports = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events ?? []) if (isCoveredEvent(ev.source)) set.add(ev.sport);
    for (const item of articles ?? []) {
      if (item.eventSport) set.add(item.eventSport);
    }
    return Array.from(set).sort();
  }, [events, articles]);

  // Narrow each row by the selected sport (ALL passes everything through). THE
  // RULE: the feed's main column is a WATCH surface, so every game row here is
  // covered-only (source IS NULL) -- feed games are contest material and appear
  // in the rail's "Make your picks" band, never in Live Now / Upcoming /
  // Results.
  const visibleEvents = (events ?? []).filter(
    (ev) => isCoveredEvent(ev.source) && (sport === ALL || ev.sport === sport),
  );
  // Live = in progress right now (its own row above Upcoming); Upcoming =
  // scheduled AND NOT YET KICKED OFF (excludes live so a game shows in one row,
  // not two); Results = finished games, which carry a replay videoUrl and open
  // the watch page on click.
  //
  // WHY A GAME CAN BE IN NONE OF THESE THREE ROWS. isUpcomingEvent requires the
  // kickoff to be in the future, so a game that was scheduled, tipped off, and
  // never had a result filed falls out of Upcoming without landing in Results --
  // it is not final, so there is nothing to show. That is deliberate: a stale
  // 'scheduled' row is our housekeeping (nobody filed the result), and because
  // the backend orders scheduled games soonest-first it used to sort to the TOP
  // of this carousel -- a three-week-old game leading the row of games that have
  // not happened yet. See THE RULE in api.ts; the correspondent still sees it,
  // flagged, on /my-games.
  //
  // The filter is also POSITIVE on 'scheduled' now. The old negative form
  // (`!== 'final' && !== 'live'`) let POSTPONED and CANCELED games through, so
  // this row was advertising games that had been called off.
  const liveEvents = visibleEvents.filter((ev) => ev.status === 'live');
  const upcomingEvents = visibleEvents.filter(isUpcomingEvent);
  const resultEvents = visibleEvents.filter((ev) => ev.status === 'final');
  const visibleArticles = (articles ?? []).filter(
    (item) => sport === ALL || item.eventSport === sport,
  );

  if (!token) return null;

  return (
    <main className="feed-home--bleed feed-home feed-dash">
      {/* THE CHROME AND THE SEARCH FIELD BOTH LEFT THIS FILE. They are in
          site-header.tsx now, rendered once in app/layout.tsx above every
          page's <main> -- see RESOLVER_TICKETS.md W1. The field is still shown
          on THIS ROUTE ALONE; SiteHeader keys it on `pathname === '/feed'`,
          which is the same one page it has always been on. The reasoning about
          why it rides inside the bar rather than below it moved with it. */}

      {/* THE MASTHEAD IS GONE -- kicker, display title and rule. It cost ~146px
          on a phone and ~161px on a laptop to say "Your feed / Tonight's games"
          above a page whose content already says both. What it also held was
          this page's ONLY <h1>, so the heading survives as an sr-only one: a
          document with no heading is worse than one with a heading nobody sees.
          The standfirst it used to carry is unchanged in behaviour -- it was
          already gated on lifetimeEarned === 0, so a returning fan never saw it
          and it was never part of their scroll. */}
      <h1 className="sr-only">Tonight&apos;s games</h1>
      <FeedIntro />

      {error && <div className="error">{error}</div>}

      {/* Two columns on desktop, one interleaved column on mobile. The .fmain /
          .frail wrappers are real elements at desktop (the rail is the sticky
          one) and `display: contents` below ~1024px, so every section becomes a
          direct grid item there and CSS `order` alone weaves them into the
          points-first mobile sequence — no duplicated markup. */}
      <div className="fgrid">
        {/* ---- MAIN COLUMN ---- */}
        <div className="fmain">
          {/* WORK BEFORE PLAY, and only for the people who have any. Self-hides
              for every fan and for staff with nothing owed, so the feed is
              byte-for-byte unchanged for almost everyone who opens it. It leads
              the column (and, at order:-1, the mobile weave) because the one
              thing on it with a deadline is a Call that pays nobody if it is
              missed — a correspondent should not have to scroll past tonight's
              Oracle to find out they have four hours left. */}
          <CorrespondentBand token={token} roles={user?.roles ?? []} />
          {/* HERO: the live/upcoming games are the first thing on the page. The
              sport chips ride with them since they filter the games (and the
              articles down in the tail). */}
          <section className="fmain-hero">
            {!loading && !error && availableSports.length > 0 && (
              <div
                className="filter-row"
                role="group"
                aria-label="Filter by sport"
              >
                <button
                  type="button"
                  className={`chip${sport === ALL ? ' chip--on' : ''}`}
                  aria-pressed={sport === ALL}
                  onClick={() => setSport(ALL)}
                >
                  All sports
                </button>
                {availableSports.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`chip${sport === s ? ' chip--on' : ''}`}
                    aria-pressed={sport === s}
                    onClick={() => setSport(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {loading && <div className="card muted">Loading games…</div>}

            {!loading && liveEvents.length > 0 && (
              <Row title="Live Now" className="fmain-live">
                {liveEvents.map((ev) => (
                  <GameCard key={ev.id} event={ev} />
                ))}
              </Row>
            )}

            {!loading && (
              <Row title="Upcoming Games" className="fmain-upcoming">
                {upcomingEvents.length > 0 ? (
                  upcomingEvents.map((ev) => <GameCard key={ev.id} event={ev} />)
                ) : (
                  <div className="row-empty">
                    {sport === ALL
                      ? 'No upcoming games'
                      : `No upcoming games for ${sport}`}
                  </div>
                )}
              </Row>
            )}
          </section>

          {/* FOLLOWING + FROM YOUR FOLLOWS. Renders once the shared follows
              membership has loaded; picks Following vs Suggested and hides the
              "from your follows" track when it's empty. */}
          {followsLoaded && (
            <FollowingSection
              mine={mine}
              followFeed={followFeed}
              suggestions={suggestions}
            />
          )}

          {/* TAIL: results + the article shelf. */}
          <section className="fmain-tail">
            {!loading && resultEvents.length > 0 && (
              <Row title="Recent Results">
                {resultEvents.map((ev) => (
                  <GameCard key={ev.id} event={ev} />
                ))}
              </Row>
            )}

            {!loading && (
              <Row title="Latest Articles">
                {visibleArticles.length > 0 ? (
                  visibleArticles.map((item) => (
                    <ArticleThumb key={item.id} item={item} />
                  ))
                ) : (
                  <div className="row-empty">
                    {sport === ALL
                      ? 'No published articles yet'
                      : `No articles for ${sport}`}
                  </div>
                )}
              </Row>
            )}
          </section>
        </div>

        {/* ---- RIGHT RAIL: THREE BANDS, EACH BOUNDED. -------------------
            It was seven, two of which grew without bound -- YourPicksBand
            mapped every pending pick and OpenGamesBand mapped every open game.
            On desktop `.frail` has a max-height and its own scroll, so that was
            survivable; below 1024px `.frail` is `display: contents` and those
            bands became the page, sitting between the fan and the first game
            card.

            The three that remain are the three that earn the space:
              1. THE ORACLE -- the only band that EXPIRES (at first pitch).
              2. POINTS -- their number, one value, the two doors.
              3. IN PLAY -- what they have riding, backfilled with what they
                 could do. Hard-capped at 3 with no expander.

            The leaderboard teaser is gone: it is a nav item away, and it was
            fetching a whole board to render five rows. ------------------- */}
        <aside className="frail" aria-label="Your points and what you have in play">
          <div className="frail-arena">
            <ArenaTeaser token={token} />
          </div>

          <PointsHero />

          <div className="frail-inplay">
            <InPlayBand token={token} events={events ?? []} />
          </div>
        </aside>
      </div>

    </main>
  );
}
