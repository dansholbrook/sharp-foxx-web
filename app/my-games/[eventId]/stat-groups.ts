// ============================================================================
// THE FILING FORM'S FIELDS, GROUPED BY WHAT HAPPENED.
//
// ----------------------------------------------------------------------------
// GROUPS ARE ABOUT THE PERFORMANCE, NOT THE PLAYER.
//
// Football has twenty fields and no phone shows twenty inputs, so it needs
// blocks. The obvious cut is by POSITION, and it is the wrong one:
//
//   * A correspondent who has just minted "#23" off a jersey does not know the
//     position. They always know whether he threw it, ran it, caught it,
//     tackled someone or kicked it.
//   * Position is not exclusive. The quarterback who scrambles, the receiver who
//     returns kicks and the two-way player every small-school roster carries all
//     need two blocks at once, and a position-keyed form gives them one.
//
// So the blocks below are stat groups. Position never restricts which blocks
// exist -- it only decides which one starts OPEN (see positionOpens).
//
// !! THE RULE FOR AN UNKNOWN POSITION, AND WHY IT IS SAFE !!
// Unknown position -> nothing is pre-opened and the group chooser is the first
// thing on screen. That costs one tap and can never produce a wrong form.
//
// The reason this asymmetry is the right way round is in the server's schema:
// EVERY STAT FIELD IS OPTIONAL -- "a correspondent files what they saw, not a
// full box score" (stat-families.ts). So a block nobody opens files nothing,
// which means OVER-SHOWING COSTS A TAP AND UNDER-SHOWING LOSES A STAT. A lost
// stat is only recoverable through a correction, and only until the line locks.
// Given that, "every block reachable, at most one pre-opened" is correct and
// "only the block matching the position" is not.
//
// ----------------------------------------------------------------------------
// stat-families.ts IS THE SOURCE OF TRUTH FOR THE KEYS. This file is a labelled
// mirror of it, and the drift runs in the safe direction on purpose:
//
//   a field ADDED server-side   -> simply is not offered here. The line files
//                                  without it; nothing breaks.
//   a field REMOVED or RENAMED  -> the server's `.strict()` object rejects the
//                                  payload with a real sentence, which the
//                                  filing screen renders rather than swallows.
//
// Neither case silently writes a wrong number, which is the only property worth
// protecting across a duplicated list.
// ============================================================================

export interface StatField {
  key: string;
  label: string;
  /** Rendered under the input for the one or two fields where a number that
   *  looks fine is meaningless. Empty for everything else. */
  hint?: string;
}

export interface StatGroup {
  id: string;
  label: string;
  fields: StatField[];
}

const n = (key: string, label: string, hint?: string): StatField => ({ key, label, hint });

// ---- FOOTBALL: five blocks of 3-5. The only family that needs a chooser. ----
const FOOTBALL: StatGroup[] = [
  {
    id: 'passing',
    label: 'Passing',
    fields: [
      n('completions', 'Completions'),
      n('passAttempts', 'Attempts'),
      n('passingYards', 'Passing yards'),
      n('passingTd', 'Passing TD'),
      n('passingInt', 'Interceptions thrown'),
    ],
  },
  {
    id: 'rushing',
    label: 'Rushing',
    fields: [
      n('carries', 'Carries'),
      n('rushingYards', 'Rushing yards'),
      n('rushingTd', 'Rushing TD'),
    ],
  },
  {
    id: 'receiving',
    label: 'Receiving',
    fields: [
      n('receptions', 'Receptions'),
      n('receivingYards', 'Receiving yards'),
      n('receivingTd', 'Receiving TD'),
    ],
  },
  {
    id: 'defence',
    label: 'Defence',
    fields: [
      n('tackles', 'Tackles'),
      n('sacks', 'Sacks'),
      n('interceptions', 'Interceptions'),
      n('forcedFumbles', 'Forced fumbles'),
      n('fumblesLost', 'Fumbles lost'),
    ],
  },
  {
    id: 'kicking',
    label: 'Kicking',
    fields: [
      n('fieldGoalsMade', 'FG made'),
      n('fieldGoalsAtt', 'FG attempted'),
      n('extraPointsMade', 'XP made'),
      n('extraPointsAtt', 'XP attempted'),
    ],
  },
];

// ---- BASEBALL / SOFTBALL: two blocks. A pitcher's line and a batter's line
// are different jobs, and most players file only one of them. ----
const BASEBALL: StatGroup[] = [
  {
    id: 'batting',
    label: 'Batting',
    fields: [
      n('atBats', 'At bats'),
      n('runs', 'Runs'),
      n('hits', 'Hits'),
      n('doubles', 'Doubles'),
      n('triples', 'Triples'),
      n('homeRuns', 'Home runs'),
      n('rbi', 'RBI'),
      n('walks', 'Walks'),
      n('strikeouts', 'Strikeouts'),
      n('stolenBases', 'Stolen bases'),
    ],
  },
  {
    id: 'pitching',
    label: 'Pitching',
    fields: [
      // The one field on this page where a number that looks fine is
      // meaningless, so the rule is on screen rather than only in the 400.
      n('inningsPitched', 'Innings pitched', '6.1 = six and a third · 6.2 = six and two thirds · 6.3 does not exist'),
      n('hitsAllowed', 'Hits allowed'),
      n('runsAllowed', 'Runs allowed'),
      n('earnedRuns', 'Earned runs'),
      n('walksAllowed', 'Walks allowed'),
      n('strikeoutsPitched', 'Strikeouts'),
    ],
  },
];

// ---- The three single-block families. Fifteen fields and eleven fields are
// forms; they get no chooser because there is nothing to choose. ----
const BASKETBALL: StatGroup[] = [
  {
    id: 'all',
    label: 'Stat line',
    fields: [
      n('minutes', 'Minutes'),
      n('points', 'Points'),
      n('rebounds', 'Rebounds'),
      n('offensiveRebounds', 'Offensive rebounds'),
      n('assists', 'Assists'),
      n('steals', 'Steals'),
      n('blocks', 'Blocks'),
      n('turnovers', 'Turnovers'),
      n('fouls', 'Fouls'),
      n('fgMade', 'FG made'),
      n('fgAtt', 'FG attempted'),
      n('threeMade', '3PT made'),
      n('threeAtt', '3PT attempted'),
      n('ftMade', 'FT made'),
      n('ftAtt', 'FT attempted'),
    ],
  },
];

const VOLLEYBALL: StatGroup[] = [
  {
    id: 'all',
    label: 'Stat line',
    fields: [
      n('sets', 'Sets played'),
      n('kills', 'Kills'),
      n('attackErrors', 'Attack errors'),
      n('attackAttempts', 'Attack attempts'),
      n('assists', 'Assists'),
      n('serviceAces', 'Service aces'),
      n('serviceErrors', 'Service errors'),
      n('digs', 'Digs'),
      n('blockSolo', 'Solo blocks'),
      n('blockAssist', 'Block assists'),
      n('receptionErrors', 'Reception errors'),
    ],
  },
];

const SOCCER: StatGroup[] = [
  {
    id: 'all',
    label: 'Stat line',
    fields: [
      n('minutes', 'Minutes'),
      n('goals', 'Goals'),
      n('assists', 'Assists'),
      n('shots', 'Shots'),
      n('shotsOnGoal', 'Shots on goal'),
      n('saves', 'Saves'),
      n('goalsAgainst', 'Goals against'),
      n('fouls', 'Fouls'),
      n('offsides', 'Offsides'),
      n('yellowCards', 'Yellow cards'),
      n('redCards', 'Red cards'),
    ],
  },
];

// Keyed by the server's StatFamilyId, which arrives as `statKind` on the
// box-score payload. An unknown id means the sport has no family and the game
// cannot take stat lines at all — the screen says so rather than rendering an
// empty form.
export const GROUPS_BY_FAMILY: Record<string, StatGroup[]> = {
  football: FOOTBALL,
  basketball: BASKETBALL,
  baseball_softball: BASEBALL,
  volleyball: VOLLEYBALL,
  soccer: SOCCER,
};

// ----------------------------------------------------------------------------
// WHICH BLOCK OPENS FIRST, from the roster row's free-text position.
//
// Substring matching on a lowercased string, because `roster_players.position`
// is free text a correspondent typed -- "QB", "Quarterback", "qb/db" are all
// real. A miss is not a failure: it returns null, nothing pre-opens, and the
// chooser is what the correspondent sees. That is the same outcome as an unknown
// position, which is the point -- there is one behaviour for "we cannot tell",
// not two.
//
// Deliberately NOT exhaustive. It is a convenience that saves a tap when it
// fires, and costs a tap when it does not.
// ----------------------------------------------------------------------------
const POSITION_HINTS: Array<[test: string[], groupId: string]> = [
  [['qb', 'quarter'], 'passing'],
  [['rb', 'running back', 'tailback', 'fullback', 'hb'], 'rushing'],
  [['wr', 'receiver', 'te', 'tight end'], 'receiving'],
  [['db', 'lb', 'dl', 'safety', 'corner', 'linebacker', 'defensive', 'edge'], 'defence'],
  [['k', 'kicker', 'punter', 'p'], 'kicking'],
  [['p', 'pitcher', 'rhp', 'lhp', 'sp', 'rp'], 'pitching'],
];

export function positionOpens(
  groups: StatGroup[],
  position: string | null | undefined,
): string | null {
  // One group means no chooser and nothing to decide.
  if (groups.length <= 1) return groups[0]?.id ?? null;
  const p = (position ?? '').trim().toLowerCase();
  if (!p) return null;
  for (const [tests, groupId] of POSITION_HINTS) {
    if (!groups.some((g) => g.id === groupId)) continue;
    // ABBREVIATIONS MATCH WHOLE TOKENS; WORDS MATCH AS SUBSTRINGS, and the
    // distinction is load-bearing in both directions:
    //
    //   whole-token for short forms -- "p" must not fire on "prop" and "k" must
    //     not fire on "back", so the free text is split on non-letters and the
    //     abbreviation has to BE one of the tokens.
    //   substring for words -- "quarter" has to catch "quarterback", "corner"
    //     has to catch "cornerback", "defensive" has to catch "defensive end".
    //
    // Getting this wrong is quiet: an earlier version treated every entry as a
    // whole token, so "QB" pre-opened Passing and "Quarterback" pre-opened
    // nothing. Both are positions a correspondent really types, and the failure
    // was one extra tap rather than anything visible.
    //
    // Length is the proxy for "is this an abbreviation" -- 3 characters or
    // fewer. It covers qb/rb/wr/te/db/lb/dl/k/p/sp/rp/hb/rhp/lhp and leaves
    // every real word on the substring path.
    const tokens = p.split(/[^a-z]+/).filter(Boolean);
    const hit = tests.some((t) => (t.length <= 3 ? tokens.includes(t) : p.includes(t)));
    if (hit) return groupId;
  }
  return null;
}
