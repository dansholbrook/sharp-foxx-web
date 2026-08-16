'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import {
  getEvent,
  teamLabel,
  getEventContext,
  getEvents,
  getEventContent,
  getPublishedContent,
  getEventSponsorship,
  getLiveEvents,
  getGamePhotos,
  isFeedEvent,
  etDateTime,
  etTime,
  EventDetail,
  EventContext,
  TeamContext,
  EventListItem,
  EventContentItem,
  FeedItem,
  Sponsorship,
  LiveEvent,
  GamePhoto,
} from '../../api';
import { toYouTubeEmbed } from '../../video';
import { PredictionsSection } from '../../predictions';
import { useWatchLiveGameEarn } from '../../earn-hooks';

// The shared pulsing LIVE badge (dot + wordmark). Styling/animation live in the
// scoped .live-badge classes in globals.css so it reads identically here, on the
// feed/search cards, and in the rail. `className` lets callers add positioning.
function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={`live-badge${className ? ` ${className}` : ''}`}>
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Date-only ET formatting for compact card metadata (mirrors the feed page).
function formatDate(iso: string): string {
  return etDateTime(iso, { dateStyle: 'medium' }) || iso;
}

// Full ET date + time — used for "Coverage begins" and the upcoming scoreboard
// line. Labelled: this is the tip-off a fan shows up for.
function formatWhen(iso: string): string {
  return etDateTime(iso, { zone: true }) || iso;
}

// The published feed (FeedItem) carries no eventId, so to link an article back to
// its game page we match on the joined matchup + scheduled time against the
// events list. Fine at current scale; unresolved articles are simply dropped
// from the rail so every row navigates somewhere real.
function eventKey(
  home: string | null,
  away: string | null,
  scheduledAt: string | null,
): string {
  return `${home ?? ''}|${away ?? ''}|${scheduledAt ?? ''}`;
}

// ---- Video area: the branded top of the main column, always 16:9, never an
// empty player box. A replay embeds (or falls back to an external link); with no
// replay we show a countdown card (upcoming) or a final-score card. ----
function GameVideo({ event }: { event: EventListItem }) {
  const home = teamLabel(event.homeInstitution, event.homeTeam) || 'TBD';
  const away = teamLabel(event.awayInstitution, event.awayTeam) || 'TBD';
  const title = `${home} vs ${away}`;
  const isLive = event.status === 'live';
  const embed = event.videoUrl ? toYouTubeEmbed(event.videoUrl) : null;

  if (event.videoUrl) {
    return embed ? (
      // When live, the embed plays as normal with a pulsing LIVE pill pinned to
      // the player corner (a replay shows no pill).
      <div className="game-player">
        {isLive && <LiveBadge className="game-live-pill" />}
        <iframe
          src={embed}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    ) : (
      // A stray non-YouTube replay/stream link — a branded card with a real link
      // out rather than a broken frame.
      <div className="game-coverage">
        <span className="game-coverage__kicker">{isLive ? 'Live' : 'Replay'}</span>
        <span className="game-coverage__matchup">{title}</span>
        <a
          className="video-link"
          href={event.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {isLive ? 'Watch live ↗' : 'Watch video ↗'}
        </a>
      </div>
    );
  }

  // Live but no stream online yet — a branded card with the running score.
  if (isLive) {
    const hasScore = event.homeScore !== null && event.awayScore !== null;
    return (
      <div className="game-coverage">
        <LiveBadge />
        <span className="game-coverage__matchup">{title}</span>
        {hasScore && (
          <span className="game-coverage__score">
            {event.homeScore} — {event.awayScore}
          </span>
        )}
        <span className="game-coverage__detail">
          Live now — stream coming online
        </span>
        {event.venue && (
          <span className="game-coverage__detail game-coverage__detail--venue">
            {event.venue}
          </span>
        )}
      </div>
    );
  }

  if (event.status === 'final') {
    const hasScore = event.homeScore !== null && event.awayScore !== null;
    return (
      <div className="game-coverage">
        <span className="game-coverage__kicker">Final</span>
        <span className="game-coverage__matchup">{title}</span>
        {hasScore && (
          <span className="game-coverage__score">
            {event.homeScore} — {event.awayScore}
          </span>
        )}
        {event.venue && (
          <span className="game-coverage__detail">{event.venue}</span>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // CALLED OFF, AND SAID SO. Postponed and canceled used to fall through to
  // the "Upcoming" card below and print the ORIGINAL kickoff time — so eight
  // games on cloud were telling fans to turn up to something that is not
  // happening. It was the only thing on this page that was WRONG rather than
  // missing, which is why it is fixed first.
  //
  // THE TWO ARE NOT ONE STATE. Postponed means "not then" and a new date may
  // follow; canceled means "not at all". Collapsing them would tell a fan
  // whose game was moved that it is gone. Neither line invents a new date,
  // because nothing in the row holds one — a rescheduled game arrives as its
  // own event.
  // ---------------------------------------------------------------------
  if (event.status === 'postponed' || event.status === 'canceled') {
    const off = event.status === 'postponed';
    return (
      <div className="game-coverage game-coverage--off">
        <span className="game-coverage__kicker">
          {off ? 'Postponed' : 'Called off'}
        </span>
        <span className="game-coverage__matchup">{title}</span>
        <span className="game-coverage__detail">
          {off
            ? 'This game was postponed. No new date yet — it will appear as its own fixture when it is rescheduled.'
            : 'This game was called off and will not be played.'}
        </span>
        {event.venue && (
          <span className="game-coverage__detail game-coverage__detail--venue">
            {event.venue}
          </span>
        )}
      </div>
    );
  }

  // Scheduled — a countdown card.
  return (
    <div className="game-coverage">
      <span className="game-coverage__kicker">Upcoming</span>
      <span className="game-coverage__matchup">{title}</span>
      <span className="game-coverage__detail">
        Coverage begins {formatWhen(event.scheduledAt)}
      </span>
      {event.venue && (
        <span className="game-coverage__detail game-coverage__detail--venue">
          {event.venue}
        </span>
      )}
    </div>
  );
}

// A scoreboard team name: a link to the team hub when the events payload carries
// that side's team id, else plain text (an unset FK / a name-only event). The
// team pages are open to every authenticated role, same as this game page.
function ScoreboardTeam({
  name,
  teamId,
  side,
}: {
  name: string;
  teamId: string | null;
  side: 'home' | 'away';
}) {
  const cls = `game-scoreboard__team game-scoreboard__team--${side}`;
  return teamId ? (
    <Link href={`/teams/${teamId}`} className={`${cls} game-scoreboard__team--link`}>
      {name}
    </Link>
  ) : (
    <span className={cls}>{name}</span>
  );
}

// ---- Scoreboard strip: the visually dominant score line beneath the video.
// While live, liveHome/liveAway (fed by the poller) override the event's static
// scores, and scoreVersion bumps on each change to re-key the score span so the
// pulse-flash animation replays. period renders a small label under the line. ----
function Scoreboard({
  event,
  liveHome = null,
  liveAway = null,
  scoreVersion = 0,
  period = null,
}: {
  event: EventListItem;
  liveHome?: number | null;
  liveAway?: number | null;
  scoreVersion?: number;
  period?: string | null;
}) {
  const home = teamLabel(event.homeInstitution, event.homeTeam) || 'TBD';
  const away = teamLabel(event.awayInstitution, event.awayTeam) || 'TBD';
  const homeScore = liveHome ?? event.homeScore;
  const awayScore = liveAway ?? event.awayScore;
  const hasScore = homeScore !== null && awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';
  const isOff = event.status === 'postponed' || event.status === 'canceled';

  return (
    <div className="game-scoreboard">
      <ScoreboardTeam name={home} teamId={event.homeTeamId} side="home" />
      <span className="game-scoreboard__center">
        {hasScore ? (
          <span
            key={`score-${scoreVersion}`}
            className={`game-scoreboard__score${
              isLive && scoreVersion > 0 ? ' pulse-flash' : ''
            }`}
          >
            {homeScore} — {awayScore}
          </span>
        ) : (
          <span className="game-scoreboard__vs">vs</span>
        )}
        {isLive ? (
          <LiveBadge />
        ) : isFinal ? (
          <span className="pill">Final</span>
        ) : isOff ? (
          /* The same fix one component down: the fall-through branch printed a
             kickoff time for a game that is not being played. A pill, not a
             time, because there is no time to give. */
          <span className="pill pill--off">
            {event.status === 'postponed' ? 'Postponed' : 'Called off'}
          </span>
        ) : (
          <span className="game-scoreboard__when">
            {formatWhen(event.scheduledAt)}
          </span>
        )}
        {isLive && period && <span className="pulse-period">{period}</span>}
      </span>
      <ScoreboardTeam name={away} teamId={event.awayTeamId} side="away" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WHAT EACH SIDE PLAYS NEXT. Derived server-side from scheduled events.
//
// ----------------------------------------------------------------------------
// THE RECORD IS ON THE WIRE AND DELIBERATELY NOT RENDERED. DO NOT WIRE IT UP.
//
// GET /events/:id/context returns { record, next } per side and the record half
// is correct — it counts every final we hold, home and away. The problem is the
// DATA, not the query: we hold a few weeks of ESPN ingest, so a team that is
// genuinely 20-14 on the season reads "3-0 here". That number is TRUE and reads
// FALSE, which is the worst kind of number to put next to a team name.
//
// Labelling it does not save it. "3-0 all-time here" was the version that
// shipped for about an hour, and the label is the part nobody reads — a fan
// sees 3-0 beside Minnesota Lynx and files it as the Lynx's record. A
// wrong-LOOKING record is worse than no record.
//
// THE CONDITION FOR TURNING IT ON, either one:
//   * full-season ingest, so the count covers the season a fan assumes, or
//   * a `season` column on `events`, so the query can scope to one and the
//     label can name it ("12-4 this season") instead of hedging.
// Until then the field stays on the wire, unrendered, with this note. The CSS
// that styled it (.teamctx__rec / .teamctx__reclabel) was removed with it.
//
// NEXT FIXTURES ARE DIFFERENT AND THAT IS WHY THEY STAYED. A fixture is one row
// that either exists or does not; it does not depend on the dataset being
// complete, so it is right regardless of how much history we hold. An incomplete
// schedule shows fewer fixtures, never a wrong one.
// ----------------------------------------------------------------------------
//
// SELF-HIDING at every level: no context, no strip; a side with no team FK
// (a covered game entered without teams) renders nothing for that side rather
// than an empty row, which would be a claim about a team we cannot name.
// ---------------------------------------------------------------------------
function TeamContextStrip({
  event,
  context,
}: {
  event: EventDetail;
  context: EventContext;
}) {
  const sides: [string, TeamContext | null][] = [
    [teamLabel(event.awayInstitution, event.awayTeam) || 'Away', context.away],
    [teamLabel(event.homeInstitution, event.homeTeam) || 'Home', context.home],
  ];
  // Nothing to show unless at least one side has a next fixture. Was keyed on
  // the context existing at all, which was right when the strip also carried
  // records; with only fixtures left, a context with two nulls is an empty box.
  if (!context.home?.next && !context.away?.next) return null;

  return (
    <section className="teamctx">
      {/* "Up next", not "Form" — the record is gone and a heading promising
          form over a list of fixtures would be the same wrong-looking claim one
          level up. */}
      <h2 className="teamctx__title">Up next</h2>
      <ul className="teamctx__list">
        {sides.map(([name, side]) =>
          // A side with no upcoming fixture renders NOTHING rather than a name
          // with a blank beside it: the row exists to carry the fixture, and
          // without one there is nothing to say about that team here.
          side?.next ? (
            <li key={name} className="teamctx__row">
              <span className="teamctx__name">{name}</span>
              <span className="teamctx__next">
                <Link href={`/games/${side.next.id}`}>
                  {teamLabel(side.next.awayInstitution, side.next.awayTeam) || 'TBD'} at{' '}
                  {teamLabel(side.next.homeInstitution, side.next.homeTeam) || 'TBD'}
                </Link>{' '}
                <span className="teamctx__when">
                  {formatWhen(side.next.scheduledAt)}
                </span>
              </span>
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PERIOD BY PERIOD — the quarter/inning table, and the honest empty state.
//
// SHAPE: [{period, home, away}], written ONLY by the ESPN resolver. Uniform
// across sports, but the LENGTH is not: basketball and football run 4, baseball
// runs 8 or 9 (the home side does not bat in the ninth when ahead) and up to 13
// in extras. Measured on cloud 2026-08-15: 1 to 13 columns, so the table
// scrolls inside its own container rather than wrapping. A wrapped period table
// is unreadable — the columns stop lining up with their headers.
//
// THE COVERED-GAME CASE IS SAID OUT LOUD RATHER THAN LEFT BLANK.
//
//   feed games:     335 of 336 finals carry periods  (99.7%)
//   covered games:    0 of  24 finals carry periods  (0%)
//
// Period scores arrive with the provider payload, and a covered game has no
// provider — it is ours, entered by a person. So the games this platform exists
// to cover are exactly the ones with no table, and a fan looking at one would
// otherwise find a hole where the box score is on the screen that is supposed
// to prove we cover it. It says why instead. Capturing periods at the courtside
// console is a real feature and a different job; this is the note that stops
// the absence reading as a bug in the meantime.
// ---------------------------------------------------------------------------
function PeriodTable({ event }: { event: EventDetail }) {
  const periods = event.periodScores ?? [];
  const covered = event.source === null;
  const started = event.status === 'live' || event.status === 'final';

  // Nothing to say before a game starts: an empty table on a fixture three days
  // out is noise, not information.
  if (!started) return null;

  if (periods.length === 0) {
    // Only worth explaining on a game we cover. A feed game with no periods is
    // a provider gap and a fan can do nothing with that sentence.
    if (!covered) return null;
    return (
      <section className="periods">
        <h2 className="periods__title">Period by period</h2>
        <p className="periods__none">
          We cover this game ourselves, so there is no period-by-period
          breakdown — the final score is filed from the ground rather than pulled
          from a feed.
        </p>
      </section>
    );
  }

  const label = periodLabel(event.sport);
  return (
    <section className="periods">
      <h2 className="periods__title">Period by period</h2>
      {/* The scroller owns the overflow so the PAGE never scrolls sideways —
          the rule .fgrid and every other wide surface here follows. */}
      <div className="periods__scroll">
        <table className="periods__table">
          <thead>
            <tr>
              <th scope="col" className="periods__corner">
                <span className="sr-only">Team</span>
              </th>
              {periods.map((p) => (
                <th scope="col" key={p.period}>
                  {p.period}
                </th>
              ))}
              <th scope="col" className="periods__total">
                {label}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* AWAY FIRST, which is how every box score in the sport is read —
                the visiting side bats and is listed on top. */}
            <tr>
              <th scope="row">{teamLabel(event.awayInstitution, event.awayTeam) || 'Away'}</th>
              {periods.map((p) => (
                <td key={p.period}>{p.away}</td>
              ))}
              <td className="periods__total">{event.awayScore ?? '—'}</td>
            </tr>
            <tr>
              <th scope="row">{teamLabel(event.homeInstitution, event.homeTeam) || 'Home'}</th>
              {periods.map((p) => (
                <td key={p.period}>{p.home}</td>
              ))}
              <td className="periods__total">{event.homeScore ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The word for the last column. Not the period word — that is the row of
// numbers — but what the running total is called in that sport.
function periodLabel(sport: EventListItem['sport']): string {
  return sport === 'baseball' ? 'R' : 'T';
}

// ---- Presenting sponsor strip: a slim gold-bordered band beneath the
// scoreboard, stadium-naming-rights classy. Renders nothing when a game has no
// sponsor (the caller passes null through), never an empty placeholder. ----
function PresentingSponsorStrip({ sponsorship }: { sponsorship: Sponsorship }) {
  return (
    <div className="sponsor-strip">
      <span className="sponsor-strip__label">Presented by</span>
      <span className="sponsor-strip__name">{sponsorship.businessName}</span>
    </div>
  );
}

// ---- Share row: plain intent URLs (no SDKs) + clipboard copy. ----
function ShareRow({ event }: { event: EventListItem }) {
  const home = teamLabel(event.homeInstitution, event.homeTeam) || 'TBD';
  const away = teamLabel(event.awayInstitution, event.awayTeam) || 'TBD';

  // Resolve the page URL on the client only (no window during SSR).
  const [pageUrl, setPageUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  const shareText = `${home} vs ${away} — Sharp Foxx`;
  const tweetUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(
    pageUrl,
  )}&text=${encodeURIComponent(shareText)}`;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    pageUrl,
  )}`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(pageUrl || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op; the buttons still work for sharing */
    }
  }

  // When live, the metadata line leads with "LIVE from <venue>" (or just "Live"
  // if the venue is unknown); otherwise the usual sport · venue segments.
  const meta =
    event.status === 'live'
      ? [event.venue ? `Live from ${event.venue}` : 'Live', event.sport].filter(
          Boolean,
        )
      : [event.sport, event.venue].filter(Boolean);

  return (
    <div className="game-actions">
      <div className="game-share">
        <a
          className="game-share-btn"
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on X"
        >
          𝕏 <span>Post</span>
        </a>
        <a
          className="game-share-btn"
          href={fbUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on Facebook"
        >
          f <span>Share</span>
        </a>
        <button
          type="button"
          className={`game-share-btn${copied ? ' game-share-btn--copied' : ''}`}
          onClick={onCopy}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {meta.length > 0 && (
        <div className="game-metaline">
          {meta.map((seg, i) => (
            <span key={i} className="game-metaline__seg">
              {seg}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Right-rail game card: a compact matchup + score/date/venue that links to
// that game's page. ----
function RailGameCard({ event }: { event: EventListItem }) {
  const home = teamLabel(event.homeInstitution, event.homeTeam) || 'TBD';
  const away = teamLabel(event.awayInstitution, event.awayTeam) || 'TBD';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';

  return (
    <Link href={`/games/${event.id}`} className="game-railcard">
      <span className="game-railcard__matchup">
        {home} <span className="game-railcard__vs">vs</span> {away}
      </span>
      <span className="game-railcard__meta">
        {hasScore ? (
          <span className="game-railcard__score">
            {event.homeScore} – {event.awayScore}
          </span>
        ) : (
          <span>{formatDate(event.scheduledAt)}</span>
        )}
        {isLive && <LiveBadge />}
        {isFinal && <span className="pill">Final</span>}
        {event.venue && <span className="game-railcard__venue">{event.venue}</span>}
      </span>
    </Link>
  );
}

// Time-of-day only, in ET, for the courtside feed timestamps ("7:04 PM"). No
// zone label — these are stamps on things that already happened, running down a
// column, and the game header above them already establishes the clock.
function formatClock(iso: string): string {
  return etTime(iso) || iso;
}

// Human line for a courtside feed event (big_play / timeout / status_note).
function pulseFeedText(ev: LiveEvent): string {
  if (ev.type === 'timeout') return 'Timeout on the floor';
  return ev.payload.text ? String(ev.payload.text) : 'Courtside update';
}

// After a fan hits the X on a sponsor takeover, suppress any new takeovers for
// this long — an X means "not now", and a fan doesn't want the next ad a second
// later. New spots that arrive during the window are dropped, not queued.
const TAKEOVER_COOLDOWN_MS = 60_000;

// ---- The fan live pulse: full history first, then a 5s cursor poll while the
// game is live. score_update drives the scoreboard override (+ a version bump to
// flash it), period sets the label, big_play/timeout/status_note stack onto the
// courtside feed (newest first), and sponsor_spot queues a takeover (one at a
// time). The initial history seeds score/period/feed WITHOUT firing takeovers
// for old spots. Polling stops on unmount and whenever `live` goes false. ----
function useLivePulse(token: string | null, eventId: string, live: boolean) {
  const [home, setHome] = useState<number | null>(null);
  const [away, setAway] = useState<number | null>(null);
  const [scoreVersion, setScoreVersion] = useState(0);
  const [period, setPeriod] = useState<string | null>(null);
  const [feed, setFeed] = useState<LiveEvent[]>([]); // newest-first
  const [queue, setQueue] = useState<LiveEvent[]>([]); // pending sponsor spots
  const [takeover, setTakeover] = useState<LiveEvent | null>(null);
  const cursorRef = useRef<string | null>(null);
  // Epoch-ms of the last manual (X) dismissal; 0 = never. Read at apply time to
  // enforce TAKEOVER_COOLDOWN_MS. A ref, not state, so it never re-renders.
  const dismissedAtRef = useRef(0);

  // Apply an ascending batch. `isHistory` seeds state on first load without
  // queueing takeovers (we don't replay old sponsor spots as overlays).
  const apply = useCallback((batch: LiveEvent[], isHistory: boolean) => {
    if (batch.length === 0) return;
    const newFeed: LiveEvent[] = [];
    const newSpots: LiveEvent[] = [];
    for (const ev of batch) {
      switch (ev.type) {
        case 'score_update':
          if (typeof ev.payload.homeScore === 'number') setHome(ev.payload.homeScore);
          if (typeof ev.payload.awayScore === 'number') setAway(ev.payload.awayScore);
          setScoreVersion((v) => v + 1);
          break;
        case 'period':
          if (ev.payload.label) setPeriod(String(ev.payload.label));
          break;
        case 'sponsor_spot':
          if (!isHistory) newSpots.push(ev);
          break;
        case 'big_play':
        case 'timeout':
        case 'status_note':
          newFeed.push(ev);
          break;
      }
    }
    // Ascending -> reverse so newest sits at the head of the feed.
    if (newFeed.length) setFeed((f) => [...newFeed.reverse(), ...f]);
    // Collapse the whole batch to at most ONE takeover — several sponsor_spot
    // events in a single poll are the same ad, and stacking them is spam. Keep
    // the latest. Drop it entirely while a manual dismissal is still cooling
    // down. (History never reaches here: those spots aren't pushed above.)
    if (newSpots.length) {
      const withinCooldown =
        Date.now() - dismissedAtRef.current < TAKEOVER_COOLDOWN_MS;
      if (!withinCooldown) {
        const latest = newSpots[newSpots.length - 1];
        setQueue((q) => [...q, latest]);
      }
    }
    cursorRef.current = batch[batch.length - 1].createdAt;
  }, []);

  // History-then-poll. Re-runs (and tears down) when the game stops being live.
  useEffect(() => {
    if (!token || !live) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const history = await getLiveEvents(token, eventId);
        if (cancelled) return;
        apply(history, true);
      } catch {
        /* a failed history load still lets polling pick up from now */
      }
      if (cancelled) return;
      timer = setInterval(async () => {
        try {
          const batch = await getLiveEvents(
            token,
            eventId,
            cursorRef.current ?? undefined,
          );
          if (!cancelled) apply(batch, false);
        } catch {
          /* transient poll error — try again on the next tick */
        }
      }, 5000);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [token, eventId, live, apply]);

  // Promote the next queued sponsor spot when nothing is on screen.
  useEffect(() => {
    if (takeover || queue.length === 0) return;
    setTakeover(queue[0]);
    setQueue((q) => q.slice(1));
  }, [takeover, queue]);

  // Auto-hide the current takeover after ~12s. This just clears the current
  // spot; the promote effect above advances to the next queued one (if any).
  // It does NOT touch the queue or the cooldown — an unattended ad rotating on
  // is fine; only a deliberate X means "stop".
  useEffect(() => {
    if (!takeover) return;
    const t = setTimeout(() => setTakeover(null), 12000);
    return () => clearTimeout(t);
  }, [takeover]);

  // A manual X is "not now": clear what's on screen, empty the whole pending
  // queue so nothing replays, and start the cooldown so incoming spots are
  // dropped for a while.
  const dismissTakeover = useCallback(() => {
    dismissedAtRef.current = Date.now();
    setQueue([]);
    setTakeover(null);
  }, []);

  return {
    home,
    away,
    scoreVersion,
    period,
    feed,
    takeover,
    dismissTakeover,
  };
}

// ---- "Live from courtside": the stacking play-by-play feed. Newest first; each
// item gently animates in. Capped at the latest 10 with a "Show all (N)" text
// expander so a long game doesn't dominate the page. ----
const LIVE_FEED_CAP = 10;

function LiveFeed({ items }: { items: LiveEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, LIVE_FEED_CAP);
  return (
    <section className="pulse-feed">
      <div className="pulse-feed__head">
        <LiveBadge />
        <h2 className="pulse-feed__title">Live from courtside</h2>
      </div>
      <ul className="pulse-feed__list">
        {shown.map((ev) => (
          <li key={ev.id} className="pulse-feed__item">
            <span className="pulse-feed__time">{formatClock(ev.createdAt)}</span>
            <span className="pulse-feed__text">{pulseFeedText(ev)}</span>
          </li>
        ))}
      </ul>
      {items.length > LIVE_FEED_CAP && (
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

// ---- The sponsor TAKEOVER: a gold-bordered card that slides over the video
// area for ~12s. Never blocks the page (the wrapper is click-through; only the
// card + X are interactive). businessName comes from the page's sponsorship. ----
function SponsorTakeover({
  businessName,
  onDismiss,
}: {
  businessName: string;
  onDismiss: () => void;
}) {
  return (
    <div className="pulse-takeover" role="status" aria-live="polite">
      <div className="pulse-takeover__card">
        <button
          type="button"
          className="pulse-takeover__close"
          aria-label="Dismiss sponsor spot"
          onClick={onDismiss}
        >
          ×
        </button>
        <span className="pulse-takeover__kicker">
          A word from our presenting sponsor
        </span>
        <span className="pulse-takeover__name">{businessName}</span>
      </div>
    </div>
  );
}

// ---- Fan photo gallery: a responsive lazy thumbnail grid of the game's
// confirmed photos with a no-library lightbox (full image over a dark overlay,
// click/X/Esc to close). Loads best-effort and renders NOTHING until at least
// one photo exists, so a failed load or an empty game simply shows no section. ----
function GamePhotos({ token, eventId }: { token: string | null; eventId: string }) {
  const [photos, setPhotos] = useState<GamePhoto[]>([]);
  const [active, setActive] = useState<GamePhoto | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getGamePhotos(token, eventId);
        if (!cancelled) setPhotos(list);
      } catch {
        /* photos are a garnish -- a failed load just hides the section */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  // Esc closes the lightbox while it's open.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActive(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (photos.length === 0) return null;

  return (
    <section className="game-photos">
      <h2 className="game-articles__head">Photos</h2>
      <div className="photos-grid photos-grid--gallery">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            className="photos-tile photos-tile--btn"
            onClick={() => setActive(photo)}
            aria-label="View photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.publicUrl}
              alt="Game photo"
              loading="lazy"
              className="photos-tile__img"
            />
          </button>
        ))}
      </div>

      {active && (
        <div
          className="lightbox-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            className="lightbox-close"
            aria-label="Close"
            onClick={() => setActive(null)}
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.publicUrl}
            alt="Game photo"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}

export default function GamePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  // THE GAME, ITS OWN ROW. Was `events.find(e => e.id === id)` over the whole
  // list; see the loader below for why that changed.
  const [event, setEvent] = useState<EventDetail | null>(null);
  // Records and next fixtures. Garnish — a failure leaves it null and the strip
  // simply doesn't render.
  const [context, setContext] = useState<EventContext | null>(null);
  // The list, kept ONLY for the "More games" rail. It no longer gates the page.
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [articles, setArticles] = useState<EventContentItem[] | null>(null);
  const [latest, setLatest] = useState<FeedItem[] | null>(null);
  // The game's presenting sponsor, or null when it has none. A failed lookup
  // degrades silently (stays null), so the strip simply doesn't render.
  const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);
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
        // ONE GAME, BY ID. This used to be `getEvents(token)` — the whole
        // schedule, 486 rows, filtered client-side to one — under a comment
        // reading "No guaranteed GET /events/:id". That route has existed the
        // whole time, ungated, returning the full row. The comment cost two
        // orders of magnitude of payload and kept `periodScores` off the screen,
        // because the LIST projection has never carried it.
        //
        // THE RAIL NO LONGER GATES THE PAGE. "More games" still needs the list,
        // so it is fetched here too — but swallowed to [] like the other
        // garnish. A slow or failed schedule read used to blank the game; now it
        // costs a rail.
        const [ev, ctx, content, feed, sponsor, list] = await Promise.all([
          getEvent(token, id),
          getEventContext(token, id).catch(() => null),
          getEventContent(token, id, 'published').catch(
            () => [] as EventContentItem[],
          ),
          getPublishedContent(token).catch(() => [] as FeedItem[]),
          // The sponsor strip is a garnish, not the page -- a failed lookup
          // degrades silently to null rather than blanking the game.
          getEventSponsorship(token, id).catch(() => null),
          getEvents(token).catch(() => [] as EventListItem[]),
        ]);
        if (cancelled) return;
        setEvent(ev);
        setContext(ctx);
        setArticles(content);
        setLatest(feed);
        setSponsorship(sponsor);
        setEvents(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load game');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, id, router, allowed]);



  // ---------------------------------------------------------------------
  // THE 30-SECOND REFRESH, WHILE LIVE ONLY.
  //
  // The 5s pulse below polls `game_events` — the COURTSIDE feed — and derives
  // the score from score_update rows. That is excellent on a covered game with
  // a rep at the console, and it does nothing at all on a FEED game (453 of
  // 486), because nothing emits game_events for those. Their score moves in the
  // database when the resolver runs and the page never looked again, so a fan
  // watching an ESPN game saw whatever was true when the tab opened.
  //
  // WHY 30s AND NOT FASTER. The resolver polls the provider every TEN MINUTES,
  // so that is the ceiling on freshness — polling at 5s would issue 120 requests
  // to learn the same number. 30s keeps the page consistent with the database
  // without pretending to be consistent with the game. It is also strictly
  // cheaper than the poll already running beside it: one small row every 30s
  // against a feed cursor every 5.
  //
  // STOPS ON UNMOUNT AND WHEN THE GAME STOPS BEING LIVE — the same discipline
  // useLivePulse follows, for the same reason: a finished game's row will never
  // change again and a timer left running is a request per viewer forever.
  // ---------------------------------------------------------------------
  const isLiveNow = event?.status === 'live';
  useEffect(() => {
    if (!token || !isLiveNow) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const fresh = await getEvent(token, id);
          // The status can move underneath us — a game going final is exactly
          // when the last score lands, so the row is applied either way and the
          // effect re-runs to clear the timer.
          if (!cancelled) setEvent(fresh);
        } catch {
          /* A missed tick is the next tick's problem. Never surfaced: a
             transient failure must not put an error box over a live game. */
        }
      })();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, id, isLiveNow]);

  // "More games": live games float to the very top of the rail, then same-sport
  // first among the rest, then everything else. Current game excluded.
  const moreGames = useMemo(() => {
    if (!events || !event) return [];
    const others = events.filter((e) => e.id !== id);
    const live = others.filter((e) => e.status === 'live');
    const notLive = others.filter((e) => e.status !== 'live');
    const same = notLive.filter((e) => e.sport === event.sport);
    const rest = notLive.filter((e) => e.sport !== event.sport);
    return [...live, ...same, ...rest].slice(0, 5);
  }, [events, event, id]);

  // "Latest articles": each links straight to its own /articles/[id] page now, so
  // no game-resolution is needed. Drop this game's OWN coverage (matched on the
  // matchup+time key) to avoid repeating what the Coverage section already lists,
  // then keep the newest five.
  const latestArticles = useMemo(() => {
    if (!latest) return [];
    const currentKey = event
      ? eventKey(event.homeTeam, event.awayTeam, event.scheduledAt)
      : null;
    return latest
      .filter(
        (a) =>
          !currentKey ||
          eventKey(a.homeTeam, a.awayTeam, a.eventScheduledAt) !== currentKey,
      )
      .slice(0, 5);
  }, [latest, event]);

  // Branch the whole page on WHO made this game. A feed game (source != null) is
  // an ingested score, not a Sharp Foxx broadcast, so it gets a lean PLAY layout
  // -- scoreboard + predictions + more games -- with no video, photos, courtside
  // feed, sponsor strip, or watch language. A covered game (source IS NULL) is
  // untouched. See THE RULE in api.ts.
  const isFeed = isFeedEvent(event?.source);

  // Fan live pulse: only polls while this game is live (the hook itself no-ops
  // and tears down when `live` is false). Hooks run before the early returns.
  // A feed game has no correspondent emitting courtside events, so the pulse is
  // covered-only -- its scores come from ingestion on the events row, not here.
  const live = event?.status === 'live';
  const pulse = useLivePulse(token, id, live && !isFeed);

  // "Watch a live game" earns after three minutes of VISIBLE time on this page.
  // Same gate as the pulse — COVERED and LIVE: an ingested feed game is a
  // scoreboard, not a Sharp Foxx broadcast, and there is nothing to watch on it.
  // A backgrounded tab doesn't accumulate (see useWatchLiveGameEarn).
  useWatchLiveGameEarn(id, live && !isFeed);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home game-page">
      <Link href="/feed" className="game-back">
        ← Back to feed
      </Link>

      {loading && <div className="card muted">Loading game…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && !event && (
        <div className="results-empty">
          <p className="results-empty__title">Game not found</p>
          <p className="results-empty__hint">
            This game may have been removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && event && (
        <div className="game-layout">
          {isFeed ? (
            // ---- FEED (play) layout: the page's purpose here is the picks, so
            // it's scoreboard -> predictions, nothing else. No video, photos,
            // courtside feed, sponsor strip, or watch language. ----
            <div className="game-main">
              <div className="gamescope-playhead">
                <span className="gamescope-playhead__tag">Scores</span>
                <span className="gamescope-playhead__note">
                  Live scoreboard · make your pick below
                </span>
              </div>
              <Scoreboard event={event} />
              {/* The box score, directly under the score it breaks down. Both
                  self-hide: no periods before a game starts, no form strip
                  without team FKs. */}
              <PeriodTable event={event} />
              {context && <TeamContextStrip event={event} context={context} />}
              {/* The reason this page exists for a feed game. Renders on every
                  game (an upcoming one can carry open questions pre-tip) but
                  only polls while live. */}
              <PredictionsSection token={token} eventId={id} live={live} />
            </div>
          ) : (
            // ---- COVERED layout: the full Sharp Foxx broadcast experience,
            // unchanged. ----
            <div className="game-main game-main--live-anchor">
              {live && pulse.takeover && (
                <SponsorTakeover
                  businessName={sponsorship?.businessName ?? 'our presenting sponsor'}
                  onDismiss={pulse.dismissTakeover}
                />
              )}
              <GameVideo event={event} />
              <Scoreboard
                event={event}
                liveHome={live ? pulse.home : null}
                liveAway={live ? pulse.away : null}
                scoreVersion={pulse.scoreVersion}
                period={live ? pulse.period : null}
              />
              {sponsorship && <PresentingSponsorStrip sponsorship={sponsorship} />}
              {/* On a covered game this states WHY there is no period table
                  rather than leaving a hole where the box score goes — see
                  PeriodTable. The form strip works the same on both layouts. */}
              <PeriodTable event={event} />
              {context && <TeamContextStrip event={event} context={context} />}
              {/* Photos ride directly under the video area (single column on
                  mobile puts them right beneath the player). */}
              <GamePhotos token={token} eventId={id} />
              {/* Predictions sit ABOVE the courtside feed: after a pick is in,
                  the feed is what settles it, so the question has to come first.
                  It renders on every game (an upcoming one can carry open
                  questions pre-tip) but only polls while live — see POLL_MS. */}
              <PredictionsSection token={token} eventId={id} live={live} />
              {live && <LiveFeed items={pulse.feed} />}
              <ShareRow event={event} />

              <section className="game-articles">
                <h2 className="game-articles__head">Coverage</h2>
                {articles && articles.length > 0 ? (
                  <div className="game-covlist">
                    {articles.map((a) => (
                      <Link
                        key={a.id}
                        href={`/articles/${a.id}`}
                        className="game-covrow"
                      >
                        <span className="game-covrow__title">{a.title}</span>
                        <span className="game-covrow__date">
                          {formatDate(a.publishedAt ?? a.createdAt)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="results-empty">
                    <p className="results-empty__title">No coverage published yet</p>
                    <p className="results-empty__hint">
                      Recaps and features for this game will appear here once
                      published.
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}

          <aside className="game-rail">
            <section className="game-rail-section">
              <h2 className="game-rail-title">More games</h2>
              {moreGames.length > 0 ? (
                moreGames.map((e) => <RailGameCard key={e.id} event={e} />)
              ) : (
                <p className="muted">No other games right now.</p>
              )}
              <Link href="/feed" className="game-rail-more">
                More games →
              </Link>
            </section>

            {/* Latest articles is editorial coverage -- a watch concern. A feed
                game has none, so the section is covered-only. */}
            {!isFeed && (
              <section className="game-rail-section">
                <h2 className="game-rail-title">Latest articles</h2>
                {latestArticles.length > 0 ? (
                  latestArticles.map((item) => (
                    <Link
                      key={item.id}
                      href={`/articles/${item.id}`}
                      className="game-railrow"
                    >
                      <span className="game-railrow__title">{item.title}</span>
                      {item.homeTeam && item.awayTeam && (
                        <span className="game-railrow__match">
                          {item.homeTeam} vs {item.awayTeam}
                        </span>
                      )}
                    </Link>
                  ))
                ) : (
                  <p className="muted">No articles published yet.</p>
                )}
              </section>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
