'use client';

// ============================================================================
// THE SUNDAY RECAP — the week's points, arrived at.
//
// ############################################################################
// THERE IS NO REVEAL ANIMATION HERE, AND THERE MUST NOT BE ONE. READ THIS
// BEFORE ADDING A FLIP, A COUNT-UP, A "RUN THE SUNDAY REVEAL" BUTTON, OR
// CONFETTI. The design spec (sharp-foxx-arena.html § g5-recap) renders this
// screen as face-down cards flipped one at a time by a button, and that device
// was rejected deliberately.
//
// THE ARGUMENT THAT DECIDES IT: POSITIVE-ONLY SCORING REMOVES THE DOWNSIDE A
// REVEAL NEEDS, SO THE ANIMATION MANUFACTURES SUSPENSE THE MECHANIC REFUSES TO
// SUPPLY.
//
// A reveal is a format for resolving uncertainty with stakes on both sides. It
// builds tension by withholding an outcome that could be bad. This game has no
// bad outcome — by rule, the worst week a prospect can have is zero, there are
// no deductions, and nothing on a card can go down. So the flip has nothing to
// resolve. The only way the sequence pays off is if some of the flips land as
// disappointments, which means the animation has to reintroduce, as theatre,
// exactly the downside the compliance rule exists to remove. The spec's own
// mockup demonstrates this: it needs one `jack: true` prospect with a +500 and
// confetti to make the sequence land, which is another way of saying the other
// three flips exist to be the ones that weren't it.
//
// AND THE SUBJECTS ARE REAL NAMED PEOPLE. A face-down card reading "? ? ?" over
// a nineteen-year-old's actual week turns a stranger's life into a scratch
// card, and the flip whose payoff is "not this one" is doing that to a person
// who consented to be scouted, not to be a letdown. Worst of all is the zero
// case: `lines.missing > 0` means WE have not filed the line, and animating our
// own unfinished work as their flat week is the screen doing something to
// somebody.
//
// The precedent is Bureau Clash's rejected "play the resolve" button (see
// docs/design/clash-copy-note.md in the API repo): the fan resolves nothing
// here, the week is already scored and paid, and a button that pretends
// otherwise is asking them to perform a causation they do not have.
//
// WHAT IS KEPT: the per-prospect breakdown, the ordering, the total, and rank
// movement. Rank movement is the one genuine moment on this screen and it is
// about the FAN, not about an athlete — which is the only place any emphasis
// belongs.
// ############################################################################

import {
  ScoutRecap,
  ScoutRevealSlot,
  isScoutRecapScored,
  scoutBonusLabel,
  scoutLinesLine,
  scoutPoints,
  scoutRankMove,
  scoutStatKindLabel,
} from '../../api';
import Link from 'next/link';

export function RecapBand({
  recap,
  loading,
  failed,
}: {
  recap: ScoutRecap | null;
  loading: boolean;
  failed: boolean;
}) {
  // A recap that hasn't loaded or has nothing in it says nothing at all. This
  // band self-hides rather than showing a placeholder for a week that does not
  // exist — the same discipline the hub's streak strip keeps.
  if (loading || failed || !recap) return null;

  if (!isScoutRecapScored(recap)) {
    // The pending branches all carry a server-written sentence. It is rendered
    // verbatim: the backend distinguishes "no week has been scored yet" from
    // "week 9 has not been scored yet" from "you had no book this season", and
    // a client that flattened those to one line would lie about at least two.
    return (
      <section className="scout-recap" aria-labelledby="scout-recap-h">
        <h2 className="scout-band__title" id="scout-recap-h">
          The Sunday recap
        </h2>
        <p className="scout-quiet">{recap.reason}</p>
      </section>
    );
  }

  const move = scoutRankMove(recap.rank, recap.previousRank);
  // Negative movement means climbed (450 → 12 is −438).
  const climbed = recap.rankMovement != null && recap.rankMovement < 0;

  return (
    <section className="scout-recap" aria-labelledby="scout-recap-h">
      <div className="scout-band__head">
        <h2 className="scout-band__title" id="scout-recap-h">
          The Sunday recap
        </h2>
        <span className="scout-band__count">Week {recap.week.weekNo}</span>
      </div>

      {/* THE HONESTY FLAG, and it comes FIRST when it fires. `reconciles` is
          false when the per-slot attribution below does not sum to the total
          the ledger actually paid. The screen says so rather than presenting
          either number as the truth — narrating a week nobody was paid is
          worse than admitting the discrepancy. */}
      {!recap.reconciles && (
        <p className="scout-error">
          These rows don&rsquo;t add up to the total your account was paid. The
          paid total is {recap.total} &mdash; we&rsquo;re looking at why the
          breakdown disagrees.
        </p>
      )}

      <ul className="scout-reveal">
        {recap.slots.map((s) => (
          <RevealRow key={s.prospectCardId} slot={s} />
        ))}
      </ul>

      <div className="scout-total">
        <span className="scout-total__label">Book total · week {recap.week.weekNo}</span>
        <span className="scout-total__value">{recap.total}</span>
      </div>

      {move && (
        <p className="scout-rank">
          Season rank{' '}
          <strong className={climbed ? 'scout-rank--up' : undefined}>{move}</strong>
        </p>
      )}
    </section>
  );
}

function RevealRow({ slot }: { slot: ScoutRevealSlot }) {
  const total = scoutPoints(slot.totalCenti);
  return (
    <li className="scout-reveal__row">
      <Link href={`/arena/scout/${slot.prospectCardId}`} className="scout-reveal__main">
        <span className="scout-reveal__name">{slot.name}</span>
        <span className="scout-reveal__meta">
          {[slot.school, scoutStatKindLabel(slot.statKind), slot.position]
            .filter(Boolean)
            .join(' · ')}
        </span>

        {/* --------------------------------------------------------------
            THE THREE ZERO-STATES, NAMED. This line is why a zero on this
            screen is fair. `counted`, `didNotPlay` and `missing` are separate
            fields on the wire on purpose:
              counted    — they played, and this is what the week scored.
              didNotPlay — they did not play. Nothing happened to them.
              missing    — WE have not filed the line. Our failure, not theirs.
            Collapsing them into "0" throws away the only thing that makes the
            zero honest, and in the `missing` case reports our own outstanding
            work as a flat week for a real person. It renders always, not only
            when the total is zero, so it never reads as an excuse that only
            appears on bad news.
            -------------------------------------------------------------- */}
        <span className="scout-reveal__lines">{scoutLinesLine(slot.lines)}</span>

        <span className="scout-reveal__chips">
          {slot.loyal && <span className="scout-tag scout-tag--gold">Loyalty applied</span>}
          {slot.bonuses.map((b) => (
            <span key={b} className="scout-tag">
              {scoutBonusLabel(b)}
            </span>
          ))}
          {slot.retired && <span className="scout-tag scout-tag--closed">Card closed</span>}
        </span>
      </Link>

      <span className="scout-reveal__pts">
        <span className="scout-reveal__ptsn">{total}</span>
        <span className="scout-reveal__ptsl">
          {total === 1 ? 'point' : 'points'}
        </span>
      </span>
    </li>
  );
}
