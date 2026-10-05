// ============================================================================
// THUMB SUBJECT -- what sits in the middle of a game card.
//
// Two renderings of one thing, and the card picks between them by DATA, not by
// surface:
//
//   LOCKUP   both teams have a logo -> crest on a light disc, name beneath
//   MATCHUP  anything else          -> the text treatment, exactly as before
//
// ONE COMPONENT BECAUSE THERE WERE FOUR IDENTICAL COPIES. The matchup block was
// byte-for-byte the same in app/feed, app/search and twice in app/games. That is
// the same drift that put three copies of thumbClass in the tree; adding a
// second, data-dependent rendering to four copies would have guaranteed they
// diverged.
// ============================================================================

import type { EventListItem } from './api';
import { cardLockup } from './card-treatment';

export function ThumbSubject({
  event, home, away,
}: {
  event: EventListItem;
  /** Display names, already resolved through teamLabel by the caller. */
  home: string;
  away: string;
}) {
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const lockup = cardLockup(event);

  // THE FALLBACK IS THE OLD CARD, UNCHANGED. Not a degraded variant of the
  // lockup -- the identical markup this card has always rendered. Every cwbb
  // matchup lands here (the provider publishes no logo for any of them), so
  // this path is ordinary, not exceptional.
  if (!lockup) {
    return (
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
    );
  }

  return (
    <div className="thumb-lockup">
      <div className="thumb-lockup__side">
        <span className="thumb-disc">
          {/* Plain <img>, not next/image: these are a handful of KB each,
              already sized by CSS, and served from our own R2 bucket -- the
              optimizer would add a remote-pattern config and a proxy hop for
              no gain. alt is EMPTY on purpose: the team name is right beneath
              it in text, so announcing the crest too would read the name twice. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb-crest" src={lockup.home} alt="" loading="lazy" />
        </span>
        <span className="thumb-lockup__name">{home}</span>
      </div>
      {/* The score takes the centre when there is one, exactly as it does in the
          text matchup -- a final game should read as a result on both. */}
      {hasScore ? (
        <span className="thumb-score">
          {event.homeScore} – {event.awayScore}
        </span>
      ) : (
        <span className="thumb-lockup__vs">vs</span>
      )}
      <div className="thumb-lockup__side">
        <span className="thumb-disc">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb-crest" src={lockup.away} alt="" loading="lazy" />
        </span>
        <span className="thumb-lockup__name">{away}</span>
      </div>
    </div>
  );
}
