// ============================================================================
// LINE MOVEMENT -- the game page module. How this game's market moved, as facts.
//
// ****************************************************************************
// RESTRAINT IS THE SPEC.
//
//   * THREE FORMS, CHOSEN BY THE API'S `moved`:
//       moved                 the full module: lead, probability, sparkline.
//                             `moved` is true when ANY of three tests fires:
//                             open-to-current win probability, the furthest
//                             excursion in win probability (a line that went out
//                             and came back), or the total's furthest move as a
//                             share of the open total (the probability is blind
//                             to the total).
//       history, not moved    ONE LINE OF FACT: where it opened and the range it
//                             has traded in. Not a chart, and never
//                             "no significant movement" (a verdict). A stable
//                             market is information, and the line also makes the
//                             absence legible: without it nobody can tell "the
//                             market has not moved" from "this is broken".
//       no history            NOTHING, and only then.
//     A chart that speaks when there is nothing to say trains people to ignore
//     it; one line of fact does not.
//   * THE OPEN AND THE PATH, NEVER THE NUMBER. The line block above
//     (game-line.tsx) owns the current line -- the close, once the game has
//     started -- its implied probability, the result and the one footnote. This
//     module says where the market started and how it got there, and stops. No
//     current or closing value, no footnote: each would be the second time the
//     page said it. The same split before, during and after the game, so the
//     page never rearranges itself when it kicks off.
//   * NO INTERPRETATION. We hold five books' prices over time and nothing about
//     who bet what. So: no "sharp money", no "the public is on", no reason for a
//     move, nothing that reads as a pick. Every sentence below is a price, a
//     time, or a count.
//   * THE FAMILIAR NUMBER LEADS. "Opened Baltimore Ravens -2.5 on Oct 27" is the
//     headline; the win probability at the open is the annotation. Where the number did not
//     move but the price did (hockey's +/-1.5, baseball's run line), the de-vigged
//     WIN PROBABILITY leads instead -- never a moneyline: the market moneyline is
//     a median, and a median of -148 and -149 is -148.5, a price no book posted.
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
  kind: 'full';
  lead: string;            // the familiar number at the open (and its range, when shown for the path)
  total: string | null;    // the total, only when it moved
  probability: string | null;  // the annotation; null when the lead already is one
  // THE SIZE OF THE MOVE, open to current/close: its own fact, not a repeat of
  // either end -- without it the swing exists only if the reader subtracts.
  size: string | null;
  when: string | null;     // when the biggest stretch happened
  // The sparkline: the CURRENT favourite's win probability over the series, so
  // the line and the annotation describe the same side -- or, when the total's
  // move is the only test that fired, the total itself (a probability that
  // barely moved, auto-scaled to fill the box, would draw noise as a shape).
  spark: number[];
  sparkSide: string;
  sparkUnit: 'probability' | 'total';
  // The two ends, located in time: open's instant and current's instant, in ET.
  // Dates only when they fall on different ET days; date and time when they
  // share one (two identical labels would locate nothing).
  sparkFrom: string;
  sparkTo: string;
  sparkToLabel: string;    // 'Current' before the game, 'Close' after kickoff
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
// A CHANGE in probability. Spelled out on purpose -- see ONE UNIT PER BARE NUMBER.
const pctPoints = (p: number) => `${Math.abs(p * 100).toFixed(1)} percentage points`;
export const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// "Baltimore Ravens -2.5" from the PROVIDER's signed home spread: negative means
// the home team gives the points; positive means the away team does.
export function spreadPhrase(p: MovementPoint, home: string, away: string): string | null {
  if (p.homeSpread === null) return null;
  if (p.homeSpread === 0) return 'pick’em';
  return p.homeSpread < 0
    ? `${home} −${num(Math.abs(p.homeSpread))}`
    : `${away} −${num(p.homeSpread)}`;
}

// History held, nothing over the floor: one line of fact, and its freshness.
export interface StillCopy {
  kind: 'line';
  text: string;
}

// One end of a spread range. Bare ("−3.5") when the team giving the points is the
// one the open named, so the sentence reads "Opened Bengals −3 ... between −3 and
// −3.5"; named in full when the other team gave them, so a range that crossed
// over cannot read as the opener's.
function spreadEnd(homeSpread: number, openHomeSpread: number | null, home: string, away: string): string {
  if (homeSpread === 0) return 'pick’em';
  const sameSide = openHomeSpread !== null && openHomeSpread !== 0
    && Math.sign(openHomeSpread) === Math.sign(homeSpread);
  const mag = `−${num(Math.abs(homeSpread))}`;
  return sameSide ? mag : `${homeSpread < 0 ? home : away} ${mag}`;
}

// "between −3 and −3.5", ordered by the opener's handicap, smaller first. When
// the range crossed from one team giving points to the other, BOTH ends are
// named: a bare number would then belong to whichever team was named last.
function spreadRange(r: { min: number; max: number }, openHomeSpread: number | null, home: string, away: string): string {
  const ends = [r.min, r.max].sort((a, b) =>
    (openHomeSpread !== null && openHomeSpread < 0 ? b - a : a - b));
  const crossed = Math.sign(r.min) !== Math.sign(r.max);
  const end = (v: number) => (crossed ? spreadEnd(v, null, home, away) : spreadEnd(v, openHomeSpread, home, away));
  return `between ${end(ends[0])} and ${end(ends[1])}`;
}

const day = (iso: string) => etDateTime(iso, { month: 'short', day: 'numeric' });
const stampOf = (iso: string) => etDateTime(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', zone: true });

// ****************************************************************************
// TENSE. line_history is PREGAME prices only, so once a game has started the
// path is over: "has traded" becomes "traded", and the sparkline's last point
// is the Close, not the Current. `closed` = live or final.
// ****************************************************************************
function tense(closed: boolean) {
  return closed
    ? { traded: 'traded', ranged: 'ranged', since: 'unchanged through the close', close: 'Close', moved: 'Moved' }
    : { traded: 'has traded', ranged: 'has ranged', since: 'unchanged since', close: 'Current', moved: 'Has moved' };
}
type Tense = ReturnType<typeof tense>;

// THE NUMBER HELD, SO THE PRICE IS WHAT MOVED -- and the price is stated as the
// de-vigged win probability, not a moneyline: the market moneyline is a MEDIAN,
// and a median of -143 and -144 is -143.5, which no book ever posted (the same
// reason game-line.tsx carries no moneyline). The team is the open's favourite,
// fixed, so every number in the sentence is one team's chance.
function probabilityStill(m: LineMovement, home: string, away: string, t: Tense): string {
  const open = m.open!;
  const homeFav = (open.homeWinProb ?? 0.5) >= 0.5;
  const team = homeFav ? home : away;
  const p = (x: number) => pct(homeFav ? x : 1 - x);
  const r = m.range!.homeWinProb;
  const [lo, hi] = homeFav ? [r.min, r.max] : [1 - r.max, 1 - r.min];
  const head = `${team} opened at ${p(open.homeWinProb!)} to win on ${day(open.at)}`;
  return pct(lo) === pct(hi)
    ? `${head}, ${t.since}.`
    : `${head}, ${t.ranged} ${pct(lo)}–${pct(hi)}.`;
}

// The sentences both short forms are made of: the familiar number's open and
// range (the spread; or, when the spread number held, the win probability),
// and the total's. Shared by the one-line form and by the full module when it
// is shown for the excursion alone, so the two never describe a range twice.
function stillParts(m: LineMovement, home: string, away: string, t: Tense): { lead: string; leadIsProbability: boolean; total: string | null } {
  const open = m.open!; const current = m.current!; const range = m.range!;
  const sr = range.homeSpread;
  let lead: string; let leadIsProbability = false;
  if (open.homeSpread !== null && current.homeSpread !== null && sr && sr.min !== sr.max) {
    lead = `Opened ${spreadPhrase(open, home, away)} on ${day(open.at)}, ${t.traded} `
      + `${spreadRange(sr, open.homeSpread, home, away)}.`;
  } else {
    // THE NUMBER HELD, so the PRICE is the familiar number -- the same rule as
    // the full module's lead. Hockey's puck line and baseball's run line sit at
    // 1.5 by construction; "-1.5, unchanged" would be true and say nothing.
    lead = (sr && open.homeSpread !== null ? `${spreadPhrase(open, home, away)} throughout. ` : '')
      + probabilityStill(m, home, away, t);
    leadIsProbability = true;
  }
  const tr = range.total;
  const total = open.total !== null && current.total !== null && tr
    ? (tr.min === tr.max
      ? `Total opened ${num(open.total)}, ${t.since}.`
      : `Total opened ${num(open.total)}, ${t.traded} between ${num(tr.min)} and ${num(tr.max)}.`)
    : null;
  return { lead, leadIsProbability, total };
}

function describeStill(m: LineMovement, home: string, away: string, closed: boolean): StillCopy {
  const { open, current, range } = m;
  // History, but never openMinOperators at once: there is no market line to
  // state, and the line says exactly why.
  if (!open || !current || !range) {
    const n = m.maxBookCount;
    const books = `${n} independent sportsbook${n === 1 ? '' : 's'}`;
    return {
      kind: 'line',
      text: closed
        ? `No market line: at most ${books} posted this game at once before it started, and a line here takes ${m.openMinOperators}.`
        : `No market line yet: at most ${books} ${n === 1 ? 'has' : 'have'} posted this game at once, and a line here takes ${m.openMinOperators}.`,
    };
  }
  const { lead, total } = stillParts(m, home, away, tense(closed));
  return { kind: 'line', text: total ? `${lead} ${total}` : lead };
}

export function describeLineMovement(
  m: LineMovement | null,
  home: string,
  away: string,
  closed = false,          // the game has started: the last point is the close -- see TENSE
): MovementCopy | StillCopy | null {
  const t = tense(closed);
  // NOTHING only when nothing is held (or the request failed -- then there is
  // nothing to state either, and the page has its own error handling).
  if (!m || m.historyRows === 0) return null;
  if (!m.open || !m.current || !m.delta || !m.moved) return describeStill(m, home, away, closed);
  const { open, current, delta } = m;
  if (open.homeWinProb === null || current.homeWinProb === null) return describeStill(m, home, away, closed);

  // SHOWN WITHOUT THE DELTA TEST (the probability excursion or the total fired),
  // the ends are within the floor and the PATH is the news: the lead and total
  // are the range sentences of the one-line form.
  const still = m.movedBy.delta ? null : stillParts(m, home, away, t);

  // The annotation is about the side favoured NOW, so it reads in one direction.
  const homeNow = current.homeWinProb >= 0.5;
  const side = homeNow ? home : away;
  const pOpen = homeNow ? open.homeWinProb : 1 - open.homeWinProb;
  const pNow = homeNow ? current.homeWinProb : 1 - current.homeWinProb;

  // The spread number ended where it opened: the PRICE moved, and the price is
  // stated as win probability -- see THE FAMILIAR NUMBER LEADS.
  const spreadMoved = delta.homeSpread !== null && delta.homeSpread !== 0;
  const sr = m.range?.homeSpread ?? null;
  const held = sr !== null && open.homeSpread !== null && sr.min === sr.max
    ? `${spreadPhrase(open, home, away)} throughout. ` : '';
  const lead = still ? still.lead
    : spreadMoved
      ? `Opened ${spreadPhrase(open, home, away)} on ${day(open.at)}.`
      : `${held}${side} opened at ${pct(pOpen)} to win.`;
  const leadIsProbability = still ? still.leadIsProbability : !spreadMoved;

  const total = still
    ? (m.range?.total && m.range.total.min !== m.range.total.max ? still.total : null)
    : delta.total !== null && delta.total !== 0 && open.total !== null && current.total !== null
      ? `Total opened ${num(open.total)}.`
      : null;

  // At the OPEN only; the current or closing probability is the line block's.
  // Named for the side favoured now, so it reads against that block's figure.
  const probability = leadIsProbability ? null : `${side} win probability ${pct(pOpen)} at open.`;

  // THE SIZE OF THE MOVE, in one plain sentence: "Moved 12 points toward
  // Jacksonville Jaguars on the spread, 34 percentage points in win probability,
  // and 8.5 points down on the total." Each part only when it moved. The
  // probability part is the difference of the two DISPLAYED percentages (block 1's
  // 78% less this block's 44%), so it is the number a reader would get by
  // subtracting, not an unrounded 33.9 beside them; and only when the delta test
  // fired -- below the floor a sub-2-point figure is the noise the floor removes.
  const parts: string[] = [];
  let spreadToward: string | null = null;
  if (delta.homeSpread !== null && delta.homeSpread !== 0) {
    const pts = Math.abs(delta.homeSpread);
    spreadToward = delta.homeSpread < 0 ? home : away;   // home spread falling = home giving more
    parts.push(`${num(pts)} point${pts === 1 ? '' : 's'} toward ${spreadToward} on the spread`);
  }
  const shown = Math.round(pNow * 100) - Math.round(pOpen * 100);   // side = current favourite
  if (m.movedBy.delta && shown !== 0) {
    const toward = shown > 0 ? side : side === home ? away : home;
    parts.push(`${Math.abs(shown)} percentage point${Math.abs(shown) === 1 ? '' : 's'} in win probability`
      + (toward === spreadToward ? '' : ` toward ${toward}`));
  }
  if (delta.total !== null && delta.total !== 0) {
    const pts = Math.abs(delta.total);
    parts.push(`${num(pts)} point${pts === 1 ? '' : 's'} ${delta.total > 0 ? 'up' : 'down'} on the total`);
  }
  const size = parts.length === 0 ? null
    : `${t.moved} ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts[parts.length - 1]}`}.`;

  // WHEN, as a fact. "Most of it" only when that stretch really was most of it;
  // otherwise the biggest stretch is named as exactly that and nothing more.
  let when: string | null = null;
  const lm = m.largestMove;
  const totalOnly = !m.movedBy.delta && !m.movedBy.excursion && m.movedBy.total;
  if (totalOnly) {
    // SHOWN FOR THE TOTAL ALONE: where the total got furthest from its open,
    // unless that is where it ended (the line block states that value).
    const tm = m.totalMove;
    const at = tm ? m.series.find((p) => p.at === tm.at) : undefined;
    when = tm && at && at.total !== null && at.total !== current.total
      ? `Total furthest from the open: ${num(at.total)}, ${stampOf(tm.at)}.`
      : null;
  } else if (!m.movedBy.delta && m.excursion) {
    // SHOWN FOR THE EXCURSION ALONE: open and current are within the floor, so
    // "most of it came..." would measure against a move that did not happen.
    // Say where the line got furthest from the open, and when.
    const x = m.excursion;
    const at = m.series.find((p) => p.at === x.at);
    const pAt = at?.homeWinProb ?? null;
    // The spread there, unless it never moved (a fixed puck line says nothing).
    const where = at && sr && sr.min !== sr.max ? spreadPhrase(at, home, away) : null;
    const spreadTeam = at?.homeSpread != null && at.homeSpread !== 0 ? (at.homeSpread < 0 ? home : away) : null;
    // A DATE, not a weekday: the series spans days, often more than a week.
    const stamp = stampOf(x.at);
    const chance = pAt === null ? null : `${pct(homeNow ? pAt : 1 - pAt)} to win`;
    when = where
      ? `Furthest from the open: ${where}${chance ? ` (${spreadTeam === side ? chance : `${side} ${chance}`})` : ''}, ${stamp}.`
      : `Furthest from the open: ${side}${chance ? ` ${chance}` : ''}, ${stamp}.`;
  } else if (lm) {
    // A DATE, not a weekday, for the same reason as the excursion sentence: the
    // series spans days, often more than a week ("Sun" named two different
    // Sundays on a series running Oct 27 to Nov 5).
    const withDay = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } as const;
    const start = etDateTime(lm.from, withDay);
    // Direction named as a team, from the stretch's own sign -- a fact, not a reason.
    const toward = lm.homeWinProbDelta > 0 ? home : away;
    if (lm.from === lm.to) {
      // ONE CHANGE -- the cliff in the sparkline. Named as an instant, because
      // "between 6:42 PM and 6:42 PM" would describe a stretch that did not exist.
      const at = etDateTime(lm.to, { ...withDay, zone: true });
      when = lm.shareOfTotal >= 0.5
        ? `Most of it came in a single move on ${at}.`
        : `The biggest move in any 3-hour stretch was ${pctPoints(lm.homeWinProbDelta)} `
          + `toward ${toward}, in a single move on ${at}.`;
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


  // The API's series is ALREADY the qualified one (3+ operators, a probability),
  // open its first point and current its last -- the same points the largest
  // move is computed over. Drawn as given, so the shape and the sentence agree;
  // no filtering here, which would be a second, possibly different, rule.
  // Points with no total hold the previous total, so the line is one series.
  let lastTotal = open.total ?? 0;
  const spark = totalOnly
    ? m.series.map((p) => (lastTotal = p.total ?? lastTotal))
    : m.series.map((p) => (homeNow ? p.homeWinProb! : 1 - p.homeWinProb!));

  const etDay = (iso: string) => etDateTime(iso, { month: 'short', day: 'numeric' });
  const sameDay = etDay(open.at) === etDay(current.at);
  const end = (iso: string) => (sameDay
    ? etDateTime(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : etDay(iso));

  return {
    kind: 'full', lead, total, probability, size, when, spark,
    sparkSide: totalOnly ? 'Total' : side, sparkUnit: totalOnly ? 'total' : 'probability',
    sparkFrom: end(open.at), sparkTo: end(current.at), sparkToLabel: t.close,
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
  values, label, unit, from, to, toLabel,
}: { values: number[]; label: string; unit: 'probability' | 'total'; from: string; to: string; toLabel: string }) {
  const atEnd = toLabel === 'Close' ? 'at the close' : 'now';
  const say = (v: number) => (unit === 'total' ? num(v) : pct(v));
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
        aria-label={`${label}${unit === 'total' ? '' : ' win probability'}, from ${say(values[0])} at open (${from}) `
          + `to ${say(values[values.length - 1])} ${atEnd} (${to})`}
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path className="linemove__sparkopen" d={dot(xy[0])} stroke="currentColor" strokeWidth="5"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={dot(xy[xy.length - 1])} stroke="currentColor" strokeWidth="7"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="linemove__sparkends" aria-hidden="true">
        {/* A total sparkline names the total at its open end: nothing else on the
            panel says the line is the total and not the probability. Its last
            value is the line block's, so it is not repeated here. */}
        {unit === 'total' ? (
          <>
            <span>Open total {say(values[0])} · {from}</span>
            <span>{toLabel} · {to}</span>
          </>
        ) : (
          <>
            <span>Open · {from}</span>
            <span>{toLabel} · {to}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

export function LineMovementModule({
  movement,
  home,
  away,
  closed = false,
}: {
  movement: LineMovement | null;
  home: string;
  away: string;
  closed?: boolean;        // live or final -- see TENSE
}) {
  const copy = describeLineMovement(movement, home, away, closed);
  if (!copy) return null;
  if (copy.kind === 'line') {
    return (
      <section className="linemove">
        <h2 className="linemove__title">Line movement</h2>
        {/* The same panel as the full form, so block 2 looks like one block
            whichever form it takes; still one line, no chart. */}
        <div className="linemove__panel">
          <p className="linemove__still">{copy.text}</p>
        </div>
      </section>
    );
  }
  return (
    <section className="linemove">
      <h2 className="linemove__title">Line movement</h2>
      <div className="linemove__panel">
        <p className="linemove__lead">{copy.lead}</p>
        {/* The sparkline sits under what it draws: for a total sparkline the
            total line moves down next to it. */}
        {copy.sparkUnit === 'total' ? (
          <>
            {copy.probability && <p className="linemove__prob">{copy.probability}</p>}
            {copy.total && <p className="linemove__line">{copy.total}</p>}
          </>
        ) : (
          <>
            {copy.total && <p className="linemove__line">{copy.total}</p>}
            {copy.probability && <p className="linemove__prob">{copy.probability}</p>}
          </>
        )}
        {copy.size && <p className="linemove__line">{copy.size}</p>}
        <Sparkline values={copy.spark} label={copy.sparkSide} unit={copy.sparkUnit} from={copy.sparkFrom} to={copy.sparkTo} toLabel={copy.sparkToLabel} />
        {copy.when && <p className="linemove__line">{copy.when}</p>}
      </div>
    </section>
  );
}
