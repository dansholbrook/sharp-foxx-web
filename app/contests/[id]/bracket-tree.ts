// THE BRACKET TREE ALGEBRA — pure functions, no React, no fetch.
//
// Split out of bracket-board.tsx because this is the part with actual logic in
// it: everything else on that surface is rendering. Keeping it here means it can
// be reasoned about (and exercised) on its own, and it mirrors how the backend
// separates the same concern — bracket.type.ts holds resolveTree() and nothing
// that talks to a request.
//
// THE ONE RULE ALL OF THIS ENCODES: a slot's pick must be one of the two teams
// the fan's OWN earlier picks send there. Your finalist has to be someone you
// picked to win a semifinal. The backend rejects a tree that breaks it; this
// module makes it unbreakable on the way in, which is the difference between a
// fan being told "Inconsistent bracket" on submit and a fan never being able to
// build one.

import type { BracketConfigSlot } from '../../api';

// A slot's two candidates, resolved against the fan's OWN picks: a seed source
// always yields its seeded team, a winnerOf source yields whatever the fan picked
// in that feeder (null until they pick it).
//
// Ascending slot order makes this a single pass — validateConfig guarantees a
// feeder is always a LOWER slot number, so a feeder's pick is always already
// resolved by the time its consumer is read.
export function buildCandidates(
  slot: BracketConfigSlot,
  seedTeam: Map<number, string>,
  draft: Map<number, string>,
): [string | null, string | null] {
  const resolve = (src: BracketConfigSlot['from'][number]): string | null =>
    'seed' in src ? seedTeam.get(src.seed) ?? null : draft.get(src.winnerOf) ?? null;
  return [resolve(slot.from[0]), resolve(slot.from[1])];
}

// THE CONSISTENCY RULE, applied as a filter rather than discovered as a 400.
//
// Keep a pick only if it is still one of the two teams the fan's own earlier
// picks send to that slot. One ascending pass drops every pick a change
// invalidated, and it CASCADES for free: dropping the slot-5 pick re-reads
// slot-7's candidates against a now-empty slot 5, which drops slot 7 too.
// Changing your round-one upset therefore unwinds exactly the branch that
// depended on it and leaves the other branch of the tree alone.
export function reconcileDraft(
  slots: BracketConfigSlot[],
  seedTeam: Map<number, string>,
  draft: Map<number, string>,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const s of slots) {
    const current = draft.get(s.slot);
    if (!current) continue;
    const candidates = buildCandidates(s, seedTeam, out);
    if (candidates.includes(current)) out.set(s.slot, current);
  }
  return out;
}

// Round names counted BACK from the final, which is how anyone actually refers to
// them ("the semis"), and which needs no knowledge of the field size beyond the
// tree's own depth. Past the quarters the halving names itself.
export function roundLabel(round: number, maxRound: number): string {
  const fromEnd = maxRound - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}
