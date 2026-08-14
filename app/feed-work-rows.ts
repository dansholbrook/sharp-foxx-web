// ============================================================================
// WHICH THREE THINGS THE CORRESPONDENT'S WORK BAND SHOWS.
//
// Split out of feed-work.tsx and kept free of JSX for one reason: this is the
// only part of that band with a decision in it, and a decision that can only be
// checked by rendering the page and squinting is a decision nobody re-checks.
// scripts/proof-work-band.ts drives this function directly.
//
// The ORDER is the product call and it is stated here rather than inferred from
// the code below:
//
//   1. A Call that needs grading. The only row with money and a hard deadline
//      behind it -- 24 hours after kickoff the sweep washes the card and the pot
//      pays nobody.
//   2. A result nobody filed. No deadline of its own, but everything downstream
//      of a game waits on it.
//   3. A card still to write. Time-boxed by kickoff (publish refuses a started
//      game), so it is work with an end -- but a card nobody has entered yet
//      costs nobody anything if it slips, unlike 1.
//   4. Backfill: what they are covering next. Not owed, just coming.
//
// Ranking is by KIND, not by a computed urgency score across kinds. A score
// would need weights nobody has data for, and it would reorder the band between
// two loads for reasons the reader cannot see. Three stable rows beat three
// cleverly-ordered ones.
// ============================================================================

import {
  callListPhase,
  callHoursToVoid,
  hasKickedOff,
  CallListItem,
  MyAssignment,
} from './api';

// THREE. See the header of feed-work.tsx for why the cap is the point.
export const WORK_CAP = 3;

export type WorkRow =
  | { kind: 'grade'; key: string; call: CallListItem; matchup: string; hoursLeft: number | null }
  | { kind: 'result'; key: string; assignment: MyAssignment }
  | { kind: 'draft'; key: string; call: CallListItem; matchup: string; kickoff: string }
  | { kind: 'covering'; key: string; assignment: MyAssignment };

export function matchupOf(a: MyAssignment): string {
  const { awayTeam, homeTeam, sport } = a.event;
  return awayTeam && homeTeam ? `${awayTeam} at ${homeTeam}` : sport;
}

export function workRows(
  assignments: MyAssignment[] | null,
  calls: CallListItem[] | null,
  cap: number = WORK_CAP,
): WorkRow[] {
  const out: WorkRow[] = [];
  const mine = assignments ?? [];
  const assignedById = new Map(mine.map((a) => [a.event.id, a]));

  // ONE GAME, ONE ROW — and it is the most urgent thing that game needs, because
  // the kinds are appended in urgency order and the first one claims it.
  //
  // WITHOUT THIS, one game appears twice. A Saturday night game that is still
  // 'scheduled' AND carries a locked card is genuinely both "result not filed"
  // and "needs grading", so it earns a row in two passes: the reader sees the
  // same matchup twice, and a cap of three has been spent on two facts about one
  // game while a second game's overdue result falls off the bottom. Found by
  // scripts/proof-work-band.ts proof 2, which is why that proof exists.
  //
  // The row that wins is the grading one, and that is the right way round: it is
  // the one with a deadline and a pot behind it, and the workspace it links to
  // is where the result gets filed anyway, so nothing becomes unreachable.
  const claimed = new Set<string>();
  const claim = (eventId: string): boolean => {
    if (claimed.has(eventId)) return false;
    claimed.add(eventId);
    return true;
  };

  // THE CALL ROWS ARE SCOPED TO THIS PERSON'S OWN GAMES, and that filter is not
  // redundant with the API's. GET /arena/call/events narrows a field_rep to
  // their own cards -- but an RM gets their whole roster's and an admin gets the
  // platform's, and none of those are the reader's homework. Without this, an
  // admin's feed would open with somebody else's card to grade.
  const myCalls = (calls ?? []).filter((c) => assignedById.has(c.event.id));

  for (const c of myCalls) {
    if (out.length >= cap) break;
    if (callListPhase(c) !== 'locked') continue;
    if (!claim(c.event.id)) continue;
    out.push({
      kind: 'grade',
      key: `grade:${c.id}`,
      call: c,
      matchup: matchupOf(assignedById.get(c.event.id)!),
      hoursLeft: callHoursToVoid(c.locksAt),
    });
  }

  // The predicate is the codebase's own: scheduled AND kicked off is "a game
  // whose result nobody filed" -- see the note above isUpcomingEvent in api.ts.
  // A 'live' game is deliberately NOT here: it is a game being covered right
  // now, not one being neglected.
  for (const a of mine) {
    if (out.length >= cap) break;
    if (a.event.status !== 'scheduled' || !hasKickedOff(a.event.scheduledAt)) continue;
    if (!claim(a.event.id)) continue;
    out.push({ kind: 'result', key: `result:${a.id}`, assignment: a });
  }

  for (const c of myCalls) {
    if (out.length >= cap) break;
    if (callListPhase(c) !== 'draft') continue;
    // A draft whose game has already started is past saving -- publish refuses
    // a started game -- so it is not shown as work. Saying what became of it is
    // the desk's job, not this band's.
    if (hasKickedOff(c.event.scheduledAt)) continue;
    if (!claim(c.event.id)) continue;
    out.push({
      kind: 'draft',
      key: `draft:${c.id}`,
      call: c,
      matchup: matchupOf(assignedById.get(c.event.id)!),
      kickoff: c.event.scheduledAt,
    });
  }

  // Soonest first -- the opposite of the fan-facing sort, and right for the same
  // reason /my-games sorts ascending: the nearest game is the one being
  // prepared for.
  const upcoming = mine
    .filter((a) => a.event.status === 'scheduled' && !hasKickedOff(a.event.scheduledAt))
    .sort((x, y) => x.event.scheduledAt.localeCompare(y.event.scheduledAt));
  for (const a of upcoming) {
    if (out.length >= cap) break;
    if (!claim(a.event.id)) continue;
    out.push({ kind: 'covering', key: `covering:${a.id}`, assignment: a });
  }

  return out;
}
