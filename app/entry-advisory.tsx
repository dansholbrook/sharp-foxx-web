// ============================================================================
// THE CONFLICT-OF-INTEREST ADVISORY — one render, seven surfaces.
//
// A correspondent assigned to an event cannot hold a position on it. Every
// entry-surface read carries the refusal (see EntryAdvisory in api.ts); this is
// the only place it becomes markup, so the treatment cannot drift between the
// Oracle, the Trail, the Call and the four contest boards.
//
// ----------------------------------------------------------------------------
// WHY IT IS `.notice` AND NOT `.error`, decided once, here, so no surface
// re-litigates it:
//
//   NOTHING WENT WRONG. This renders for someone being PAID to attend that
//   game. Their card is the grade sheet — that is the job working, not a fan
//   hitting a wall. `.notice` is the token for exactly this ("neither a failure
//   nor a win… must not be red (nothing went wrong)" — globals.css), and the
//   gold reads as a statement of fact rather than a refusal.
//
//   THE 403 IS THE OTHER CASE AND IT KEEPS `.error`. If a correspondent is
//   assigned between the read and the tap, their action genuinely failed and
//   they need to know it did. Different event, different treatment. The two are
//   deliberately not unified — see CoveringThisGameError in api.ts.
//
// THE SENTENCE IS SERVER-OWNED AND RENDERED VERBATIM. Nothing here writes copy,
// prefixes it, appends to it or pattern-matches it. The backend can retune the
// wording without a deploy, which is the entire reason it ships in the payload.
// The one thing this component may add is a `title` — a heading, never a gloss.
//
// AND THE CARD STAYS. Every caller renders this ALONGSIDE the greyed surface,
// never instead of it. A correspondent who covers tonight's game should still
// see the matchup, the split and the pot — hiding the card would answer a
// question ("what's on tonight?") they still have, and would make the advisory
// look like an outage.
// ============================================================================

import { EntryRefusal } from './api';

export function EntryAdvisoryNotice({
  refusal,
  // Layout only — a surface passes its own spacing class where the notice sits
  // somewhere the default margin doesn't suit. Never a color.
  className,
}: {
  refusal: EntryRefusal;
  className?: string;
}) {
  return (
    <p className={`notice${className ? ` ${className}` : ''}`}>{refusal.message}</p>
  );
}
