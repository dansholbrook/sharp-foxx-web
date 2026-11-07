// ============================================================================
// THE LINE, AND THE FINAL AGAINST IT -- the game page's betting facts.
//
// ****************************************************************************
// ONE LINE PER PAGE. THERE ARE TWO STORED, AND THEY DISAGREE.
//
//   events carries a line (spread_line / total_line), written by fetch-lines
//   about every 12 hours. line_history carries the market every 20 minutes near
//   kickoff, and the line-movement module's `current` is computed from it.
//   Measured 2026-11-06 on 56 games holding both: the spreads differed on 23,
//   the totals on 28 -- not wrong, just hours apart. Printing both would put two
//   different numbers for the same thing on one page.
//
//   So: when line movement has a qualified point (3+ independent operators --
//   OPEN_MIN_OPERATORS on the API), THAT is the line, and on a game that has
//   started it is the CLOSE. It is the same `current` the line-movement module
//   prints, read from the same response, so the two cannot disagree. Only when
//   there is no such point does the stored events line show -- labelled with its
//   own source and time, and NEVER called the close: it can be half a day older
//   than kickoff. Nothing is graded against it.
// ****************************************************************************
//
// ****************************************************************************
// TWO BLOCKS, EACH FACT ONCE -- the same layout before, during and after a game.
//
//   THIS block (GameLine) owns THE NUMBER: the line (the close, once the game has
//   started), its implied win probability, the one footnote saying where the
//   prices came from and when, and on a final the result against it.
//   The line-movement module below owns WHERE IT STARTED AND HOW IT GOT THERE:
//   the open, the path, the sparkline. It carries no current or closing value
//   and no footnote of its own -- both are here.
// ****************************************************************************
//
// FACTS, NOT VERDICTS, EACH SAID ONCE. The number is the headline, so the result
// lines compare against it without restating it:
//   "Tampa Bay Buccaneers −2 · Total 43"            <- headline
//   "Tampa Bay Buccaneers won by 16, 14 more than the spread."
//   "Final total 16, 27 below the close."
// Every fact is there -- the closing number, who won and by how much, the margin
// against the number -- and nothing is repeated. No "covered", no "the market
// got it wrong", no colour that rewards one outcome: a cover, a loss against
// the number and a push read in exactly the same register.
//
// All wording is decided in the pure describe* functions, so every state is
// testable without a browser.
// ============================================================================

import { etDateTime, EventDetail, LineMovement, MovementPoint } from './api';
import { num, spreadPhrase } from './line-movement';

const SOURCE_LABEL: Record<string, string> = {
  sportsdataio: 'SportsDataIO',
  sharpapi: 'SharpAPI',
  manual: 'entered by hand',
};

export interface LineCopy {
  title: string;        // 'The line' | 'Closing line' | 'Last line we held'
  parts: string[];      // 'Ravens −2.5', 'Total 48.5'
  // 'Ravens 62% · Jaguars 38%'. The DE-VIGGED win probability from the same
  // marketConsensus -> devigMoneylines path the Oracle and line movement use --
  // read off `current`, never recomputed here. NULL when there is no qualified
  // moneyline pair (or the trial gate refused it); the stored events line carries
  // no moneyline, so a fallback line never has one either.
  probability: string | null;
  foot: string;         // where it came from, and as of when
}

// Rounded once, and the other side is 100 minus it, so the pair always reads as
// 100% -- 62/38, never a 62/39 that invites the question of where 1% went.
function probabilityPhrase(c: MovementPoint, home: string, away: string): string | null {
  if (c.homeWinProb === null) return null;
  const h = Math.round(c.homeWinProb * 100);
  return c.homeWinProb >= 0.5 ? `${home} ${h}% · ${away} ${100 - h}%` : `${away} ${100 - h}% · ${home} ${h}%`;
}

export interface CloseCopy {
  spread: string;       // the result against the closing spread, or the result alone
  total: string | null; // the final total against the closing total
}

const started = (e: EventDetail) => e.status === 'live' || e.status === 'final';

// The qualified point, when there is one. `current` only exists when the API
// found 3+ operators posting at once -- the rule is the API's, applied once.
function closeOf(m: LineMovement | null): MovementPoint | null {
  const c = m?.current ?? null;
  if (!c || (c.homeSpread === null && c.total === null)) return null;
  return c;
}

export function describeGameLine(
  e: EventDetail, m: LineMovement | null, home: string, away: string,
): LineCopy | null {
  if (e.status === 'postponed' || e.status === 'canceled') return null;

  const c = closeOf(m);
  if (c) {
    // Spread and total only. NOT the moneyline: it is a MEDIAN per side, and an
    // even number of books gives a half-point price -- 'Rangers −148.5' -- that no
    // sportsbook ever posted. The line block prints prices that existed.
    const parts = [
      spreadPhrase(c, home, away),
      c.total !== null ? `Total ${num(c.total)}` : null,
    ].filter((x): x is string => !!x);
    return {
      title: started(e) ? 'Closing line' : 'The line',
      parts,
      probability: probabilityPhrase(c, home, away),
      foot: `Median of ${c.bookCount} independent sportsbooks, vig removed. `
        + (started(e)
          ? `Last pregame prices, posted ${etDateTime(c.at, { zone: true })}.`
          : m?.asOf ? `As of ${etDateTime(m.asOf, { zone: true })}.` : ''),
    };
  }

  // No qualified point: the stored line, said to be exactly what it is.
  const spread = e.spreadLine !== null && e.spreadFavoriteTeamId
    ? Number(e.spreadLine) === 0
      ? 'pick’em'
      : `${e.spreadFavoriteTeamId === e.homeTeamId ? home : away} −${num(Number(e.spreadLine))}`
    : null;
  const total = e.totalLine !== null ? `Total ${num(Number(e.totalLine))}` : null;
  if (!spread && !total) return null;

  const srcs = [...new Set([spread ? e.spreadSource : null, total ? e.lineSource : null]
    .filter((x): x is string => !!x).map((s) => SOURCE_LABEL[s] ?? s))];
  const when = [spread ? e.spreadUpdatedAt : null, total ? e.lineUpdatedAt : null]
    .filter((x): x is string => !!x).sort().pop();
  return {
    title: started(e) ? 'Last line we held' : 'The line',
    parts: [spread, total].filter((x): x is string => !!x),
    probability: null,
    foot: [srcs.length ? `From ${srcs.join(' and ')}` : null, when ? `as of ${etDateTime(when, { zone: true })}` : null]
      .filter(Boolean).join(', ') + '.'
      + (started(e) ? ' Not the closing line: no later prices were captured for this game.' : ''),
  };
}

export function describeFinalVsClose(
  e: EventDetail, m: LineMovement | null, home: string, away: string,
): CloseCopy | null {
  if (e.status !== 'final' || e.homeScore === null || e.awayScore === null) return null;
  const c = closeOf(m);
  if (!c) return null;

  const margin = e.homeScore - e.awayScore;                 // home's view
  const winner = margin > 0 ? home : away;
  const score = `${Math.max(e.homeScore, e.awayScore)}–${Math.min(e.homeScore, e.awayScore)}`;

  // One sentence. The favourite -- the team carrying the minus in the headline --
  // is the subject; what they did is the verb; how that compares with the number
  // is the closing clause. The same three parts whether they won by more, won by
  // less, tied or lost.
  let spread: string;
  if (c.homeSpread === null || c.homeSpread === 0) {
    spread = margin === 0 ? `The game ended tied ${score}.` : `${winner} won by ${Math.abs(margin)}.`;
  } else {
    const fav = c.homeSpread < 0 ? home : away;
    const n = Math.abs(c.homeSpread);
    const favMargin = c.homeSpread < 0 ? margin : -margin;
    const did = favMargin > 0 ? `won by ${favMargin}` : favMargin === 0 ? `tied ${score}` : `lost by ${-favMargin}`;
    const vs = favMargin - n;                                // the margin against the number
    const against = vs === 0 ? 'exactly the spread' : `${num(Math.abs(vs))} ${vs > 0 ? 'more' : 'less'} than the spread`;
    spread = `${fav} ${did}, ${against}.`;
  }

  let total: string | null = null;
  if (c.total !== null) {
    const sum = e.homeScore + e.awayScore;
    const d = sum - c.total;
    total = `Final total ${sum}, `
      + (d === 0 ? 'exactly the close.' : `${num(Math.abs(d))} ${d > 0 ? 'above' : 'below'} the close.`);
  }
  return { spread, total };
}

export function GameLine({
  event, movement, home, away,
}: { event: EventDetail; movement: LineMovement | null; home: string; away: string }) {
  const line = describeGameLine(event, movement, home, away);
  const close = describeFinalVsClose(event, movement, home, away);
  // `close` needs the same qualified point `line` is built from, so it never
  // appears without the headline it is compared against.
  if (!line) return null;
  return (
    <section className="gameline">
      {line && (
        <div className="gameline__line">
          <h2 className="gameline__title">{line.title}</h2>
          <p className="gameline__parts">
            {line.parts.map((p, i) => (
              <span key={p} className="gameline__part">{i > 0 && <span aria-hidden="true"> · </span>}{p}</span>
            ))}
          </p>
          {/* On a final, the result against the number just above it. */}
          {close && <p className="gameline__fact">{close.spread}</p>}
          {close?.total && <p className="gameline__fact">{close.total}</p>}
          {line.probability && (
            <p className="gameline__prob">
              <span className="gameline__problabel">Implied win probability</span> {line.probability}
            </p>
          )}
          <p className="gameline__foot">{line.foot}</p>
        </div>
      )}
    </section>
  );
}
