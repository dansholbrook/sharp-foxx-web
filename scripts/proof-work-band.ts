// ============================================================================
// PROOFS for the correspondent work band's ROW SELECTION (app/feed-work-rows.ts).
//
//   (no ts-node in this project — the dependency list is deliberately three, so it
//   is run with the API project's, from sharp-foxx-api:)
//
//   npx ts-node --skip-project --compiler-options \
//     '{"module":"commonjs","target":"es2021","moduleResolution":"node","esModuleInterop":true,"strict":true,"lib":["es2021","dom"]}' \
//     ../sharp-foxx-web/scripts/proof-work-band.ts
//
// No network, no React, no database -- workRows() is a pure function of two
// arrays, which is the whole reason it was split out of the component. What is
// under test is the set of product decisions in that file: what counts as work,
// which order it comes in, whose work it is, and where the band stops.
//
// THE THREE THAT MATTER MOST, because they are the ones that would be wrong
// quietly rather than visibly:
//
//   PROOF 4 -- an admin is not shown somebody else's card. GET /arena/call/events
//     returns the whole platform to an admin, so the assignment filter is the
//     only thing between that and a feed opening with another rep's homework.
//   PROOF 5 -- the cap holds under load. The band leads the mobile column; an
//     unbounded one IS the column, because .fmain is display:contents there.
//   PROOF 6 -- a live game is not "overdue". It is a game being covered right
//     now, and nagging someone mid-game is how a band gets ignored.
// ============================================================================

import { workRows } from '../app/feed-work-rows';
import { CallListItem, MyAssignment } from '../app/api';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const HOUR = 3600_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

function assignment(
  id: string,
  eventId: string,
  status: MyAssignment['event']['status'],
  kickoffMs: number,
): MyAssignment {
  return {
    id, status: 'accepted', source: 'assigned', notes: null,
    assignedBy: null, assignedAt: iso(-72 * HOUR),
    event: {
      id: eventId, sport: 'basketball', venue: 'The Gym', status,
      scheduledAt: iso(kickoffMs),
      homeTeamId: 'h', awayTeamId: 'a', homeTeam: 'Home', awayTeam: 'Away',
    },
  };
}

function call(
  id: string,
  eventId: string,
  status: CallListItem['status'],
  kickoffMs: number,
  extra: Partial<CallListItem> = {},
): CallListItem {
  return {
    id, weekStart: '2026-08-10', status,
    matchup: 'Away at Home',
    correspondent: { repId: 'rep-1', displayName: 'Dan' },
    event: { id: eventId, sport: 'basketball', status: 'scheduled', scheduledAt: iso(kickoffMs) },
    questionCount: 5, entryCount: 8,
    publishesAt: iso(kickoffMs - 48 * HOUR),
    // A published/locked card locks AT kickoff, which is what the phase test reads.
    locksAt: status === 'draft' ? null : iso(kickoffMs),
    // The real shape, not a cast through `unknown`. workRows never reads the
    // pot -- but a fixture that lies about the type is a fixture that stops
    // failing when the type changes, which is most of what these are for.
    pot: {
      snapshotted: true, basePoints: 500, perEntrantPoints: 2, bands: [],
    },
    ...extra,
  };
}

// ============================================================================
console.log('\nPROOF 1 -- nothing to do is no band');
// The common case for most staff on most days, and the reason the band can
// afford to lead the column when it does appear.
// ============================================================================
{
  eq('no assignments, no calls', workRows(null, null), []);
  eq('empty arrays are the same as null', workRows([], []), []);
  eq('a game already played and filed is not work',
    workRows([assignment('a1', 'e1', 'final', -26 * HOUR)], []), []);
}

// ============================================================================
console.log('\nPROOF 2 -- a Call needing grading leads, whatever else is waiting');
// It is the only row with money and a hard deadline behind it.
// ============================================================================
{
  const rows = workRows(
    [
      assignment('a1', 'e1', 'scheduled', -30 * HOUR), // result overdue
      assignment('a2', 'e2', 'scheduled', -3 * HOUR),  // the Call's game
      assignment('a3', 'e3', 'scheduled', 48 * HOUR),  // covering later
    ],
    [call('c1', 'e2', 'locked', -3 * HOUR)],
  );
  eq('three rows, grading first', rows.map((r) => r.kind), ['grade', 'result', 'covering']);
  const grade = rows[0];
  check('it carries the entrant count the card actually has',
    grade.kind === 'grade' && grade.call.entryCount === 8);
  check('and the hours left, from locksAt + 24',
    grade.kind === 'grade' && grade.hoursLeft !== null
      && grade.hoursLeft > 20.9 && grade.hoursLeft < 21.1,
    `hoursLeft=${grade.kind === 'grade' ? grade.hoursLeft : 'n/a'}`);
}

// ============================================================================
console.log('\nPROOF 3 -- a card past its own deadline still shows, with the truth on it');
// The sweep runs every ten minutes, so a card CAN sit past 24h. Dropping it
// would hide the one row a correspondent most needs to see, and rounding the
// clock up would be a lie with a pot behind it.
// ============================================================================
{
  const rows = workRows(
    [assignment('a1', 'e1', 'final', -26 * HOUR)],
    [call('c1', 'e1', 'locked', -26 * HOUR)],
  );
  eq('still one grading row', rows.map((r) => r.kind), ['grade']);
  const g = rows[0];
  check('and the clock reads negative rather than being clamped',
    g.kind === 'grade' && g.hoursLeft !== null && g.hoursLeft < 0,
    `hoursLeft=${g.kind === 'grade' ? g.hoursLeft : 'n/a'}`);
}

// ============================================================================
console.log("\nPROOF 4 -- an admin is not handed somebody else's card");
// GET /arena/call/events returns EVERY Call to an admin and the roster's to an
// RM. The assignment filter is the only thing standing between that and a feed
// that opens with another correspondent's homework.
// ============================================================================
{
  const rows = workRows(
    [assignment('a1', 'MY-event', 'scheduled', 48 * HOUR)],
    [
      call('c1', 'SOMEONE-ELSES-event', 'locked', -2 * HOUR),
      call('c2', 'ANOTHER-event', 'draft', 72 * HOUR),
    ],
  );
  eq('neither foreign card became a row', rows.map((r) => r.kind), ['covering']);
  check('and the row that survived is the reader\'s own game',
    rows[0].kind === 'covering' && rows[0].assignment.event.id === 'MY-event');
}

// ============================================================================
console.log('\nPROOF 5 -- the cap holds, and it holds on the URGENT end');
// A band that grows with the workload becomes the page on a phone. What must
// survive truncation is the top of the list, not the bottom.
// ============================================================================
{
  const many: MyAssignment[] = [];
  for (let i = 0; i < 12; i++) many.push(assignment(`a${i}`, `e${i}`, 'scheduled', -(i + 2) * HOUR));
  const rows = workRows(many, [call('c1', 'e0', 'locked', -2 * HOUR)]);
  eq('exactly three rows out of thirteen candidates', rows.length, 3);
  eq('and the grading row is still first', rows[0].kind, 'grade');
  check('every remaining row is a real overdue result',
    rows.slice(1).every((r) => r.kind === 'result'));
}

// ============================================================================
console.log('\nPROOF 6 -- a live game is not an overdue result');
// 'scheduled AND kicked off' is the codebase's own definition of "nobody filed
// the result" (see the note above isUpcomingEvent). A 'live' game is one being
// covered right now; nagging someone mid-game is how a band gets ignored.
// ============================================================================
{
  eq('live in progress is not work owed',
    workRows([assignment('a1', 'e1', 'live', -1 * HOUR)], []).map((r) => r.kind), []);
  eq('the same game left scheduled IS',
    workRows([assignment('a1', 'e1', 'scheduled', -1 * HOUR)], []).map((r) => r.kind), ['result']);
  eq('postponed is not work owed either',
    workRows([assignment('a1', 'e1', 'postponed', -1 * HOUR)], []).map((r) => r.kind), []);
  eq('nor is canceled',
    workRows([assignment('a1', 'e1', 'canceled', -1 * HOUR)], []).map((r) => r.kind), []);
}

// ============================================================================
console.log('\nPROOF 7 -- a draft is work until kickoff, and not after');
// Publish refuses a game that has already started, so a draft whose game has
// begun is past saving. Showing it as a to-do would be sending someone to a
// button that cannot work.
// ============================================================================
{
  const before = workRows(
    [assignment('a1', 'e1', 'scheduled', 6 * HOUR)],
    [call('c1', 'e1', 'draft', 6 * HOUR, { questionCount: 2 })],
  );
  // ONE ROW, NOT TWO. This game is both "a card to write" and "one you're
  // covering", and the more urgent reading claims it. This expectation used to
  // read ['draft','covering'] and was wrong in the same way proof 2 caught:
  // a game the reader is both writing a card for and covering is one game.
  eq('before kickoff: the card to write, and NOT a second row for the same game',
    before.map((r) => r.kind), ['draft']);
  check('it carries the drafting progress',
    before[0].kind === 'draft' && before[0].call.questionCount === 2);

  const after = workRows(
    [assignment('a1', 'e1', 'scheduled', -1 * HOUR)],
    [call('c1', 'e1', 'draft', -1 * HOUR)],
  );
  eq('after kickoff: no draft row -- but the unfiled result still shows',
    after.map((r) => r.kind), ['result']);
}

// ============================================================================
console.log('\nPROOF 7b -- one game never occupies two rows, whatever it needs');
// THE FIX PROOF 2 FORCED. A game can legitimately satisfy several kinds at once
// -- still 'scheduled' past kickoff AND carrying a locked card is both "result
// not filed" and "needs grading". Two rows for one game reads as a bug to the
// person looking at it and, worse, spends a cap of three on one game while
// another's overdue result falls off the bottom.
// ============================================================================
{
  const rows = workRows(
    [
      assignment('a1', 'e1', 'scheduled', -5 * HOUR), // both grade AND result
      assignment('a2', 'e2', 'scheduled', -9 * HOUR), // a plain overdue result
    ],
    [call('c1', 'e1', 'locked', -5 * HOUR)],
  );
  eq('two games, two rows', rows.map((r) => r.kind), ['grade', 'result']);
  const eventIds = rows.map((r) =>
    r.kind === 'grade' || r.kind === 'draft' ? r.call.event.id : r.assignment.event.id);
  eq('and each row is a different game', eventIds, ['e1', 'e2']);
  check('the second game was NOT pushed off by a duplicate of the first',
    eventIds.includes('e2'));
}

// ============================================================================
console.log('\nPROOF 8 -- work coming, with nothing owed, is soonest-first');
// The opposite of the fan-facing sort, and right for the same reason /my-games
// sorts ascending: the nearest game is the one being prepared for.
// ============================================================================
{
  const rows = workRows(
    [
      assignment('a-late', 'e3', 'scheduled', 72 * HOUR),
      assignment('a-soon', 'e1', 'scheduled', 5 * HOUR),
      assignment('a-mid', 'e2', 'scheduled', 30 * HOUR),
    ],
    [],
  );
  eq('all three are "covering"', rows.map((r) => r.kind), ['covering', 'covering', 'covering']);
  eq('soonest first', rows.map((r) => (r.kind === 'covering' ? r.assignment.id : '')),
    ['a-soon', 'a-mid', 'a-late']);
}

// ============================================================================
console.log('\nPROOF 9 -- one read failing costs its own rows and nothing else');
// The component holds each read in its own try/catch and leaves the other at
// null. Both partial states have to produce a sane band rather than a crash.
// ============================================================================
{
  eq('assignments loaded, Calls failed (null)',
    workRows([assignment('a1', 'e1', 'scheduled', -2 * HOUR)], null).map((r) => r.kind),
    ['result']);
  // Calls without assignments produce NOTHING, and that is correct rather than
  // unfortunate: the scoping filter needs the assignment list to know whose
  // card it is, and guessing would be exactly proof 4's bug.
  eq('Calls loaded, assignments failed (null)',
    workRows(null, [call('c1', 'e1', 'locked', -2 * HOUR)]).map((r) => r.kind), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail > 0 ? 1 : 0);
