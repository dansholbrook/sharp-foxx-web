// ============================================================================
// CARD TREATMENT -- how a game thumbnail decides what it looks like.
//
// ONE HOME FOR TWO THINGS THAT MUST NOT DRIFT:
//   thumbClass(sport)        the sport gradient class
//   teamTreatment(event)     the two-team colour pair, or null
//
// thumbClass used to exist in THREE copies -- app/feed/page.tsx,
// app/search/page.tsx and app/games/page.tsx -- and had already begun to
// diverge: two closed over a set named SPORTS, the third over SPORT_SET. That
// is exactly how the team-mapping normalizers drifted before
// conference-match.ts pulled them into one file, and the cost there was a
// SILENT change in which rows auto-accepted. Adding a second, contrast-
// dependent input to three independent copies would have been the same bug with
// a bigger blast radius, so the consolidation is part of this change rather
// than a follow-up.
//
// PURE. No React, no DOM, no fetch. Everything here is a function of its
// arguments, so it can be reasoned about and tested without a browser.
// ============================================================================

import type { CSSProperties } from 'react';

import type { EventListItem } from './api';

// ---------------------------------------------------------------------------
// THE SPORT GRADIENT. Unchanged behaviour, single definition.
// ---------------------------------------------------------------------------
const SPORTS = new Set(['basketball', 'football', 'baseball', 'hockey', 'soccer', 'other']);

export function thumbClass(sport: string | null | undefined): string {
  const key = sport && SPORTS.has(sport) ? sport : 'other';
  return `thumb thumb--${key}`;
}

// ---------------------------------------------------------------------------
// THE GROUND. Every judgement below is relative to the card's own background,
// so this constant and --bg in globals.css are one value in two places; if the
// page ground ever changes, the gate's answers change with it.
// ---------------------------------------------------------------------------
const GROUND: RGB = [0x13, 0x11, 0x0d];

type RGB = [number, number, number];
type Oklab = [number, number, number];

// ---------------------------------------------------------------------------
// COLOUR MATHS. sRGB <-> OKLab, plus WCAG contrast.
//
// TWO DIFFERENT METRICS, ON PURPOSE, because one number cannot answer both
// questions this module asks:
//
//   "is this colour too dark to see on our ground"  -> CONTRAST RATIO, a
//   luminance measure, which is what it was designed for.
//
//   "can a fan tell these two teams apart"          -> OKLab DELTA-E, a
//   perceptual measure. Contrast ratio gets this WRONG: navy 002B5C and red
//   E31E34 sit at a ratio of ~1.0 against each other -- the score it gives two
//   identical colours -- while being obviously distinct to any viewer. An
//   earlier version of this gate used contrast ratio for the pair and refused
//   navy-against-red as "too alike".
// ---------------------------------------------------------------------------
function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function toSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function toOklab(rgb: RGB): Oklab {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function fromOklab([L, A, B]: Oklab): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}
function deltaE(a: RGB, b: RGB): number {
  const A = toOklab(a), B = toOklab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

// ---------------------------------------------------------------------------
// PARSING. Strict: the column is CHECK-constrained to six hex digits, so
// anything else here means a hand-edited row or a provider change, and the
// correct response is to decline the colour rather than repair it.
//
// Three-digit hex IS valid CSS, and is still refused -- cbb TeamID 317 returns
// "fff" and the backfill already declines to expand it. Accepting it here would
// create a path where the database says NULL and the card says white.
// ---------------------------------------------------------------------------
function parseHex(raw: string | null | undefined): RGB | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}
function toHex(rgb: RGB): string {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------------------------------------------------------------------------
// THE MIX. Lives HERE and is handed to CSS as a literal hex value.
//
// THIS MUST NOT BECOME color-mix() IN THE STYLESHEET. The gate judges the
// colours the card renders; if CSS performed the mix, the gate would be
// measuring one set of colours while the card painted another, and every
// threshold below would describe a card nobody sees. That exact divergence --
// delta-E computed on raw hex while the card rendered mixed values -- is a bug
// this module already had once.
//
// TEAM_WEIGHT is 1 today: full team colour, no darkening. It is kept as a
// parameter rather than deleted because it is the one global restraint control
// if the feed ever reads as too loud -- but note it is a BLUNT one. Lowering it
// darkens all ~1,000 cards and costs some of them their actual primary (the
// darkened version can fall under gate A), to solve what is usually a
// one-card problem. Prefer a clause in gate B, or a clamp on the specific
// offender, decided against the live page.
// ---------------------------------------------------------------------------
export const TEAM_WEIGHT = 1;

function groundMix(rgb: RGB, amount: number): RGB {
  if (amount >= 1) return rgb;
  const A = toOklab(rgb), G = toOklab(GROUND);
  return fromOklab([0, 1, 2].map((i) => A[i] * amount + G[i] * (1 - amount)) as Oklab);
}

// ---------------------------------------------------------------------------
// THE GATES. A and B qualify one colour; C qualifies the pair. All three run on
// POST-MIX values -- the colours the card actually paints.
// ---------------------------------------------------------------------------

// A -- visible against the card's own ground. Keeps a near-black primary from
// rendering a card that looks broken rather than branded: Baltimore's 000000,
// Chicago's 0B162A, Carolina's 000000. Deliberately loose at 1.20; a full-card
// field is perceived far more readily than text (WCAG's thresholds are
// calibrated for glyphs), and the card carries a 1px border that delineates it
// regardless.
const GROUND_MIN_CONTRAST = 1.20;

// B -- not a washed-out card. BOTH TERMS ARE LOAD-BEARING; do not simplify this
// to a lightness ceiling.
//
//   A lightness ceiling alone throws out saturated team YELLOWS -- the Rams'
//   FFD100, the Cardinals' FEDB00, the Packers' FFB612 -- because they sit as
//   high on L as white does. Those are among the most recognisable colours we
//   hold, and losing them is silent: the card still renders, just in some other
//   colour, and nobody is told.
//
//   The chroma term is what separates "light because it is white" from "light
//   because it is yellow".
//
// WHY THE GATE EXISTS AT ALL, since the matchup text is protected locally and
// no longer needs the field to be dark: without it the pair search picked
// WHITE for New Orleans against the Raiders' silver, in preference to the
// Saints' own gold. White beats gold on delta-E against silver because white
// differs from silver mostly in LIGHTNESS and delta-E counts that -- so the
// search was rewarded for discarding a team's actual identity in favour of a
// non-colour. The gate removes that option.
const LIGHT_MAX = 0.85;
const LIGHT_MIN_CHROMA = 0.05;

// C -- the two sides must be tellable apart. See the metric note above for why
// this is delta-E and not contrast ratio.
//
// At full team weight this floor almost never REFUSES a card (11 pairs of
// 1,122). What it mostly does is decide how early the search gives up on a
// team's primary -- it is a selection-quality knob, not a rejection knob.
// Measured at 0.15: Toronto/Miami stops being two dark reds (0.120) and becomes
// the Raptors' red against the Heat's orange (0.288). 0.18 costs 32 more cards
// their primary and was not observed to rescue anything.
const PAIR_MIN_DELTA_E = 0.15;

function usableField(raw: string | null | undefined): RGB | null {
  const parsed = parseHex(raw);
  if (!parsed) return null;
  const mixed = groundMix(parsed, TEAM_WEIGHT);
  if (contrastRatio(mixed, GROUND) < GROUND_MIN_CONTRAST) return null;   // A
  const [L, a, b] = toOklab(mixed);
  if (L > LIGHT_MAX && Math.hypot(a, b) < LIGHT_MIN_CHROMA) return null; // B
  return mixed;
}

export interface TeamTreatment {
  /** CSS hex for the home half, e.g. "#E31837". Ready to assign; already mixed. */
  home: string;
  /** CSS hex for the away half. */
  away: string;
  /** OKLab delta-E between the two. Diagnostic only; nothing renders off it. */
  separation: number;
}

/**
 * Pick the colour pair for a matchup, or null when the card should keep its
 * sport gradient.
 *
 * NULL IS A FIRST-CLASS ANSWER, not a failure: no colours, nothing usable, or
 * nothing distinguishable all mean "render exactly what this card renders
 * today". Callers must not substitute a default colour.
 */
export function teamTreatment(
  home: readonly (string | null | undefined)[],
  away: readonly (string | null | undefined)[],
): TeamTreatment | null {
  const h = home.map(usableField);
  const a = away.map(usableField);

  // RANK-PREFERRING, NOT SEPARATION-MAXIMISING. Search the candidate pairs in
  // increasing order of how far each side has strayed from its primary, and
  // take the FIRST that clears the floor.
  //
  // Maximising separation instead scores better on paper and is wrong: it
  // renders Toronto's Blue Jays RED, because red sits further from Tampa Bay's
  // navy than the Jays' own blue does. A team's identity outranks a cleaner
  // split, so the search spends its freedom only when it must.
  const candidates: { cost: number; i: number; j: number; h: RGB; a: RGB }[] = [];
  for (let i = 0; i < h.length; i++) {
    for (let j = 0; j < a.length; j++) {
      const hi = h[i], aj = a[j];
      if (hi && aj) candidates.push({ cost: i + j, i, j, h: hi, a: aj });
    }
  }
  candidates.sort((x, y) => x.cost - y.cost || x.i - y.i || x.j - y.j);

  for (const c of candidates) {
    const d = deltaE(c.h, c.a);
    if (d >= PAIR_MIN_DELTA_E) {
      return { home: toHex(c.h), away: toHex(c.a), separation: d };
    }
  }
  return null;
}

/** Convenience over an event row, so call sites never index the palette by hand. */
export function eventTeamTreatment(event: EventListItem): TeamTreatment | null {
  return teamTreatment(
    [event.homePrimaryColor, event.homeSecondaryColor, event.homeTertiaryColor],
    [event.awayPrimaryColor, event.awaySecondaryColor, event.awayTertiaryColor],
  );
}

/**
 * The inline style for a thumbnail, and the class that activates the ramp.
 * Returns an empty object when there is no treatment, so a caller can spread it
 * unconditionally and get today's card.
 */
export function treatmentStyle(t: TeamTreatment | null): CSSProperties {
  if (!t) return {};
  return { ['--th' as string]: t.home, ['--ta' as string]: t.away };
}
