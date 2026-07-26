// ============================================================================
// THE COMPOSE FORM CATALOG — what each of the twelve templates ASKS FOR, what a
// sensible answer looks like for this sport, and what the question will read
// like once the server renders it.
//
// A MIRROR OF call-templates.ts, and only of the parts a form needs. What lives
// here: the exact param KEY NAMES, the bounds, the sport-aware defaults, and a
// local prompt/options preview. What does NOT live here: the list of which
// templates a sport may use. That comes down the wire as `availableTemplates`
// (already filtered by the event's sport, which is the authority), so a template
// retired on the backend leaves the picker without a deploy here.
//
// ----------------------------------------------------------------------------
// WHY A LOCAL PREVIEW AT ALL, when the server owns the prompt.
//
// The same reason ConsolePredictions previews its two option labels before
// opening a question: a correspondent picking `combined_points` and typing 45
// should see "more or fewer than 45?" as they type, not after a round trip. THIS
// IS A PREVIEW, NOT A PAYLOAD — nothing here is ever sent. The client posts
// { templateId, params } and the AUTHORITATIVE text comes back on the save
// response, which is what the screen switches to the moment it lands.
//
// If the two ever disagree, the server is right and this file is the bug.
// ----------------------------------------------------------------------------
//
// ----------------------------------------------------------------------------
// EVERY SCHEMA ON THE BACKEND IS .strict(), so an unknown key is a 400 rather
// than a silently-dropped field. That makes the key names load-bearing, and they
// are NOT uniform — this is the list, and it is the list that matters:
//
//   combined_points      { line }              int 1..999
//   longest_play         { yards }             int 1..109
//   first_to_n           { points }            int 1..999   (NOT `n`)
//   margin_bucket        { edges: [a, b] }     ints, ascending, floor 1
//   turnovers_bucket     { edges: [a, b] }     ints, ascending, floor 0
//   threes_bucket        { edges: [a, b] }     ints, ascending, floor 0
//   team_points_bucket   { team, edges }       'home' | 'away', floor 0
//   who_wins / overtime / half_scoring / halftime_lead / first_scorer_jersey
//                        {}                    no params at all
//
// The empty-param templates still get a schema on the backend, so sending
// { line: 5 } to `overtime` is a 400 too. buildParams() below only ever emits
// the keys a template declares.
// ----------------------------------------------------------------------------
//
// VALIDATING HERE IS NOT BELT-AND-BRACES. The shared client's error parser reads
// only `body.message` (api.ts toError), so the flattened Zod error naming the
// bad FIELD never reaches the screen — a param 400 would arrive as "Question 2:
// invalid params" with no way to tell which of two edges was wrong. Catching it
// at the input is the only way the composer learns what to fix.

import type { CallOption, CallTemplateId } from '../../api';

// The three shapes a param field can take on screen. Everything is an integer:
// the push templates are integer-lined ON PURPOSE (a .5 line would delete the
// push that three-valued grading exists to express), and no template takes a
// float.
export type CallParamField =
  | {
      kind: 'number';
      key: 'line' | 'yards' | 'points';
      label: string;
      min: number;
      max: number;
      // Sits after the input ("points", "yards") so the number reads as a
      // quantity rather than as a bare digit.
      unit: string;
    }
  | {
      kind: 'edges';
      key: 'edges';
      label: string;
      // The FLOOR of the first bucket, which differs by template: a winning
      // margin cannot be 0 (that is a tie, and a tie is a push), but a turnover
      // count can be — a clean game is a real outcome.
      floor: number;
      unit: string;
    }
  | {
      kind: 'side';
      key: 'team';
      label: string;
    };

// What the preview needs from the game. Mirrors CallContext.
//
// BOTH TEAM NAMES ARE REQUIRED, and the compose screen refuses to open without
// them: contextFor() throws a 409 for the WHOLE SAVE when either side is unset,
// so a card composed against a half-named game is five slots of work that cannot
// be saved. Same refusal ConsolePredictions makes with canAskWinner, one step
// earlier.
export interface CallComposeContext {
  sport: string;
  homeTeam: string;
  awayTeam: string;
}

export interface CallTemplateForm {
  id: CallTemplateId;
  // A one-line explanation under the picked template. The server's `label` is a
  // catalog name ("T3 - Combined points, more or fewer than N"); this is what
  // the question is FOR.
  hint: string;
  fields: CallParamField[];
  // A filled-in starting point for this sport. THE FIRST OF THE THREE CUTS: a
  // template that lands with an empty required field is a template that costs a
  // keyboard, and five of those is the 5-minute budget. Picking is an edit, not
  // an entry.
  defaults: (sport: string) => Record<string, unknown>;
  // The rendered pair, mirroring this template's prompt()/options().
  preview: (
    params: Record<string, unknown>,
    ctx: CallComposeContext,
  ) => { prompt: string; options: CallOption[] };
}

// ---------------------------------------------------------------------------
// param readers — params travels as Record<string, unknown> (it is what the
// wire type says and what jsonb hands back), so every read narrows.
// ---------------------------------------------------------------------------

function num(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function edgesOf(params: Record<string, unknown>): [number | null, number | null] {
  const v = params.edges;
  if (!Array.isArray(v)) return [null, null];
  const a = typeof v[0] === 'number' && Number.isFinite(v[0]) ? v[0] : null;
  const b = typeof v[1] === 'number' && Number.isFinite(v[1]) ? v[1] : null;
  return [a, b];
}

function sideOf(params: Record<string, unknown>): 'home' | 'away' {
  return params.team === 'away' ? 'away' : 'home';
}

// The placeholder a preview uses for a number the composer has not typed yet.
// Same "…" ConsolePredictions uses for an empty over/under line.
const BLANK = '…';

function shown(n: number | null): string {
  return n === null ? BLANK : String(n);
}

// bucketOptions, mirrored. Three options, keys POSITIONAL AND OPAQUE
// ('b0'/'b1'/'b2') because they must stay stable while an editor is still moving
// the edges around — a key like '8_to_14' would change meaning the moment an
// edge moved, and an entry stores the key.
function bucketOptions(
  a: number | null,
  b: number | null,
  floor: number,
  unit: string,
): CallOption[] {
  return [
    { key: 'b0', label: `${floor}-${shown(a)} ${unit}` },
    { key: 'b1', label: `${a === null ? BLANK : a + 1}-${shown(b)} ${unit}` },
    { key: 'b2', label: `${b === null ? BLANK : b + 1}+ ${unit}` },
  ];
}

// The two team options, home first — the order the backend emits.
function teamOptions(ctx: CallComposeContext): CallOption[] {
  return [
    { key: 'home', label: ctx.homeTeam },
    { key: 'away', label: ctx.awayTeam },
  ];
}

// ---------------------------------------------------------------------------
// Sport-aware defaults.
//
// These are STARTING POINTS A CORRESPONDENT WILL EDIT, not house numbers. They
// exist so no template ever lands with an empty required field; they are not
// tuned lines and nothing downstream reads them. `other` is the fallback for a
// sport with no entry, which is also what the `other` sport itself gets.
// ---------------------------------------------------------------------------

type SportTable<T> = Partial<Record<string, T>> & { other: T };

function bySport<T>(table: SportTable<T>, sport: string): T {
  return table[sport] ?? table.other;
}

const COMBINED_LINE: SportTable<number> = {
  basketball: 120,
  football: 45,
  soccer: 3,
  hockey: 6,
  baseball: 9,
  other: 50,
};

// RUNNING_SCORE sports only (basketball, football) — the picker will not offer
// this template anywhere else, so the table needs no other entries.
const FIRST_TO: SportTable<number> = {
  basketball: 50,
  football: 21,
  other: 30,
};

const MARGIN_EDGES: SportTable<[number, number]> = {
  basketball: [6, 15],
  football: [7, 17],
  soccer: [1, 2],
  hockey: [1, 3],
  baseball: [2, 4],
  other: [3, 10],
};

const TEAM_POINTS_EDGES: SportTable<[number, number]> = {
  basketball: [55, 75],
  football: [17, 28],
  soccer: [0, 1],
  hockey: [1, 3],
  baseball: [2, 5],
  other: [20, 40],
};

const TURNOVER_EDGES: SportTable<[number, number]> = {
  basketball: [10, 16],
  football: [1, 3],
  other: [2, 5],
};

// ---------------------------------------------------------------------------
// THE TWELVE, in the registry's order.
// ---------------------------------------------------------------------------

export const CALL_TEMPLATE_FORMS: Record<CallTemplateId, CallTemplateForm> = {
  who_wins: {
    id: 'who_wins',
    hint: 'The anchor question. No parameters, and it cannot push — somebody wins, or the whole Call voids.',
    fields: [],
    defaults: () => ({}),
    preview: (_p, ctx) => ({
      prompt: `Who wins: ${ctx.awayTeam} or ${ctx.homeTeam}?`,
      options: teamOptions(ctx),
    }),
  },

  margin_bucket: {
    id: 'margin_bucket',
    hint: 'Three margin bands. The floor is 1 — a margin of zero is a tie, which you resolve as a push rather than a bucket.',
    fields: [{ kind: 'edges', key: 'edges', label: 'Bucket edges', floor: 1, unit: 'points' }],
    defaults: (sport) => ({ edges: bySport(MARGIN_EDGES, sport) }),
    preview: (p) => {
      const [a, b] = edgesOf(p);
      return {
        prompt: `What is the winning margin? (${shown(a)} or fewer, ${
          a === null ? BLANK : a + 1
        }-${shown(b)}, or ${b === null ? BLANK : b + 1}+)`,
        options: bucketOptions(a, b, 1, 'points'),
      };
    },
  },

  combined_points: {
    id: 'combined_points',
    hint: 'A PUSH TEMPLATE. The line is an integer on purpose, so landing exactly on it is reachable — and nobody wins that one.',
    fields: [{ kind: 'number', key: 'line', label: 'Line', min: 1, max: 999, unit: 'points' }],
    defaults: (sport) => ({ line: bySport(COMBINED_LINE, sport) }),
    preview: (p) => {
      const line = num(p, 'line');
      return {
        prompt: `Combined points scored by both teams: more or fewer than ${shown(
          line,
        )}? (exactly ${shown(line)} is a push)`,
        options: [
          { key: 'more', label: `More than ${shown(line)}` },
          { key: 'fewer', label: `Fewer than ${shown(line)}` },
        ],
      };
    },
  },

  first_to_n: {
    id: 'first_to_n',
    hint: 'If NEITHER team reaches the number, resolve it void — that is a question with no answer, not a push.',
    fields: [{ kind: 'number', key: 'points', label: 'Target', min: 1, max: 999, unit: 'points' }],
    defaults: (sport) => ({ points: bySport(FIRST_TO, sport) }),
    preview: (p, ctx) => {
      const points = num(p, 'points');
      return {
        prompt: `Which team reaches ${shown(points)} points first, ${ctx.awayTeam} or ${
          ctx.homeTeam
        }?`,
        options: teamOptions(ctx),
      };
    },
  },

  overtime: {
    id: 'overtime',
    hint: 'The cheapest question on the card to grade from the stands. Every card wants at least one you cannot miss.',
    fields: [],
    defaults: () => ({}),
    preview: () => ({
      prompt: 'Does this game go to overtime?',
      options: [
        { key: 'yes', label: 'Yes, overtime' },
        { key: 'no', label: 'No overtime' },
      ],
    }),
  },

  team_points_bucket: {
    id: 'team_points_bucket',
    hint: 'One named side, three bands. The side is stored as home/away, so a team rename cannot strand the question.',
    fields: [
      { kind: 'side', key: 'team', label: 'Which team' },
      { kind: 'edges', key: 'edges', label: 'Bucket edges', floor: 0, unit: 'points' },
    ],
    defaults: (sport) => ({ team: 'home', edges: bySport(TEAM_POINTS_EDGES, sport) }),
    preview: (p, ctx) => {
      const [a, b] = edgesOf(p);
      const side = sideOf(p);
      return {
        prompt: `How many points does ${side === 'home' ? ctx.homeTeam : ctx.awayTeam} score?`,
        options: bucketOptions(a, b, 0, 'points'),
      };
    },
  },

  longest_play: {
    id: 'longest_play',
    hint: 'A PUSH TEMPLATE, football only. Exactly the number is a push.',
    fields: [{ kind: 'number', key: 'yards', label: 'Yards', min: 1, max: 109, unit: 'yards' }],
    defaults: () => ({ yards: 40 }),
    preview: (p) => {
      const yards = num(p, 'yards');
      return {
        prompt: `The longest scoring play of the game: more or fewer than ${shown(
          yards,
        )} yards? (exactly ${shown(yards)} is a push)`,
        options: [
          { key: 'more', label: `More than ${shown(yards)} yards` },
          { key: 'fewer', label: `Fewer than ${shown(yards)} yards` },
        ],
      };
    },
  },

  half_scoring: {
    id: 'half_scoring',
    hint: 'A PUSH TEMPLATE, and the one that needs no parameter to reach it — two halves scoring the same is common.',
    fields: [],
    defaults: () => ({}),
    preview: () => ({
      prompt: 'Which half has more combined scoring? (an even split is a push)',
      options: [
        { key: 'first', label: 'First half' },
        { key: 'second', label: 'Second half' },
      ],
    }),
  },

  turnovers_bucket: {
    id: 'turnovers_bucket',
    hint: 'Three bands, floor 0 — a clean game is a real outcome, not an empty bucket.',
    fields: [{ kind: 'edges', key: 'edges', label: 'Bucket edges', floor: 0, unit: 'turnovers' }],
    defaults: (sport) => ({ edges: bySport(TURNOVER_EDGES, sport) }),
    preview: (p) => {
      const [a, b] = edgesOf(p);
      return {
        prompt: 'How many turnovers do both teams commit combined?',
        options: bucketOptions(a, b, 0, 'turnovers'),
      };
    },
  },

  halftime_lead: {
    id: 'halftime_lead',
    hint: 'A tie at the break is NOT a lead — it grades "no" rather than pushing, and the prompt says so out loud.',
    fields: [],
    defaults: () => ({}),
    preview: (_p, ctx) => ({
      prompt: `Is ${ctx.homeTeam} leading at halftime? (a tie at the break counts as no)`,
      options: [
        { key: 'yes', label: 'Yes, leading' },
        { key: 'no', label: 'No, tied or trailing' },
      ],
    }),
  },

  first_scorer_jersey: {
    id: 'first_scorer_jersey',
    hint: 'A coin flip on paper and the most-argued question on the card in practice.',
    fields: [],
    defaults: () => ({}),
    preview: () => ({
      prompt: "Is the first scorer's jersey number odd or even? (0 counts as even)",
      options: [
        { key: 'odd', label: 'Odd' },
        { key: 'even', label: 'Even' },
      ],
    }),
  },

  threes_bucket: {
    id: 'threes_bucket',
    hint: 'Basketball only. Three bands over both teams combined.',
    fields: [{ kind: 'edges', key: 'edges', label: 'Bucket edges', floor: 0, unit: 'threes' }],
    defaults: () => ({ edges: [10, 18] }),
    preview: (p) => {
      const [a, b] = edgesOf(p);
      return {
        prompt: 'How many three-pointers do both teams make combined?',
        options: bucketOptions(a, b, 0, 'threes'),
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Validation, mirroring the Zod bounds.
// ---------------------------------------------------------------------------

// One slot's params, or null if they are fine. ONE MESSAGE, not a field map: the
// slot shows a single line under its inputs, and "the second edge must be above
// the first" is the whole of what a composer needs to act on.
export function validateCallParams(
  templateId: CallTemplateId,
  params: Record<string, unknown>,
): string | null {
  const form = CALL_TEMPLATE_FORMS[templateId];
  for (const field of form.fields) {
    if (field.kind === 'number') {
      const v = num(params, field.key);
      if (v === null) return `${field.label} is required.`;
      if (!Number.isInteger(v)) return `${field.label} must be a whole number.`;
      if (v < field.min || v > field.max) {
        return `${field.label} must be between ${field.min} and ${field.max}.`;
      }
    }
    if (field.kind === 'edges') {
      const [a, b] = edgesOf(params);
      if (a === null || b === null) return 'Both bucket edges are required.';
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        return 'Bucket edges must be whole numbers.';
      }
      // The two schemas the backend applies: the first edge floors at the
      // template's floor and caps at 998, the second floors one above it and
      // caps at 999.
      if (a < field.floor || a > 998) {
        return `The first edge must be between ${field.floor} and 998.`;
      }
      if (b < field.floor + 1 || b > 999) {
        return `The second edge must be between ${field.floor + 1} and 999.`;
      }
      if (b <= a) return 'The second edge must be above the first.';
    }
    if (field.kind === 'side') {
      if (params.team !== 'home' && params.team !== 'away') {
        return 'Pick a team.';
      }
    }
  }
  return null;
}

// The params object to SEND for a slot: only the keys this template declares.
//
// EXTRA KEYS ARE A 400, not a shrug — every schema is .strict(), deliberately,
// so that a composer typo ("edge" for "edges") surfaces instead of producing a
// question with default-looking buckets nobody chose. Which means a slot that
// changed template must not carry the old one's keys along, and this is where
// that is guaranteed rather than in the reducer.
export function buildCallParams(
  templateId: CallTemplateId,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of CALL_TEMPLATE_FORMS[templateId].fields) {
    if (field.kind === 'edges') {
      const [a, b] = edgesOf(params);
      out.edges = [a, b];
    } else if (field.kind === 'side') {
      out.team = sideOf(params);
    } else {
      out[field.key] = num(params, field.key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tiebreaker.
// ---------------------------------------------------------------------------

// The scoring noun this sport uses, so a canned prompt does not ask a hockey
// crowd about "points".
function scoringNoun(sport: string): string {
  if (sport === 'soccer' || sport === 'hockey') return 'goals';
  if (sport === 'baseball') return 'runs';
  return 'points';
}

// THE SECOND OF THE THREE CUTS. The tiebreaker prompt is the only free-text
// field in the whole compose flow, and free text on a phone is where the five
// minutes go. Three chips cover what a tiebreaker is actually for — a number
// every fan can estimate and the correspondent can read off the scoreboard —
// with Edit as the escape for a correspondent who wants their own.
//
// Kept generic rather than interpolating team names: a prompt naming the home
// team reads oddly on a neutral-site game, and the card already names the
// matchup two lines above.
export function tiebreakerSuggestions(sport: string): string[] {
  const noun = scoringNoun(sport);
  return [
    `How many total ${noun} are scored by both teams combined?`,
    `What is the winning margin, in ${noun}?`,
    `How many ${noun} does the home team score?`,
  ];
}
