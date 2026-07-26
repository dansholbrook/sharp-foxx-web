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
//   GRADED   — a DELIBERATELY THIN holding state. See the note below.
//   VOIDED   — the 24h sweep fired: nobody graded it, and it was washed.
//
// ----------------------------------------------------------------------------
// THE GRADED BRANCH IS THIN ON PURPOSE, AND IT IS THE ONE THING ON THIS SURFACE
// THAT IS WAITING ON THE BACKEND.
//
//   GET /arena/call/current selects no grading columns at all — not the answer
//   key, not the per-question resolution, not the fan's own results map, score
//   or payout, not the tiebreaker's actual value. So a graded card here can
//   honestly show the fan WHAT THEY FILED and say the correspondent has graded
//   it, and nothing more. It does not show a score of 0, an empty results row,
//   or a payout of "—", because every one of those is a claim the payload
//   cannot back and three of them would read as a loss.
//
//   Falling through to the LOCKED reading instead was the alternative and it is
//   worse: it would tell a fan their graded card is still awaiting a grade.
//
//   See the CallCurrent header in api.ts for exactly what the results view needs
//   added before it can be built.
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
  callWeekLabel,
  points,
  CALL_QUESTION_COUNT,
  CALL_TIEBREAKER_MAX,
  CallCard,
  CallEntry,
  CallEntryInput,
  CallEntryResult,
  CallPayouts,
  CallQuestion,
} from '../../api';

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

// "Saturday, July 25 · 7:00 PM" — the game, in the fan's own zone. A real
// timestamp, so it converts like every other time on the site.
function kickoffLabel(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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
// ---------------------------------------------------------------------------
function FiledList({
  questions,
  entry,
}: {
  questions: CallQuestion[];
  entry: CallEntry | null;
}) {
  return (
    <ol className="call-filed">
      {questions.map((q, i) => {
        const key = entry?.answers[q.id] ?? null;
        const label = q.options.find((o) => o.key === key)?.label ?? null;
        return (
          <li key={q.id} className="call-filed__row">
            <span className="call-filed__slot">{i + 1}</span>
            <span className="call-filed__prompt">{q.prompt}</span>
            <span
              className={`call-filed__answer${
                label ? '' : ' call-filed__answer--none'
              }`}
            >
              {/* A key with no matching option means the card was re-saved after
                  this entry was filed. Show the raw key rather than an em-dash:
                  "they answered something we can no longer name" is true, and
                  "they didn't answer" is not. */}
              {label ?? (key ? key : '—')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// The tiebreaker as filed. Its own row rather than a sixth question, because it
// is not scored — it is recorded on the Call and plays no part in the band
// split, and rendering it in the list would imply it broke something.
function FiledTiebreaker({
  prompt,
  answer,
}: {
  prompt: string | null;
  answer: number | null;
}) {
  if (!prompt) return null;
  return (
    <div className="call-filed__tb">
      <span className="call-filed__tblabel">Tiebreaker</span>
      <span className="call-filed__tbprompt">{prompt}</span>
      <span className="call-filed__tbanswer">
        {answer === null ? '—' : points(answer)}
      </span>
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
// ---------------------------------------------------------------------------
function PotBlock({ pot, open }: { pot: CallCard['pot']; open: boolean }) {
  return (
    <div className="call-pot">
      <div className="call-pot__head">
        <span className="call-pot__label">
          {open ? 'Pot so far' : 'The pot'}
        </span>
        <span className="call-pot__value">{points(pot.projectedPoints)}</span>
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
        {pot.bands.map((b) => (
          <li key={b.band} className="call-pot__band">
            <span className="call-pot__bandrank">
              {b.band === 1
                ? 'Top score'
                : b.band === 2
                  ? '2nd score'
                  : `${b.band}rd score`}
            </span>
            <span className="call-pot__bandpct">{b.pct}%</span>
          </li>
        ))}
      </ul>
      <p className="call-pot__split">
        Every fan tied at a score splits that band evenly.
      </p>
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
  payouts,
  now,
  onSubmit,
  submitting,
  submitError,
  saved,
}: {
  // The CURRENT ET week, which is not necessarily the card's week — see below.
  weekStart: string;
  call: CallCard | null;
  myEntry: CallEntry | null;
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
  const editable = phase === 'open';

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

      {/* The pot, on every state EXCEPT a void — a washed card paid nothing, and
          a purse figure over "this one was washed" reads as something owed. */}
      {phase !== 'voided' && (
        <PotBlock pot={call.pot} open={phase === 'open'} />
      )}

      {/* ================= OPEN: THE SHEET ================= */}
      {phase === 'open' && (
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
              <p className="call-tb__note">
                Recorded with your card. It is not scored — it is there so the
                correspondent can settle an argument.
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
          <FiledList questions={questions} entry={myEntry} />
          <FiledTiebreaker
            prompt={tiebreakerPrompt}
            answer={myEntry?.tiebreakerAnswer ?? null}
          />
        </div>
      )}

      {/* ================= GRADED — the thin holding state ================= */}
      {phase === 'graded' && (
        <div className="call-frozen call-frozen--graded">
          <p className="call-frozen__headline">
            The correspondent has filed their grade.
          </p>
          <p className="call-frozen__sub">
            {myEntry
              ? 'This is the card you locked in. Your score and what it paid land in your points statement.'
              : 'You sat this one out. Here is what was asked.'}
          </p>
          <FiledList questions={questions} entry={myEntry} />
          <FiledTiebreaker
            prompt={tiebreakerPrompt}
            answer={myEntry?.tiebreakerAnswer ?? null}
          />
          {/* NO SCORE, NO ANSWER KEY, NO PAYOUT — none of the three is in this
              payload, and a zero would read as a loss. See the file header. */}
        </div>
      )}

      {/* ================= VOIDED — the 24h sweep fired ================= */}
      {phase === 'voided' && (
        <div className="call-frozen call-frozen--voided">
          <p className="call-frozen__headline">This one was washed.</p>
          <p className="call-frozen__sub">
            The card went ungraded and the week was voided — nothing counted
            against you. There is a new game on Thursday.
          </p>
          {myEntry && (
            <>
              <FiledList questions={questions} entry={myEntry} />
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
