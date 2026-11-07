// ============================================================================
// LINE MOVEMENT -- the game page module. How this game's market moved, as facts.
//
// ****************************************************************************
// RESTRAINT IS THE SPEC.
//
//   * ABSENT WHEN NOTHING HAPPENED. Under the floor (the API's movementFloor,
//     2 percentage points of win probability), or with no defensible open, this renders
//     NOTHING -- not a "no significant movement" line. A component that speaks
//     when everything is fine teaches people to stop reading it; the cron tells
//     follow the same rule.
//   * NO INTERPRETATION. We hold five books' prices over time and nothing about
//     who bet what. So: no "sharp money", no "the public is on", no reason for a
//     move, nothing that reads as a pick. Every sentence below is a price, a
//     time, or a count.
//   * THE FAMILIAR NUMBER LEADS. "Opened Ravens -2.5, now Jaguars -10" is the
//     headline; the win probability is the annotation. Where the number did not
//     move but the price did (hockey's +/-1.5, baseball's run line), the
//     moneyline is the familiar number instead.
//   * ONE UNIT PER BARE NUMBER. A bare number is ALWAYS the line's own unit:
//     spread points, total points, or American odds. A probability NEVER
//     appears bare -- it is a "%" (a level) or "percentage points" (a change).
//     "4.3 pts" beside a headline in spread points reads as spread points, so
//     the word "pts" is not used for probability anywhere in this file.
// ****************************************************************************
//
// All of the wording is decided in describeLineMovement(), a pure function, so
// "absent when nothing happened" is testable without a browser.
// ============================================================================

import { etDateTime, etTime, LineMovement, MovementPoint } from './api';

export interface MovementCopy {
  lead: string;            // the familiar number, open -> now
  total: string | null;    // the total, only when it moved
  probability: string;     // the annotation
  when: string | null;     // when the biggest stretch happened
  footnote: string;        // how the number is made, and how fresh it is
  // The sparkline: the CURRENT favourite's win probability over the series, so
  // the line and the annotation describe the same side.
  spark: number[];
  sparkSide: string;
  // The two ends, located in time: open's instant and current's instant, in ET.
  // Dates only when they fall on different ET days; date and time when they
  // share one (two identical labels would locate nothing).
  sparkFrom: string;
  sparkTo: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
// A CHANGE in probability. Spelled out on purpose -- see ONE UNIT PER BARE NUMBER.
const pctPoints = (p: number) => `${Math.abs(p * 100).toFixed(1)} percentage points`;
export const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : 'EVEN');

// "Baltimore Ravens -2.5" from the PROVIDER's signed home spread: negative means
// the home team gives the points; positive means the away team does.
export function spreadPhrase(p: MovementPoint, home: string, away: string): string | null {
  if (p.homeSpread === null) return null;
  if (p.homeSpread === 0) return 'pick’em';
  return p.homeSpread < 0
    ? `${home} −${num(Math.abs(p.homeSpread))}`
    : `${away} −${num(p.homeSpread)}`;
}

// The favourite's moneyline: "Jacksonville Jaguars -550".
export function moneylinePhrase(p: MovementPoint, home: string, away: string): string | null {
  if (p.homeMoneyline === null || p.awayMoneyline === null || p.homeWinProb === null) return null;
  return p.homeWinProb >= 0.5
    ? `${home} ${signed(p.homeMoneyline)}`
    : `${away} ${signed(p.awayMoneyline)}`;
}

export function describeLineMovement(
  m: LineMovement | null,
  home: string,
  away: string,
): MovementCopy | null {
  // ABSENT, in every case the API can describe: no data, no defensible open
  // (fewer than openMinOperators ever posted), or under the floor.
  if (!m || !m.open || !m.current || !m.delta || !m.moved) return null;
  const { open, current, delta } = m;
  if (open.homeWinProb === null || current.homeWinProb === null) return null;

  const spreadMoved = delta.homeSpread !== null && delta.homeSpread !== 0;
  const lead = spreadMoved
    ? `Opened ${spreadPhrase(open, home, away)}, now ${spreadPhrase(current, home, away)}.`
    : `Opened ${moneylinePhrase(open, home, away)}, now ${moneylinePhrase(current, home, away)}.`;

  const total = delta.total !== null && delta.total !== 0 && open.total !== null && current.total !== null
    ? `Total opened ${num(open.total)}, now ${num(current.total)}.`
    : null;

  // The annotation is about the side favoured NOW, so it reads in one direction.
  const homeNow = current.homeWinProb >= 0.5;
  const side = homeNow ? home : away;
  const pOpen = homeNow ? open.homeWinProb : 1 - open.homeWinProb;
  const pNow = homeNow ? current.homeWinProb : 1 - current.homeWinProb;
  const probability = `${side} win probability ${pct(pOpen)} → ${pct(pNow)}.`;

  // WHEN, as a fact. "Most of it" only when that stretch really was most of it;
  // otherwise the biggest stretch is named as exactly that and nothing more.
  let when: string | null = null;
  const lm = m.largestMove;
  if (lm) {
    const day = (iso: string) => etDateTime(iso, { month: 'short', day: 'numeric' });
    const withDay = { weekday: 'short', hour: 'numeric', minute: '2-digit' } as const;
    const start = etDateTime(lm.from, withDay);
    // Direction named as a team, from the stretch's own sign -- a fact, not a reason.
    const toward = lm.homeWinProbDelta > 0 ? home : away;
    if (lm.from === lm.to) {
      // ONE CHANGE -- the cliff in the sparkline. Named as an instant, because
      // "between 6:42 PM and 6:42 PM" would describe a stretch that did not exist.
      const at = etDateTime(lm.to, { ...withDay, zone: true });
      when = lm.shareOfTotal >= 0.5
        ? `Most of it came in a single move, at ${at}.`
        : `The biggest move in any 3-hour stretch was ${pctPoints(lm.homeWinProbDelta)} `
          + `toward ${toward}, in a single move at ${at}.`;
    } else {
      // A window can cross ET midnight; then the end names its own day too.
      const end = day(lm.from) === day(lm.to) ? etTime(lm.to, { zone: true }) : etDateTime(lm.to, { ...withDay, zone: true });
      const span = `${start} and ${end}`;
      when = lm.shareOfTotal >= 0.5
        ? `Most of it came between ${span}.`
        : `The biggest 3-hour stretch moved win probability ${pctPoints(lm.homeWinProbDelta)} `
          + `toward ${toward}, between ${span}.`;
    }
  }

  const footnote = `Median of ${current.bookCount} independent sportsbooks, vig removed.`
    + (m.asOf ? ` Prices as of ${etDateTime(m.asOf, { zone: true })}.` : '');

  // The API's series is ALREADY the qualified one (3+ operators, a probability),
  // open its first point and current its last -- the same points the largest
  // move is computed over. Drawn as given, so the shape and the sentence agree;
  // no filtering here, which would be a second, possibly different, rule.
  const spark = m.series.map((p) => (homeNow ? p.homeWinProb! : 1 - p.homeWinProb!));

  const etDay = (iso: string) => etDateTime(iso, { month: 'short', day: 'numeric' });
  const sameDay = etDay(open.at) === etDay(current.at);
  const end = (iso: string) => (sameDay
    ? etDateTime(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : etDay(iso));

  return {
    lead, total, probability, when, footnote, spark, sparkSide: side,
    sparkFrom: end(open.at), sparkTo: end(current.at),
  };
}

// A plain sparkline. Points are evenly spaced by index, not by time: the series
// is one point per change, and a week of quiet followed by an hour of movement
// would otherwise compress the movement into a sliver. That is also why the
// ends carry dates and nothing between them does: only the ends are located in
// time, and an axis would imply the middle is too.
//
// THE END MARKS are zero-length subpaths with round caps under
// non-scaling-stroke, so they stay round dots although the viewBox stretches
// (preserveAspectRatio="none" would squash a <circle> into an ellipse). Open is
// the smaller, muted dot; current the full one.
function Sparkline({
  values, label, from, to,
}: { values: number[]; label: string; from: string; to: string }) {
  if (values.length < 2) return null;
  const w = 240; const h = 44; const pad = 4;
  const lo = Math.min(...values); const hi = Math.max(...values);
  const span = hi - lo || 1;
  const xy = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (w - pad * 2),
    pad + (1 - (v - lo) / span) * (h - pad * 2),
  ]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dot = ([x, y]: number[]) => `M${x.toFixed(1)},${y.toFixed(1)} h0`;
  return (
    <figure className="linemove__sparkwrap">
      <svg
        className="linemove__spark"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} win probability, from ${pct(values[0])} at open (${from}) `
          + `to ${pct(values[values.length - 1])} now (${to})`}
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path className="linemove__sparkopen" d={dot(xy[0])} stroke="currentColor" strokeWidth="5"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={dot(xy[xy.length - 1])} stroke="currentColor" strokeWidth="7"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="linemove__sparkends" aria-hidden="true">
        <span>Open · {from}</span>
        <span>Current · {to}</span>
      </figcaption>
    </figure>
  );
}

export function LineMovementModule({
  movement,
  home,
  away,
}: {
  movement: LineMovement | null;
  home: string;
  away: string;
}) {
  const copy = describeLineMovement(movement, home, away);
  if (!copy) return null;
  return (
    <section className="linemove">
      <h2 className="linemove__title">Line movement</h2>
      <div className="linemove__panel">
        <p className="linemove__lead">{copy.lead}</p>
        {copy.total && <p className="linemove__line">{copy.total}</p>}
        <p className="linemove__prob">{copy.probability}</p>
        <Sparkline values={copy.spark} label={copy.sparkSide} from={copy.sparkFrom} to={copy.sparkTo} />
        {copy.when && <p className="linemove__line">{copy.when}</p>}
        <p className="linemove__foot">{copy.footnote}</p>
      </div>
    </section>
  );
}
