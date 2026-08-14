'use client';

// ============================================================================
// THE ANSWER SHEET — the whole of Correspondent's Call on one card.
//
// THE CORRESPONDENT IS THE HERO, not the game and not the questions. That is
// this card's equivalent of the Trail leading with a TOWN rather than a fixture:
// the entire proposition of this game is that a specific person is standing in
// that specific gym, and that five questions of what they can see are worth
// more than anything a model knows. Lead with the matchup and it reads as a
// weekly quiz with a byline; lead with the byline and it reads as a dispatch.
//
// FIVE STATES, one component, for the same reason the Oracle's card holds five
// and the Trail's seven — they are one card at five moments of its life, and
// splitting them would duplicate the byline, the matchup and the pot each time:
//
//   NO CALL  — call === null. "The correspondent files Thursday." Not an error.
//   OPEN     — the sheet: five questions, the tiebreaker, the sticky slip.
//              Renders the same whether or not an entry already exists; an
//              existing card hydrates the draft and the slip changes verb.
//   LOCKED   — kickoff passed. The card freezes as filed; nothing actionable.
//   GRADED   — the results view: the receipt, the answer key, the settlement.
//   VOIDED   — the week was washed and nothing was scored. THREE CAUSES, and
//              the card says which: the game was called off, the answers never
//              came back from the stands, or staff pulled it. See callVoidCopy.
//
// ----------------------------------------------------------------------------
// THE GRADED READING, TOP TO BOTTOM, AND WHY IT IS IN THAT ORDER.
//
//   THE RECEIPT LEADS. pointsAwarded is the big serif figure, with the correct
//   count as the headline beneath it — the Oracle's reveal exactly. The argument
//   is that the score is the one number on this screen a fan can COUNT off the
//   list below it, and the payment is the one they cannot get anywhere: it folds
//   participation, the per-correct, the Whistle and any pot share at prices that
//   can move after the grade. Leading with the derivable number and burying the
//   underivable one is backwards. And it is what the open card promised — that
//   card led with a purse, not with a quiz score.
//
//   ONE ADJUSTMENT TO THE ORACLE'S PATTERN: it renders points only on a win,
//   because a lost pick paid nothing. EVERY filed Call card pays — participation
//   is unconditional — so the figure is always there, including on the 0-for-5
//   card, which is what stops that card reading as a punishment.
//
//   THEN THE ANSWER KEY, then the tiebreaker — WITH CALLER OF THE WEEK UNDER IT,
//   because the title is what that guess won and it is worth no points — THEN
//   THE POT. The pot moves BELOW the key on this state alone, and that is
//   structural rather than cosmetic:
//   the settled purse and the fan's receipt must never sit adjacent, because two
//   money figures next to each other invite a subtraction whose answer is
//   "they owe me the rest". Five question rows and a tiebreaker is the distance.
//   It also happens to read in the right order — what I did, what it paid, what
//   was true, what the room did — with the fan's outcome ahead of the room's.
// ----------------------------------------------------------------------------
//
// ----------------------------------------------------------------------------
// THE DRAFT LIVES HERE, IN REACT STATE, AND NOWHERE ELSE — no partial-save
// endpoint exists and no browser storage is used. A fan who answers three
// questions and closes the app loses all three.
//
// THE DEFENSE IS THE HEADER LINE, NOT THE GUARD. "Nothing is filed until you
// lock the card" sits above the first question at the same weight the pick
// sheet gives its opposite promise ("tap a side to save it — no submit
// button"), because the fan reads that line BEFORE spending five taps, and the
// beforeunload guard only ever fires after. The guard is a backstop; the
// sentence is the design.
//
// ONCE FILED, THE VOLATILITY IS OVER. myEntry comes down on every read, the
// draft hydrates from it, and the card is durable and freely revisable until
// kickoff — so the window in which work can be lost only ever exists on a fan's
// FIRST pass at a given card.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  arenaLockCountdown,
  callErrorSlot,
  callPhase,
  callVoidCopy,
  callWeekLabel,
  points,
  etDateTime,
  CALL_QUESTION_COUNT,
  CALL_TIEBREAKER_MAX,
  CallCallerOfTheWeek,
  CallCard,
  CallEntry,
  CallEntryInput,
  CallEntryResult,
  CallPayouts,
  CallQuestion,
  CallResult,
  CallSettlement,
  EntryRefusal,
} from '../../api';
import { EntryAdvisoryNotice } from '../../entry-advisory';

// The tiebreaker, parsed. Held as a STRING in state and converted only here,
// because 0 is a legal answer and `Number('')` is 0 — a numeric state would make
// "hasn't typed anything" and "guessed zero" the same value, and would submit
// the second when the fan meant the first.
//
// Digits only: '' , '-3' and '12.5' all fail the test rather than being coerced
// into something the server would take.
function parseTiebreaker(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n <= CALL_TIEBREAKER_MAX ? n : null;
}

// "Saturday, July 25 · 7:00 PM ET" — the game, which is also the lock. A real
// timestamp, so it renders in ET and says so, like every other time on the site.
function kickoffLabel(iso: string | null): string {
  return etDateTime(iso, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    zone: true,
  });
}

// ---------------------------------------------------------------------------
// THE MARK — composed from two glyphs and a ring of CSS rather than an image
// asset, exactly like the Oracle's fox-and-orb: no build step, no 404, and it
// scales with the type.
// ---------------------------------------------------------------------------
function CallMark() {
  return (
    <div className="call-mark" aria-hidden="true">
      <span className="call-mark__radio">📻</span>
      <span className="call-mark__mic">🎙️</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ONE QUESTION, INTERACTIVE.
//
// OPTIONS ARE A VERTICAL STACK AT EVERY WIDTH, and uniform whether the question
// carries two or three. Four of the twelve templates are three-bucket ones with
// labels like "8–14 points"; mixing two-across with three-across would give the
// card two rhythms and make the three-option rows cramped at 390px. The card
// narrows on a phone, the buttons never rearrange — the same discipline the
// Trail map follows.
//
// 56px rows, not the Oracle's 96px. That overshoot is right for a card with ONE
// tap on it; five questions of it is a 1500px scroll. 56 still clears the
// global 44px floor with room to spare.
// ---------------------------------------------------------------------------
function QuestionBlock({
  question,
  slot,
  chosen,
  flagged,
  disabled,
  blockRef,
  onChoose,
}: {
  question: CallQuestion;
  // The fan-facing slot number (1-based). NOT question.index — the server names
  // slots this way in its 400s and the two must agree on screen.
  slot: number;
  chosen: string | null;
  // This is the question the last 400 was about. The message itself renders on
  // the slip; this is what makes it findable in a five-question scroll.
  flagged: boolean;
  disabled: boolean;
  // The sheet keeps one ref per slot so it can scroll a flagged question into
  // view. Passed as a prop rather than through forwardRef: this component is
  // local to the file and has exactly one caller.
  blockRef: (el: HTMLLIElement | null) => void;
  onChoose: (key: string) => void;
}) {
  return (
    <li ref={blockRef} className={`call-q${flagged ? ' call-q--flagged' : ''}`}>
      <div className="call-q__head">
        <span className="call-q__slot">{slot}</span>
        <p className="call-q__prompt">{question.prompt}</p>
      </div>
      <div className="call-q__options">
        {question.options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`call-opt${chosen === o.key ? ' call-opt--on' : ''}`}
            aria-pressed={chosen === o.key}
            disabled={disabled}
            onClick={() => onChoose(o.key)}
          >
            <span className="call-opt__label">{o.label}</span>
            <span className="call-opt__tick" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// THE CARD AS FILED — the read-only rendering, shared by the locked, graded and
// voided states.
//
// PROMPT AND THE CHOSEN LABEL, one row each, rather than five dead option
// stacks: "what I answered" is the question a fan opens a locked card to ask,
// and fifteen greyed-out buttons answer it worse than five lines do.
//
// A fan with NO entry still sees the prompts. They cannot act on them, but
// seeing what was asked is the whole of what they missed, and hiding it would
// make the locked card an empty box.
//
// ----------------------------------------------------------------------------
// TWO INDEPENDENT LAYERS ON TOP OF THAT, AND THEY ARE NOT THE SAME SWITCH:
//
//   THE MARK comes from `results` and is drawn only when the caller passes one.
//   Absent on locked and on VOIDED, where no mark exists — a greyed result
//   column over a card that was never graded is a claim the payload can't back,
//   which is exactly the test the old thin graded branch passed. That is the
//   unmarked mode, and it is the absence of a prop rather than a flag.
//
//   THE NOTE comes from the QUESTION's resolution, which is present for every
//   reader of a graded card — including one who never entered. So a non-entrant
//   gets the answer key with no personal marks on it, which is the honest shape
//   of "here is what was true, and you weren't in it".
//
// A PUSH IS NOT A LOSS AND NOT A NEAR-MISS. It gets the neutral '=' rather than
// a struck-through anything, it gets a WORD (a bare '=' is a puzzle), and none
// of the near-miss vocabulary — "so close", "just missed", "agonising" — appears
// anywhere near it. A void gets the same mark, because a void SCORES as a push,
// and a different sentence, because it is a different fact: the game landed on
// the number vs. the correspondent couldn't see it. The second one is our
// failure and the copy puts it on us.
// ----------------------------------------------------------------------------
// WHAT A PUSH MEANS DEPENDS ON THE QUESTION, so the sentence is keyed to the
// template rather than written once. "It landed exactly on the number" is true
// of every template with a line or a bucket edge in it, and it is NOT true of
// half_scoring, where a push is two halves that scored the same and no number
// was involved at all.
//
// AN ALLOWLIST, AND SILENCE IS THE DEFAULT. who_wins and overtime cannot push;
// halftime_lead and first_scorer_jersey have no push in them either. If a
// resolution ever says otherwise — the backend will not produce one in real play,
// but hand-set data can — the row draws its mark and says NOTHING, because a
// sentence invented for a state that shouldn't exist is worse than no sentence.
// This is not validation and does not try to be: it is a refusal to print a
// claim we can't stand behind.
const CALL_PUSH_NOTE: Record<string, string> = {
  combined_points: 'Push — it landed exactly on the number.',
  longest_play: 'Push — it landed exactly on the number.',
  first_to_n: 'Push — it landed exactly on the number.',
  margin_bucket: 'Push — it landed exactly on the number.',
  team_points_bucket: 'Push — it landed exactly on the number.',
  turnovers_bucket: 'Push — it landed exactly on the number.',
  threes_bucket: 'Push — it landed exactly on the number.',
  half_scoring: 'Push — the halves scored the same.',
};

function FiledList({
  questions,
  entry,
  results,
  pushesExplainedAbove,
}: {
  questions: CallQuestion[];
  entry: CallEntry | null;
  // null = the unmarked mode. Not a boolean: the map IS the permission.
  results: Record<string, CallResult> | null;
  // THE VERDICT ABOVE HAS ALREADY ACCOUNTED FOR EVERY PUSH ON THIS CARD — true
  // only on an all-push card read by the fan who filed it, where the headline
  // says "All five landed on the number" and five identical row sentences
  // underneath it are pure noise. The MARKS still draw; only the explanation
  // goes. On a mixed card the row is the thing doing the explaining, and on a
  // non-entrant's read there is no headline to have said it, so both keep it.
  pushesExplainedAbove: boolean;
}) {
  return (
    <ol className="call-filed">
      {questions.map((q, i) => {
        const key = entry?.answers[q.id] ?? null;
        const label = q.options.find((o) => o.key === key)?.label ?? null;
        const result = results?.[q.id] ?? null;
        // The key, in the fan's words. Falls back to the raw key for the same
        // reason the answer does: a card re-saved after grading can name an
        // option this payload no longer carries.
        const correctLabel =
          q.correctKey === null || q.correctKey === undefined
            ? null
            : q.options.find((o) => o.key === q.correctKey)?.label ??
              q.correctKey;
        const note =
          q.resolution === 'push'
            ? pushesExplainedAbove
              ? null
              : CALL_PUSH_NOTE[q.templateId] ?? null
            : q.resolution === 'void'
              ? // The failure is the coverage's, and the sentence says so. A fan
                // who answered this question did nothing wrong and is told so.
                //
                // KEPT EVEN WHEN THE PUSH SENTENCES ARE SUPPRESSED: a void is not
                // what the headline said. "All five landed on the number" is the
                // all-push wording, and on a card carrying voids these rows are
                // the only place the fan learns that some of it was never seen.
                'Not covered — the correspondent could not call this one.'
              : // The key, and only where it tells the fan something they don't
                // already have: a row they got right does not need to be told
                // what the right answer was.
                q.resolution === 'answered' &&
                  result !== 'correct' &&
                  correctLabel
                ? `Answer: ${correctLabel}`
                : null;
        return (
          <li key={q.id} className="call-filed__row">
            <span className="call-filed__slot">{i + 1}</span>
            <span className="call-filed__prompt">{q.prompt}</span>
            <span
              className={`call-filed__answer${
                label ? '' : ' call-filed__answer--none'
              }`}
            >
              {result && <ResultMark result={result} />}
              {/* A key with no matching option means the card was re-saved after
                  this entry was filed. Show the raw key rather than an em-dash:
                  "they answered something we can no longer name" is true, and
                  "they didn't answer" is not. */}
              {label ?? (key ? key : '—')}
            </span>
            {note && <span className="call-filed__note">{note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// THE THREE MARKS. Gold for correct, plain text for a push, MUTED for wrong —
// and note that wrong is the QUIETEST of the three rather than the loudest, and
// is never --warn. That token is the something-has-gone-wrong colour (the Oracle
// says so in its own CSS), and a missed answer on a free weekly card is not
// that. Painting wrong red would also, by contrast, drag the neutral push toward
// reading as the consolation tier of a loss, which is the one thing it must not.
function ResultMark({ result }: { result: CallResult }) {
  return (
    <span
      className={`call-filed__mark call-filed__mark--${result}`}
      aria-label={
        result === 'correct' ? 'Correct' : result === 'push' ? 'Push' : 'Wrong'
      }
    >
      {result === 'correct' ? '✓' : result === 'push' ? '=' : '✗'}
    </span>
  );
}

// The tiebreaker as filed. Its own row rather than a sixth question, because it
// is not scored — it is recorded on the Call and plays no part in the band
// split, and rendering it in the list would imply it broke something.
//
// THE ACTUAL SITS BESIDE IT ON A GRADED CARD AND NOTHING IS SAID ABOUT THE GAP
// IN THE ROW ITSELF. breaksTies is an explicit false on the wire: everyone tied
// at a score is in the same band and paid the same, so the tiebreaker settled
// nothing about the money. Two numbers, no verdict, and it stays down here
// beside the fan's own card rather than anywhere near the settlement.
//
// WHAT THE TIEBREAKER DOES DECIDE HANGS UNDERNEATH IT — Caller of the Week, a
// name and a badge and no points. That is why the block lives here and not in
// the settlement: the title is the closest guess in the room, the settlement is
// what the room was paid, and those two must never be made to look like one
// sentence. See CallerBlock for the one distance this screen is allowed to draw.
function FiledTiebreaker({
  prompt,
  answer,
  actual,
  caller,
}: {
  prompt: string | null;
  answer: number | null;
  actual?: number | null;
  // Graded cards only, and null on plenty of those — open, voided, and the
  // degenerate card where nobody scored above zero all send null. Passed only
  // from the graded branch; the locked and voided ones have nothing to pass.
  caller?: CallCallerOfTheWeek | null;
}) {
  if (!prompt) return null;
  return (
    <>
      <div className="call-filed__tb">
        <span className="call-filed__tblabel">Tiebreaker</span>
        <span className="call-filed__tbprompt">{prompt}</span>
        {actual !== null && actual !== undefined && (
          <span className="call-filed__tbactual">
            Actually {points(actual)} ·{' '}
          </span>
        )}
        <span className="call-filed__tbanswer">
          {answer === null ? '—' : points(answer)}
        </span>
      </div>
      {caller && caller.winners.length > 0 && <CallerBlock caller={caller} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// CALLER OF THE WEEK — RECOGNITION, AND THE ONE THING ON THIS CARD THAT IS NOT
// A NUMBER OF POINTS.
//
// PLURAL WHENEVER THE WIRE SAYS SO. A tie on distance awards every fan tied and
// nothing breaks it further, so the heading counts the array rather than
// assuming a winner: "Callers of the Week" is the normal case in a big room, not
// an edge case to degrade into.
//
// THE DISTANCE IS RENDERED HERE AND NOWHERE ELSE, and that is not a loosening of
// the rule at answer-sheet.tsx:355 — it is the point of it. A distance beside the
// POT would tell a fan their money hinged on a guess it did not hinge on; a
// distance beside a TITLE is the explanation of the title. It never travels up
// into the settlement and the band table is never sorted by it.
//
// AND IT SAYS SO OUT LOUD. One line, unconditionally, stating that the title
// moves none of the pot — breaksTies is false and the fan is told rather than
// left to infer it from an absence.
// ---------------------------------------------------------------------------
function CallerBlock({ caller }: { caller: CallCallerOfTheWeek }) {
  const many = caller.winners.length > 1;
  return (
    <div
      className={`call-caller${caller.youWon ? ' call-caller--mine' : ''}`}
    >
      <span className="call-caller__label">
        {many ? 'Callers of the Week' : 'Caller of the Week'}
      </span>
      <ul className="call-caller__list">
        {caller.winners.map((w) => (
          <li key={w.userId} className="call-caller__who">
            <span className="call-caller__name">{w.displayName}</span>
            {/* An exact hit is a word, not "0 off" — the zero reads as a
                missing value in a column of distances. */}
            <span className="call-caller__gap">
              {w.distance === 0 ? 'called it exactly' : `${points(w.distance)} off`}
            </span>
          </li>
        ))}
      </ul>
      {caller.youWon && (
        <p className="call-caller__mine">
          {many ? 'You share it this week.' : 'That is you.'} The badge is in
          your inventory.
        </p>
      )}
      <p className="call-caller__note">
        A title, not a payout — the closest guess moves none of the pot.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOW A CARD FAILED TO BE SCOREABLE, when it did — or null when at least one
// question was actually answered.
//
// PUSH AND VOID ARE NOT INTERCHANGEABLE HERE AND THE COPY MUST NOT MERGE THEM.
// The schema keeps them as separate resolutions and the backend's proof asserts
// they are never collapsed, for the reason its own comment gives: "the game
// landed exactly on 55" and "your correspondent couldn't see it" are different
// sentences. A card that was half pushed and half unseen is neither, and saying
// "all five landed on the number" over it tells the fan the game did something
// it didn't AND hides a coverage failure behind a game fact.
//
// Reused at two altitudes with the same three answers: over the whole card (the
// pot line, where every entrant is in the same boat) and over just the questions
// one fan's results mark as a push (their verdict headline).
// ---------------------------------------------------------------------------
type CallUnscored = 'push' | 'void' | 'mixed';

function unscoredKind(questions: CallQuestion[]): CallUnscored | null {
  if (questions.length === 0) return null;
  let pushes = 0;
  let voids = 0;
  for (const q of questions) {
    if (q.resolution === 'push') pushes += 1;
    else if (q.resolution === 'void') voids += 1;
    // Anything answered means the card was scoreable, whatever the fans did
    // with it — that is not this function's case at all.
    else return null;
  }
  return voids === 0 ? 'push' : pushes === 0 ? 'void' : 'mixed';
}

// Small numbers as words, because the verdict headline is prose in a serif face
// and "3 of 5 called" reads like a scoreboard in it. Falls back to digits above
// the card's size, which nothing produces today.
const COUNT_WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five'];
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

// ---------------------------------------------------------------------------
// THE VERDICT — the receipt, then the score, then one sentence.
//
// SIX HEADLINES, because the zero-score ones are DIFFERENT CARDS rather than one
// phrasing with a hedge in it:
//
//   NOTHING SCOREABLE (pushCount === total) — every question either landed
//   exactly on the number or went unseen. NOBODY WAS WRONG. "No correct answers
//   on this card" is a rebuke here, and a rebuke for something no fan could have
//   avoided: resolutions are a property of the CARD, so if this fan pushed all
//   five then so did every other entrant. It gets its own sentence — and THREE
//   of them, because pushes and voids are not the same event and a card holding
//   both is neither. See unscoredKind.
//
//   ZERO WITH WRONGS — genuinely missed. Says so plainly, once, and moves on to
//   what they were paid.
//
// THE WHISTLE SENTENCE. Whenever `whistle` is true on a card containing a push,
// the block owes an extra line, because this is the single moment the push rule
// turns into money: the fan is being paid for a perfect card that is visibly not
// five-for-five, and without the sentence that reads as a bug. The rule itself
// (wrong === 0 && correct >= 1) lives on the backend and is never re-derived
// here — the obvious `wrongCount === 0` would hand a Whistle to an all-push card.
// ---------------------------------------------------------------------------
function VerdictBlock({
  entry,
  questions,
}: {
  entry: CallEntry;
  questions: CallQuestion[];
}) {
  const total = questions.length;
  const correct = entry.correctCount ?? 0;
  const push = entry.pushCount ?? 0;
  const wrong = entry.wrongCount ?? 0;
  const paid = entry.pointsAwarded ?? null;
  const whistle = entry.whistle === true;
  const allPush = total > 0 && push === total;
  // WHICH OF THE THREE. Counted over the questions THIS FAN'S results mark as a
  // push — pushCount folds the voids in and cannot tell them apart, so the
  // resolutions are the only place the difference survives.
  const kind = allPush
    ? unscoredKind(questions.filter((q) => entry.results?.[q.id] === 'push'))
    : null;
  const many = countWord(total).toLowerCase();

  const headline = whistle
    ? 'The Golden Whistle.'
    : correct > 0
      ? `${countWord(correct)} of ${countWord(total)} called.`
      : kind === 'push'
        ? `All ${many} landed on the number.`
        : kind === 'void'
          ? `None of the ${many} could be called.`
          : // MIXED — claims neither exclusively, because neither is true of the
            // whole card. Which question was which is on the rows beneath, where
            // the void sentences survive precisely for this.
            kind === 'mixed'
            ? 'Nothing on this card could be scored.'
            : 'No correct answers on this card.';

  const sub = whistle
    ? 'A perfect card — every question the correspondent could grade, you called.'
    : correct > 0
      ? entry.band !== null && entry.band !== undefined
        ? 'Your card took a share of the pot.'
        : 'Short of the pot this week — you keep what your card paid.'
      : kind === 'push'
        ? 'Every question landed exactly on the number, so there was nothing there to call — for you or for anyone else who filed.'
        : kind === 'void'
          ? // THE FAILURE IS OURS AND THE SENTENCE SAYS SO. Nothing here is
            // phrased as something the fan got wrong, because nothing was.
            'Not one question could be graded from the stands. That is our coverage falling short rather than your card — and you keep what filing pays.'
          : kind === 'mixed'
            ? "Some questions landed exactly on the number and the rest went uncovered, so no card could score this week — yours or anyone else's."
            : 'You keep what filing pays. There is a new card on Thursday.';

  return (
    <div className="call-verdict">
      {/* Only when there is something to show. Participation makes this positive
          on every filed card in practice, but a house that priced it at zero
          must not be made to render "+0". */}
      {paid !== null && paid > 0 && (
        <span className="call-verdict__points">+{points(paid)}</span>
      )}
      <p className="call-verdict__headline">{headline}</p>
      {/* STRAIGHT OFF THE PAYLOAD, no arithmetic and no denominator folded in.
          The push count INCLUDES the voids and is not split apart here — the
          difference between them is a per-question sentence, not a counter. */}
      <p className="call-verdict__counts">
        {points(correct)} correct · {points(push)} push · {points(wrong)} wrong
      </p>
      <p className="call-verdict__sub">{sub}</p>
      {whistle && push > 0 && (
        <p className="call-verdict__whistle">
          A push doesn&apos;t break a perfect card.
        </p>
      )}
    </div>
  );
}

// "Top score", "2nd score", "3rd score" — shared by the advertised pills and the
// settled table so the two namings cannot drift apart between the open card and
// the graded one.
function bandRank(band: number): string {
  return band === 1
    ? 'Top score'
    : band === 2
      ? '2nd score'
      : `${band}rd score`;
}

// A BAND ONLY PAYS ONCE THE FIELD REACHES IT — minEntrants is 0 / 10 / 50 today,
// so a quiet week plays for fewer bands than a busy one. Shared by the open
// card's pills and the settled card's note so the two cannot disagree about
// which bands a given week was ever playing for.
//
// WHAT A CLOSED BAND MEANS, AND THE ONLY THING IT MEANS: the purse CONCENTRATES
// on the bands that are open. It does not shrink, nothing is withheld, and no
// copy on this screen may suggest either — a five-entrant week pays its whole
// purse to the top score.
const bandOpen = (band: { minEntrants: number }, entrants: number) =>
  entrants >= band.minEntrants;

// ---------------------------------------------------------------------------
// THE SETTLEMENT — what the room did, and the last thing on the card.
//
// POINTS AND MEMBERS, NEVER PERCENTAGES. `pct` is on the wire and is the
// CONFIGURED number: with two occupied bands the split renormalizes 50/30 into
// 62.5/37.5, so rendering the snapshot's percentages beside the actual points
// would show percentages that don't total 100 next to points that do.
//
// BANDS ARE BLOCKS, NOT A TABLE. At 390px a rank, a membership and a points
// figure across one row leaves the middle column about ninety pixels, which
// wraps "4 fans" mid-row. So each band stacks: rank and points on the first
// line, who and what they did underneath — the same grid the filed rows use.
//
// THE FAN'S OWN BAND IS MARKED AND NEVER PRICED. Their share is not on this
// block at any width: pointsAwarded upstairs is the receipt, this is the
// explanation, and a per-fan figure inside a row that also carries the band
// total and the member count is an invitation to divide.
//
// THE DEGENERATE CARD gets a sentence instead of a table AND LOSES THE PURSE
// FIGURE. A large gold number whose only verb is "paid nothing" is a quantity of
// something that did not happen; the eyebrow stays so the block is still
// findable, and the line says which of the two degenerate cards this was.
// ---------------------------------------------------------------------------
function SettlementBlock({
  settlement,
  pot,
  myBand,
  unscored,
}: {
  settlement: CallSettlement;
  pot: CallCard['pot'];
  myBand: number | null;
  // How the card failed to be scoreable, or null if it didn't — the card was
  // ungradeable rather than badly played, and the sentence must not blame the
  // room for it. Three values rather than a flag for the same reason the verdict
  // has three headlines: a void is not a push. See unscoredKind.
  unscored: CallUnscored | null;
}) {
  const bands = settlement.bands;

  // WHICH BANDS THIS WEEK WAS EVER PLAYING FOR — cut on the FINAL entrant count,
  // which is what `pot.entrants` is on a settled card. Everything below the note
  // hangs off the difference between three counts: how many bands the terms
  // advertise, how many the field opened, and how many the room actually filled.
  const openBandCount = pot.bands.filter((b) =>
    bandOpen(b, pot.entrants),
  ).length;
  // Never opened: the field was too small. Clamped at zero rather than trusted,
  // because a settlement carrying more bands than the field opened is a backend
  // disagreement, and the honest response to it is to say nothing rather than to
  // print a negative count in prose.
  const shutByField = Math.max(0, pot.bands.length - openBandCount);
  // Opened, and nobody reached the score. The ORIGINAL cause, still its own line.
  const unreached = Math.max(0, openBandCount - bands.length);

  if (bands.length === 0) {
    return (
      <div className="call-settle call-settle--none">
        <span className="call-settle__label">The pot</span>
        <p className="call-settle__nonesub">
          {/* FIVE WAYS TO REACH AN EMPTY BAND TABLE, and they are five different
              sentences. An empty room is not a room that played badly; a card
              nobody could score is not a card everybody got wrong; and a card
              the correspondent couldn't see is not a card the game refused to
              settle. The last two are OUR failure and the game's respectively,
              and only the final line is about the fans at all. */}
          {pot.entrants === 0
            ? 'Nobody filed a card this week, so the purse paid out nothing.'
            : unscored === 'push'
              ? 'Every question landed on the number, so no card scored above zero. The purse paid out nothing this week.'
              : unscored === 'void'
                ? 'Not one question could be graded from the stands, so no card scored above zero. The purse paid out nothing this week.'
                : unscored === 'mixed'
                  ? 'Nothing on this card could be scored — some questions landed on the number and the rest went uncovered — so the purse paid out nothing this week.'
                  : 'Nobody scored above zero, so no band filled and the purse paid out nothing this week.'}
        </p>
      </div>
    );
  }

  return (
    <div className="call-settle">
      <div className="call-settle__head">
        <span className="call-settle__label">The pot</span>
        <span className="call-settle__value">{points(pot.points)}</span>
        <span className="call-settle__unit">pts</span>
      </div>
      <p className="call-settle__sub">
        Paid out by score across {points(pot.entrants)}{' '}
        {pot.entrants === 1 ? 'card' : 'cards'} filed.
      </p>
      <ul className="call-settle__bands">
        {bands.map((b) => (
          <li
            key={b.band}
            className={`call-settle__band${
              b.band === myBand ? ' call-settle__band--mine' : ''
            }`}
          >
            <span className="call-settle__rank">{bandRank(b.band)}</span>
            <span className="call-settle__points">{points(b.points)} pts</span>
            <span className="call-settle__who">
              {points(b.members)} {b.members === 1 ? 'fan' : 'fans'} at{' '}
              {points(b.score)} correct
              {b.members > 1 && ', split evenly'}
              {b.band === myBand && (
                <span className="call-settle__mine"> · your band</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {/* Stated as a RULE and never as arithmetic. A fan who read three pills on
          the open card and is looking at two rows here is owed the reason, and
          the reason is not a sum they should be checking.

          TWO DIFFERENT CAUSES, TWO DIFFERENT SENTENCES, and they are independent
          — a week can hit either or both. A band can be missing because the ROOM
          never reached its score (nobody was fourth-best because there were only
          three distinct scores), or because the FIELD never reached its
          minEntrants (the band was never open to be reached at all). Collapsing
          them into one line would tell a fan in a five-person week that nobody
          scored well enough, when the truth is there was nobody to score
          against. Neither sentence says the purse was reduced, because it wasn't:
          both describe the same money landing in fewer places. */}
      {shutByField > 0 && (
        <p className="call-settle__note">
          {openBandCount === 1
            ? `${points(pot.entrants)} ${pot.entrants === 1 ? 'card' : 'cards'} filed, so only the top score's band was open — the whole purse paid out there.`
            : `${points(pot.entrants)} ${pot.entrants === 1 ? 'card' : 'cards'} filed, so the ${countWord(
                openBandCount,
              ).toLowerCase()} bands above were the ones open — the whole purse paid out across them.`}
        </p>
      )}
      {unreached > 0 && (
        <p className="call-settle__note">
          Bands nobody reached fold back into the ones above.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE PAYOUT LINE. On the card rather than in a legend, for the same reason the
// Oracle puts +10/+24 on the buttons: the numbers ARE the proposition, and the
// backend pre-computes all three at the current reward values so what is shown
// is what lands.
// ---------------------------------------------------------------------------
function PayoutStrip({ payouts }: { payouts: CallPayouts }) {
  return (
    <ul className="call-pays" aria-label="What this card pays">
      <li className="call-pays__item">
        <span className="call-pays__num">+{points(payouts.perCorrect)}</span>
        <span className="call-pays__what">per correct answer</span>
      </li>
      <li className="call-pays__item call-pays__item--gold">
        <span className="call-pays__num">+{points(payouts.goldenWhistle)}</span>
        <span className="call-pays__what">Golden Whistle — a perfect card</span>
      </li>
      <li className="call-pays__item">
        <span className="call-pays__num">+{points(payouts.participation)}</span>
        <span className="call-pays__what">just for filing one</span>
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// THE POT. This game's equivalent of the Oracle's confidence dial — the one
// number that makes the card a proposition rather than a quiz.
//
// LABELLED AS A PROJECTION, ALWAYS, while the card is open: it is
// base + perEntrant × entrants and it grows with every entry until kickoff, so
// stating it as a payout would be promising a number that moves.
//
// ONE PURSE FIGURE, AND IT IS `points`. The payload also carries
// projectedPoints on a live card and omits it once settled; this client reads
// neither state's copy of it, so there is no second figure anywhere that could
// fall out of step with this one, and no branch that has to choose between them.
//
// THIS BLOCK IS NOT RENDERED ON A GRADED CARD. The settled purse belongs BELOW
// the answer key, where it cannot sit adjacent to the fan's receipt — see
// SettlementBlock and the file header.
//
// ----------------------------------------------------------------------------
// THE BANDS ARE NO LONGER A STATIC LIST, and the reason is the whole shape of
// the card's week. Each band carries a minEntrants (0 / 10 / 50), so at a given
// moment some of them are OPEN and paying and the rest are not open YET.
//
// CLOSED BANDS ARE SHOWN, NOT HIDDEN. Hiding them would make the pill row change
// LENGTH as the field fills, which reads as the terms being rewritten under the
// fan; showing them makes it read as the card getting richer, which is what is
// actually happening. The closed pill says what opens it — a target, not a
// denial.
//
// AND THE PURSE CONCENTRATES. The percentages renormalize across the open bands,
// so a five-entrant week pays its ENTIRE purse to the top score. There is no
// smaller pot at a small field and this copy must never let one be inferred:
// nothing is "split three ways" here, and the word "only" never attaches to the
// money.
// ----------------------------------------------------------------------------
// EXPORTED, AND RENDERED BY THE PAGE rather than by this sheet -- /arena/call
// puts it in the rail beside the questions, so the purse is reference WHILE
// answering instead of something to scroll to. The phase gate that used to sit
// around its call site here moved with it; see the note at the page's rail.
export function PotBlock({ pot, open }: { pot: CallCard['pot']; open: boolean }) {
  const openBands = pot.bands.filter((b) => bandOpen(b, pot.entrants));
  // The next band to open, and how many cards away it is. Only ever spoken about
  // on an OPEN card: after kickoff the field is final, and "6 more cards" beside
  // a locked card is an invitation nobody can accept.
  const nextShut = pot.bands.find((b) => !bandOpen(b, pot.entrants));
  const cardsAway = nextShut ? nextShut.minEntrants - pot.entrants : 0;

  return (
    <div className="call-pot">
      <div className="call-pot__head">
        <span className="call-pot__label">
          {open ? 'Pot so far' : 'The pot'}
        </span>
        <span className="call-pot__value">{points(pot.points)}</span>
        <span className="call-pot__unit">pts</span>
      </div>
      <p className="call-pot__sub">
        {points(pot.basePoints)} to start, +{points(pot.perEntrantPoints)} for
        every card filed · {points(pot.entrants)}{' '}
        {pot.entrants === 1 ? 'entrant' : 'entrants'}
        {open && ' — it keeps growing until kickoff'}
      </p>
      {/* The bands, stated rather than left to be discovered at payout. Read off
          the SNAPSHOT once published, so a later edit to the constants cannot
          change what the fan was told they were playing for. */}
      <ul className="call-pot__bands">
        {pot.bands.map((b) => {
          const isOpen = bandOpen(b, pot.entrants);
          return (
            <li
              key={b.band}
              className={`call-pot__band${isOpen ? '' : ' call-pot__band--shut'}`}
            >
              <span className="call-pot__bandrank">{bandRank(b.band)}</span>
              {/* THE PERCENTAGE IS THE PROMISE, AND ONLY AN OPEN BAND IS MAKING
                  ONE. On a closed band the share is not what the fan needs (it
                  is paying nothing today, and its slice is already inside the
                  open bands above) — the threshold is. So the pill swaps the
                  number for the target rather than showing a percentage that
                  describes no payment. */}
              {isOpen ? (
                <span className="call-pot__bandpct">{b.pct}%</span>
              ) : (
                <span className="call-pot__bandgate">
                  opens at {points(b.minEntrants)} entrants
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="call-pot__split">
        Every fan tied at a score splits that band evenly.
      </p>
      {/* WHERE THE CLOSED BANDS' SHARE IS: in the open ones. Stated in that
          direction — what the purse IS doing, never what it is not — because the
          fan's question at a small field is "is this worth less?" and the answer
          is no, it is worth the same and lands on fewer people. */}
      {openBands.length < pot.bands.length && (
        <p className="call-pot__concentrate">
          {openBands.length === 1
            ? 'At this size the whole purse goes to the top score.'
            : `At this size the whole purse pays out across the ${countWord(
                openBands.length,
              ).toLowerCase()} bands above.`}
          {open && nextShut && (
            <>
              {' '}
              {cardsAway === 1 ? 'One more card' : `${points(cardsAway)} more cards`}{' '}
              and the {bandRank(nextShut.band).toLowerCase()} band opens too.
            </>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE SLIP — the draft, made visible, docked to the bottom of the viewport on a
// phone.
//
// THIS IS THE WHOLE ANSWER TO "NO PARTIAL SAVE". The draft is invisible state
// that dies with the tab; the slip turns it into an object the fan can see the
// size of, and keeps the one action that makes it durable within a thumb's
// reach from any scroll position. Straight off the parlay board's ticket stub,
// including the rule that matters most on a small screen: an EMPTY slip goes
// static and scrolls away rather than permanently eating a third of the phone.
// ---------------------------------------------------------------------------
function AnswerSlip({
  answered,
  total,
  tiebreakerReady,
  hasEntry,
  dirty,
  complete,
  submitting,
  error,
  saved,
  onSubmit,
}: {
  answered: number;
  total: number;
  tiebreakerReady: boolean;
  hasEntry: boolean;
  dirty: boolean;
  complete: boolean;
  submitting: boolean;
  error: string | null;
  saved: CallEntryResult | null;
  onSubmit: () => void;
}) {
  const empty = answered === 0 && !tiebreakerReady && !hasEntry;
  const pct = total > 0 ? (answered / total) * 100 : 0;

  // Four readings, and the disabled ones say what is missing rather than just
  // going grey — a dead button with no reason on it is a puzzle.
  const label = submitting
    ? hasEntry
      ? 'Updating…'
      : 'Filing…'
    : !complete
      ? answered < total
        ? `${total - answered} question${total - answered === 1 ? '' : 's'} to go`
        : 'Add your tiebreaker'
      : hasEntry
        ? dirty
          ? 'Update my card'
          : 'Card filed — no changes'
        : 'Lock in my card';

  return (
    <div
      className={`call-slip${empty ? ' call-slip--empty' : ''}`}
      aria-label="Your card in progress"
    >
      <div className="call-slip__head">
        <span className="call-slip__title">Your card</span>
        <span className="call-slip__count">
          {answered} of {total}
          <span className="call-slip__tb">
            {' · '}
            {tiebreakerReady ? 'tiebreaker set' : 'tiebreaker'}
          </span>
        </span>
      </div>

      <div
        className="call-slip__bar"
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${answered} of ${total} questions answered`}
      >
        <span className="call-slip__fill" style={{ width: `${pct}%` }} />
      </div>

      {error && <div className="error call-slip__error">{error}</div>}

      {saved && !dirty && !error && (
        <p className="call-slip__saved" role="status">
          {saved.replaced ? '✓ Card updated' : '✓ Card locked in'} — you can keep
          changing it until kickoff.
        </p>
      )}

      <button
        type="button"
        className="call-file"
        disabled={!complete || submitting || (hasEntry && !dirty)}
        onClick={onSubmit}
      >
        {label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE CARD
// ---------------------------------------------------------------------------
export function CallSheet({
  weekStart,
  call,
  myEntry,
  settlement,
  payouts,
  now,
  onSubmit,
  submitting,
  submitError,
  saved,
  // The conflict-of-interest refusal, or null on the normal case. This is the
  // correspondent covering THIS card's game — the one fan on the site who
  // cannot file against it, because they are the one grading it.
  covering,
}: {
  // The CURRENT ET week, which is not necessarily the card's week — see below.
  weekStart: string;
  call: CallCard | null;
  myEntry: CallEntry | null;
  // Non-null on both terminal states, null while the card is live. The graded
  // branch reads it; the voided branch deliberately does not — a wash has an
  // empty band list because nothing was scored, not because nobody won.
  settlement: CallSettlement | null;
  payouts: CallPayouts;
  // Ticked by the page at 1s while the card is open, so there is ONE timer on
  // this surface rather than one here and one there. The page also owns the
  // single re-read when it crosses the lock.
  now: number;
  onSubmit: (input: CallEntryInput) => void;
  submitting: boolean;
  submitError: string | null;
  // The response from a submission made in THIS session. null for a fan
  // returning to a card they already filed — the moment has passed, and
  // re-announcing it would be a lie about when.
  saved: CallEntryResult | null;
  covering: EntryRefusal | null;
}) {
  // ---- THE DRAFT. Hydrated from the filed card when there is one, so a
  // returning fan edits their answers rather than re-entering them.
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => myEntry?.answers ?? {},
  );
  const [tiebreakerText, setTiebreakerText] = useState(() =>
    myEntry ? String(myEntry.tiebreakerAnswer) : '',
  );

  // Re-hydrate when a NEW entry lands (a successful submit, or a re-read). The
  // identity of myEntry is stable between reads — the page holds one response
  // object — so this cannot stomp a draft mid-edit.
  useEffect(() => {
    if (!myEntry) return;
    setAnswers(myEntry.answers);
    setTiebreakerText(String(myEntry.tiebreakerAnswer));
  }, [myEntry]);

  // Scroll the question a 400 named into view. A five-question sheet is taller
  // than a phone, so an error rendered only on the slip is an error about a
  // question the fan cannot see.
  const slotRefs = useRef<Array<HTMLLIElement | null>>([]);
  const errorSlot = submitError ? callErrorSlot(submitError) : null;
  useEffect(() => {
    if (errorSlot === null) return;
    slotRefs.current[errorSlot]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  }, [errorSlot, submitError]);

  const questions = call?.questions ?? [];
  const answeredCount = questions.filter((q) => answers[q.id]).length;
  const tiebreakerValue = parseTiebreaker(tiebreakerText);
  const tiebreakerTouched = tiebreakerText.trim() !== '';
  const complete =
    questions.length > 0 &&
    answeredCount === questions.length &&
    tiebreakerValue !== null;

  // Does the draft differ from what is filed? Drives the update button, and the
  // beforeunload guard — a fan whose draft exactly matches their filed card has
  // nothing to lose by leaving.
  const dirty = useMemo(() => {
    if (!myEntry) return answeredCount > 0 || tiebreakerTouched;
    if (String(myEntry.tiebreakerAnswer) !== tiebreakerText.trim()) return true;
    const keys = new Set([
      ...Object.keys(myEntry.answers),
      ...Object.keys(answers),
    ]);
    for (const k of keys) {
      if (myEntry.answers[k] !== answers[k]) return true;
    }
    return false;
  }, [myEntry, answers, tiebreakerText, answeredCount, tiebreakerTouched]);

  const phase = call ? callPhase(call) : null;
  // COVERED ONLY MATTERS ON AN OPEN CARD. Past the lock there is nothing to
  // refuse — the card is already read-only for everyone — and an advisory about
  // entering a card that closed hours ago is stale news on a screen whose job by
  // then is the answer key.
  const covered = phase === 'open' ? covering : null;
  // Not editable when covered, which also stands the beforeunload guard down:
  // there is no draft to protect on a card that renders no inputs.
  const editable = phase === 'open' && !covered;

  // WAS THIS CARD UNGRADEABLE RATHER THAN BADLY PLAYED, AND WHICH KIND? A
  // property of the CARD and not of any one fan — the resolutions are shared by
  // every entrant, so if nothing here could be scored then nobody in the
  // building was wrong and nobody could have won. That is a different sentence
  // from "nobody got any right", and it is three different sentences depending
  // on whether the game refused to settle, we failed to watch, or both.
  const unscored = unscoredKind(questions);

  // Does the verdict headline already say what every push row would say? Two
  // conditions, and both matter:
  //
  //   THE FAN'S OWN pushCount, not the card's resolutions — a non-entrant gets
  //   no verdict block, so on the same card their rows keep the sentences that
  //   are the only explanation they have.
  //
  //   ONLY ON A PURE-PUSH CARD. The mixed headline deliberately claims neither
  //   event, so it has NOT said what the push rows say and they go back to being
  //   the thing doing the explaining.
  const pushesExplainedAbove =
    myEntry?.outcome === 'graded' &&
    questions.length > 0 &&
    (myEntry.pushCount ?? 0) === questions.length &&
    unscored === 'push';

  // ---- THE BACKSTOP, AND ITS HONEST LIMIT.
  //
  // beforeunload catches a DESKTOP refresh, a tab close and a back-navigation
  // out of the app. It does essentially NOTHING on a phone, which is where this
  // card is actually filled in: iOS and Android fire it unreliably or not at all
  // when the fan switches apps, gets a call, or lets the tab get evicted under
  // memory pressure — and app-switching is the real loss case here, not a
  // deliberate close.
  //
  // So this is a backstop and nothing more. The line above the first question is
  // the actual defense, and it does not get softened because this exists.
  useEffect(() => {
    if (!editable || !dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy spelling; modern browsers show their own generic wording and
      // ignore any string we set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editable, dirty]);

  // ---- NO CALL -------------------------------------------------------------
  // Not an error and not styled as one, same as "The Oracle rests" and "The bus
  // is between seasons". The card is the page; hiding it would leave nothing.
  if (!call) {
    return (
      <section className="call-card call-card--quiet">
        <CallMark />
        <p className="call-kicker">{callWeekLabel(weekStart)}</p>
        <h2 className="call-quiet__title">No Call this week — yet.</h2>
        <p className="call-quiet__sub">
          Our correspondent picks one local game a week and files a five-question
          card by Thursday night. Check back then.
        </p>
      </section>
    );
  }

  const tiebreakerPrompt = call.tiebreaker?.prompt ?? call.tiebreakerPrompt;

  function choose(questionId: string, key: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: key }));
  }

  function file() {
    const tb = parseTiebreaker(tiebreakerText);
    if (!complete || tb === null) return;
    // Send exactly the questions THIS card carries. A hydrated draft can hold a
    // key for a question that was re-saved out from under it, and the server
    // treats an unknown key as a stale client and 400s the whole submission
    // rather than silently dropping it.
    const payload: Record<string, string> = {};
    for (const q of questions) {
      const a = answers[q.id];
      if (a) payload[q.id] = a;
    }
    onSubmit({ answers: payload, tiebreakerAnswer: tb });
  }

  return (
    <section className={`call-card call-card--${phase}`}>
      {/* ---- THE BYLINE. The correspondent first, at masthead weight: this is a
          dispatch from a person in a gym, and that is the entire proposition. */}
      <header className="call-head">
        <CallMark />
        {/* THE CARD NAMES ITS OWN WEEK, ALWAYS. `current` returns the most
            recent non-draft Call with week_start <= this Monday, so a fan
            opening the app on Monday may be looking at LAST week's locked card
            — "this week" would be a lie on exactly the days it matters. */}
        <p className="call-kicker">
          {callWeekLabel(call.weekStart)}
          {call.weekStart !== weekStart && (
            <span className="call-kicker__stale"> · last week&apos;s card</span>
          )}
        </p>
        <p className="call-head__from">Filed from the stands by</p>
        <h2 className="call-head__who">
          {call.correspondent.displayName ?? 'our correspondent'}
        </h2>
        <p className="call-head__game">
          {call.event.matchup}
          {call.event.venue && (
            <span className="call-head__venue"> · {call.event.venue}</span>
          )}
        </p>
        <p className="call-head__when">{kickoffLabel(call.event.scheduledAt)}</p>
      </header>

      {/* THE POT, UP HERE, ON THE TWO LIVE-ISH STATES ONLY.
          Not on a VOID: a washed card paid nothing, and a purse figure over
          "this one was washed" reads as something owed.
          Not on a GRADE either — there it moves below the answer key so the
          settled purse can never sit beside the fan's receipt. */}
      {/* THE POT MOVED OUT. It is rendered by /arena/call into the rail, under
          the same phase gate that used to live on this line -- open and locked
          only. See the note there for why that gate is not optional. */}

      {/* ============ OPEN, BUT COVERED BY THIS READER ============
          The correspondent working this game gets the card they always got —
          the byline, the pot, the five prompts, the clock — through the SAME
          read-only rendering a locked card uses. Only the inputs and the slip
          are gone.

          NO HEADLINE OF OUR OWN ABOVE IT. The server's sentence is the whole
          explanation and it is already the right one; a local line over the top
          would be a second voice saying the same thing slightly differently, and
          the first time the backend retuned its wording the two would disagree.

          `entry` IS STILL PASSED. A correspondent assigned AFTER they filed has
          a card in there, and it is theirs to see. */}
      {phase === 'open' && covered && (
        <div className="call-frozen">
          <EntryAdvisoryNotice refusal={covered} />
          <FiledList
            questions={questions}
            entry={myEntry}
            results={null}
            pushesExplainedAbove={false}
          />
          <FiledTiebreaker
            prompt={tiebreakerPrompt}
            answer={myEntry?.tiebreakerAnswer ?? null}
          />
          {/* The clock stays. The card still locks at kickoff and they of all
              people are going to be there for it. */}
          <footer className="call-foot">
            <p className="call-foot__clock">
              <span className="call-foot__tick" aria-hidden="true">
                ⏳
              </span>
              {call.locksAt
                ? arenaLockCountdown(call.locksAt, now)
                : 'Locks at kickoff'}
              <span className="call-foot__at">
                {' · '}
                {kickoffLabel(call.locksAt)}
              </span>
            </p>
          </footer>
        </div>
      )}

      {/* ================= OPEN: THE SHEET ================= */}
      {phase === 'open' && !covered && (
        <>
          <div className="call-sheet__head">
            <h3 className="call-sheet__title">
              {myEntry ? 'Your card' : 'Five questions'}
            </h3>
            {/* THE LINE. Sized and placed to be read BEFORE the first tap, at
                the same weight the pick sheet gives its opposite promise — that
                surface saves on tap and says so, this one does not and has to
                say so louder, because the fan cannot tell by looking. */}
            <p className="call-sheet__warn">
              <span aria-hidden="true">⚠️</span> Nothing is filed until you lock
              the card. All {CALL_QUESTION_COUNT} answers and the tiebreaker go
              in one go — and you can change them right up to kickoff.
            </p>
          </div>

          <PayoutStrip payouts={payouts} />

          <ol className="call-qs">
            {questions.map((q, i) => (
              <QuestionBlock
                key={q.id}
                question={q}
                slot={i + 1}
                chosen={answers[q.id] ?? null}
                flagged={errorSlot === i}
                disabled={submitting}
                blockRef={(el) => {
                  slotRefs.current[i] = el;
                }}
                onChoose={(key) => choose(q.id, key)}
              />
            ))}
          </ol>

          {tiebreakerPrompt && (
            <div className="call-tb">
              <label className="call-tb__label" htmlFor="call-tiebreaker">
                Tiebreaker
              </label>
              <p className="call-tb__prompt">{tiebreakerPrompt}</p>
              <input
                id="call-tiebreaker"
                className="call-tb__input"
                type="number"
                inputMode="numeric"
                min={0}
                max={CALL_TIEBREAKER_MAX}
                step={1}
                placeholder="Your number"
                value={tiebreakerText}
                disabled={submitting}
                onChange={(e) => setTiebreakerText(e.target.value)}
              />
              {tiebreakerTouched && tiebreakerValue === null && (
                <p className="call-tb__hint">
                  A whole number from 0 to {points(CALL_TIEBREAKER_MAX)}.
                </p>
              )}
              {/* WHAT THE NUMBER IS FOR, STATED BEFORE IT IS ASKED FOR — and
                  the answer changed. It used to be "so the correspondent can
                  settle an argument", which was true when the tiebreaker decided
                  nothing at all; it now decides Caller of the Week, and a fan
                  typing a guess into a box is owed the reason.

                  BOTH HALVES, IN THIS ORDER. What it wins (a title) and what it
                  does not (move the pot). breaksTies is still false and this
                  sentence is still that flag's copy — the flag's meaning has not
                  moved an inch, it simply stopped being the whole story, and the
                  half that must never be implied is that placing this guess is
                  worth points. See CallerBlock for where the title is paid. */}
              <p className="call-tb__note">
                Recorded with your card, and not scored — no points ride on it.
                The closest guess takes Caller of the Week, a badge and the
                bragging rights, and nothing off the pot.
              </p>
            </div>
          )}

          <AnswerSlip
            answered={answeredCount}
            total={questions.length}
            tiebreakerReady={tiebreakerValue !== null}
            hasEntry={myEntry !== null}
            dirty={dirty}
            complete={complete}
            submitting={submitting}
            error={submitError}
            saved={saved}
            onSubmit={file}
          />

          <footer className="call-foot">
            <p className="call-foot__clock">
              <span className="call-foot__tick" aria-hidden="true">
                ⏳
              </span>
              {call.locksAt
                ? arenaLockCountdown(call.locksAt, now)
                : 'Locks at kickoff'}
              <span className="call-foot__at">
                {' · '}
                {kickoffLabel(call.locksAt)}
              </span>
            </p>
          </footer>
        </>
      )}

      {/* ================= LOCKED ================= */}
      {phase === 'locked' && (
        <div className="call-frozen">
          {myEntry ? (
            <>
              <p className="call-frozen__headline">
                Your card is in the correspondent&apos;s hands.
              </p>
              <p className="call-frozen__sub">
                Locked at kickoff. They grade it from the stands when the game
                ends.
              </p>
            </>
          ) : (
            <>
              <p className="call-frozen__headline">
                Locked at kickoff — you sat this one out.
              </p>
              <p className="call-frozen__sub">
                Here is what was asked. There is a new card on Thursday.
              </p>
            </>
          )}
          <FiledList
            questions={questions}
            entry={myEntry}
            results={null}
            pushesExplainedAbove={false}
          />
          <FiledTiebreaker
            prompt={tiebreakerPrompt}
            answer={myEntry?.tiebreakerAnswer ?? null}
          />
        </div>
      )}

      {/* ================= GRADED — the results view ================= */}
      {phase === 'graded' && (
        <div className="call-frozen call-frozen--graded">
          {/* SWITCHED ON `outcome`, not on the presence of the entry: a card
              that came back without its grading half is a payload this branch
              cannot narrate, and it falls to the sat-it-out reading rather than
              rendering a verdict full of zeroes. */}
          {myEntry && myEntry.outcome === 'graded' ? (
            <VerdictBlock entry={myEntry} questions={questions} />
          ) : (
            <>
              <p className="call-frozen__headline">This one is settled.</p>
              <p className="call-frozen__sub">
                {myEntry
                  ? 'The correspondent has filed their grade.'
                  : 'You sat this one out. Here is what was asked, and what the correspondent called.'}
              </p>
            </>
          )}
          <FiledList
            questions={questions}
            entry={myEntry}
            results={myEntry?.results ?? null}
            pushesExplainedAbove={pushesExplainedAbove}
          />
          {/* THE TITLE RIDES WITH THE TIEBREAKER, not with the settlement below
              — it is decided by the guess sitting one line above it, and it pays
              nothing. Null here is ordinary: a card nobody scored above zero on
              has no Caller, and the block simply isn't drawn. */}
          <FiledTiebreaker
            prompt={tiebreakerPrompt}
            answer={myEntry?.tiebreakerAnswer ?? null}
            actual={call.tiebreaker?.actual ?? null}
            caller={call.tiebreaker?.callerOfTheWeek ?? null}
          />
          {/* THE ROOM'S HALF, LAST — and a long way from the receipt. */}
          {settlement && !settlement.voided && (
            <SettlementBlock
              settlement={settlement}
              pot={call.pot}
              myBand={myEntry?.band ?? null}
              unscored={unscored}
            />
          )}
        </div>
      )}

      {/* ================= VOIDED — the week was washed =================
          THREE CAUSES, ONE BLOCK. callVoidCopy owns which sentence this is;
          nothing about the layout changes with it. The headline does not branch
          — "washed" is what happened in all three, and only the reason differs.
          Nothing here goes warn-coloured either: a void is routine, and
          .call-frozen--voided greys the headline on purpose. */}
      {phase === 'voided' && (
        <div className="call-frozen call-frozen--voided">
          <p className="call-frozen__headline">This one was washed.</p>
          <p className="call-frozen__sub">{callVoidCopy(call)}</p>
          {/* THE WASH PAID SOMETHING, AND THE FAN IS TOLD SO — QUIETLY.
              points_awarded is the one grading column a voided entry carries:
              every void pays participation and scores nothing, whichever of the
              three causes ended the week. It does not lead
              (there is no verdict to celebrate) and it is not the hero figure a
              graded card gets, but a fan whose balance moved is owed the
              sentence that explains why. */}
          {myEntry?.outcome === 'void' &&
            myEntry.pointsAwarded !== null &&
            myEntry.pointsAwarded !== undefined &&
            myEntry.pointsAwarded > 0 && (
              <p className="call-frozen__paid">
                You keep <strong>+{points(myEntry.pointsAwarded)}</strong> for
                filing a card.
              </p>
            )}
          {myEntry && (
            <>
              {/* UNMARKED, ALWAYS. A washed card was never graded, so there are
                  no marks to draw and no resolutions to explain — these answers
                  weren't wrong, they were unread. */}
              <FiledList
                questions={questions}
                entry={myEntry}
                results={null}
                pushesExplainedAbove={false}
              />
              <FiledTiebreaker
                prompt={tiebreakerPrompt}
                answer={myEntry.tiebreakerAnswer}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
