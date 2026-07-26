'use client';

// ============================================================================
// /arena/call/grade/:callId — THE GRADE TOOL. Five verdicts, a number, and a
// payment, in under two minutes on a phone in a parking lot after the whistle.
//
// This is the screen the whole game depends on. If grading is slow,
// correspondents quietly stop filing and the game dies — so every decision here
// is made against the clock, and the clock wins.
//
// ----------------------------------------------------------------------------
// ONE TAP PER QUESTION. THE OPTIONS *ARE* THE BUTTONS.
//
// A verdict is two facts — how it resolved, and if it was answered, which option
// won — and the obvious UI asks for them in that order: pick 'answered', then
// pick the winner. That is ten taps for five questions, and it puts a mode
// switch in front of every single one.
//
// So the row is flattened: tapping an OPTION sets resolution 'answered' AND
// correctKey together, in one tap. Push and "couldn't see it" sit alongside as
// their own buttons, quieter, because they are the exceptions. Five questions,
// five taps.
//
// This is the courtside console's rule verbatim ("the options ARE the buttons —
// no select, no second dialog before the confirm"), and it is the reason the
// budget is reachable at all.
// ----------------------------------------------------------------------------
//
// THREE VERDICTS, NEVER TWO, and the difference is not cosmetic:
//   answered — it was called, and the winning option is named.
//   push     — the game landed exactly on the number. A fact about THE GAME.
//   void     — the correspondent could not see it. A fact about THE COVERAGE.
// A void scores as a push for the fan, but they are different sentences and the
// backend stores them apart, so the screen must ask them apart.
//
// PUSH IS ONLY OFFERED WHERE IT CAN HAPPEN — three of the twelve templates. But
// the grade sheet does NOT carry templateId, so that fact is not on this
// endpoint: it comes from a parallel `preview` read, joined on question id. If
// that read fails, Push is offered everywhere and nothing breaks (the server
// accepts a push on any question; only the game decides whether there was one).
//
// ONE WRITE, WHOLE CARD. POST grade takes all five verdicts plus the tiebreaker
// or it 400s. There is no partial save, by design — a two-step flow is what gets
// abandoned in the rain, and an abandoned grade is a pot that never pays.
//
// dryRun IS OFF THE DEFAULT PATH. It computes the entire settlement and writes
// nothing, which is genuinely useful — and it costs a round trip this budget
// does not have. So it is a link a correspondent can reach, never a step they
// must take.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../../../auth-context';
import { AccessDenied } from '../../../../nav';
import { canAccess } from '../../../../roles';
import { SlideOver } from '../../../../queue-table';
import { CallStaffShell, NotYourCall, formatKickoff, relativeTo } from '../../staff';
import {
  getCallGradeSheet,
  getCallPreview,
  gradeCall,
  voidCall,
  callErrorSlot,
  callStatusLabel,
  callWeekLabel,
  isCallForbidden,
  points,
  CALL_TIEBREAKER_MAX,
  CallGradeAnswer,
  CallGradeResolution,
  CallGradeResult,
  CallGradeSheet,
  CallPreview,
  CallVoidResult,
} from '../../../../api';

// One question's verdict as the correspondent is holding it.
type Verdict = { resolution: CallGradeResolution; correctKey: string | null };

export default function CallGradePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ callId: string }>();
  const callId = params.callId;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [sheet, setSheet] = useState<CallGradeSheet | null>(null);
  // Best-effort, and ONLY for templateId -> pushPossible. Never gates the page.
  const [preview, setPreview] = useState<CallPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [tiebreaker, setTiebreaker] = useState('');

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<number | null>(null);
  // The receipt: what the POST actually did. Replaces the sheet when it lands.
  const [result, setResult] = useState<CallGradeResult | null>(null);
  // The dry run's settlement, shown inline. Distinct state from `result` so a
  // preview can never be mistaken for a payment that happened.
  const [dry, setDry] = useState<CallGradeResult | null>(null);
  // The wash's own receipt — see washIt for why it is not folded into `result`.
  const [voided, setVoided] = useState<CallVoidResult | null>(null);
  const [showVoid, setShowVoid] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setForbidden(null);
    try {
      // Fired together, settled independently: the sheet gates the page, the
      // preview only decorates it.
      const [gradeSheet, previewCard] = await Promise.all([
        getCallGradeSheet(token, callId),
        getCallPreview(token, callId).catch(() => null),
      ]);
      setSheet(gradeSheet);
      setPreview(previewCard);
      // SEED FROM WHAT WAS GRADED LAST TIME. On a first grade every resolution
      // is 'pending' and nothing seeds — a correspondent should not find five
      // pre-filled verdicts they did not give. On a REGRADE the previous card is
      // exactly what they came to change, so it is all here.
      const seeded: Record<string, Verdict> = {};
      for (const q of gradeSheet.questions) {
        if (q.resolution !== 'pending') {
          seeded[q.id] = { resolution: q.resolution, correctKey: q.correctKey };
        }
      }
      setVerdicts(seeded);
      setTiebreaker(
        gradeSheet.tiebreaker.actual === null ? '' : String(gradeSheet.tiebreaker.actual),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open the sheet';
      if (isCallForbidden(message)) setForbidden(message.replace(/^403\s*/, ''));
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, callId]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    void load();
  }, [token, router, allowed, load]);

  // questionId -> can this template push. Absent means "we don't know", which
  // renders as "offer it": a Push button on a question that cannot push is a
  // button nobody taps, while a MISSING one on a question that can is a
  // correspondent forced to record a wrong verdict.
  const pushable = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!preview) return map;
    const byTemplate = new Map(preview.availableTemplates.map((t) => [t.id, t.pushPossible]));
    for (const q of preview.questions) {
      const known = byTemplate.get(q.templateId);
      if (known !== undefined) map[q.id] = known;
    }
    return map;
  }, [preview]);

  function setVerdict(questionId: string, verdict: Verdict) {
    setSubmitError(null);
    setFlagged(null);
    setDry(null);
    setVerdicts((prev) => ({ ...prev, [questionId]: verdict }));
  }

  const questions = sheet?.questions ?? [];
  const done = questions.filter((q) => verdicts[q.id]).length;
  const tbNum = Number(tiebreaker);
  const tbValid =
    tiebreaker.trim() !== '' &&
    Number.isInteger(tbNum) &&
    tbNum >= 0 &&
    tbNum <= CALL_TIEBREAKER_MAX;
  const complete = questions.length > 0 && done === questions.length && tbValid;

  const isRegrade = sheet?.status === 'graded';

  function payload(): { answers: CallGradeAnswer[]; tiebreakerActual: number } {
    return {
      answers: questions.map((q) => {
        const v = verdicts[q.id];
        return {
          questionId: q.id,
          resolution: v.resolution,
          // ONLY on 'answered'. A push or a void carrying a key is a 400 naming
          // the slot — the DB has the same rule as a CHECK, and sending null
          // rather than omitting it is what keeps the two agreeing.
          ...(v.resolution === 'answered' ? { correctKey: v.correctKey } : {}),
        };
      }),
      tiebreakerActual: tbNum,
    };
  }

  async function submit(dryRun: boolean) {
    if (!token || !complete || busy) return;
    setBusy(true);
    setSubmitError(null);
    setFlagged(null);
    try {
      const res = await gradeCall(token, callId, payload(), dryRun);
      if (dryRun) setDry(res);
      else {
        setResult(res);
        setDry(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to grade the card';
      setSubmitError(message);
      // The grade path names its slot 1-BASED, the same way the fan entry path
      // does — so callErrorSlot is the right parser here (and callComposeErrorSlot
      // is the wrong one; compose counts from zero).
      const slot = callErrorSlot(message);
      if (slot !== null) setFlagged(slot);
    } finally {
      setBusy(false);
    }
  }

  async function washIt() {
    if (!token || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await voidCall(token, callId);
      setShowVoid(false);
      // KEPT IN ITS OWN STATE rather than folded into `result`. A wash and a
      // grade are different events with different receipts — there is no pot, no
      // band, and no score — and forcing one into the other's shape would mean
      // rendering zeroes that read like a settlement that paid nothing.
      //
      // 'already_terminal' is not a failure either: the card was graded or
      // voided under us, and the re-read below is what says so.
      setVoided(res);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to void the card');
      setShowVoid(false);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const kickoff = sheet?.locksAt ?? null;
  const terminal = sheet?.status === 'voided';
  const neverPublished = sheet?.status === 'draft';

  return (
    <CallStaffShell
      kicker={
        sheet
          ? `${callWeekLabel(sheet.weekStart)} · ${callStatusLabel(sheet.status)}`
          : "The Correspondent's Call"
      }
      title={preview?.event.matchup ?? 'Grade the card'}
      standfirst={
        sheet ? (
          <>
            {sheet.entries} card{sheet.entries === 1 ? '' : 's'} filed ·{' '}
            {points(sheet.pot)} in the pot
            {kickoff ? ` · kickoff ${formatKickoff(kickoff)}` : ''}
          </>
        ) : undefined
      }
      actions={
        <Link href="/arena/call" className="link-btn">
          Fan card →
        </Link>
      }
    >
      {loading && <div className="card muted">Opening the sheet…</div>}
      {error && <div className="error">{error}</div>}
      {forbidden && <NotYourCall detail={forbidden} />}

      {!loading && !forbidden && sheet && (
        <>
          {/* ---- THE RECEIPT. Replaces the sheet once something has been paid. ---- */}
          {result && (
            <section className="card game grade-receipt">
              <span className="game-kicker">
                {result.status === 'regraded' ? 'Regraded' : 'Graded'}
              </span>
              <h2 className="grade-receipt__headline">
                {points(result.pointsPaid)} points paid
              </h2>
              <p className="grade-receipt__sub">
                {result.entries} card{result.entries === 1 ? '' : 's'} settled ·{' '}
                {result.whistles} Golden Whistle{result.whistles === 1 ? '' : 's'} ·{' '}
                {points(result.potPaid)} of the {points(result.pot)} pot paid out
              </p>

              {result.bands.length > 0 ? (
                <ul className="grade-bands">
                  {result.bands.map((b) => (
                    <li key={b.band} className="grade-bands__row">
                      <span className="grade-bands__rank">Band {b.band}</span>
                      <span className="grade-bands__score">
                        {b.score} correct · {b.members} fan{b.members === 1 ? '' : 's'}
                      </span>
                      <span className="grade-bands__pts">{points(b.share)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                // THE DEGENERATE CARD, and it is not an error: the grader refuses
                // to split a purse when the top score is zero. Two different
                // cards reach it (everyone wrong, or every question pushed) and
                // both deserve the sentence rather than an empty box.
                <p className="grade-receipt__degenerate">
                  No band paid out. Nobody scored above zero on this card, so the
                  pot stays where it is — participation and per-correct points
                  were still paid.
                </p>
              )}

              {result.potOverpaid > 0 && (
                <p className="grade-receipt__over">
                  {points(result.potOverpaid)} points are held above what this
                  settlement says is owed — a regrade never claws back, so those
                  fans keep the difference.
                </p>
              )}

              {result.warnings.map((w) => (
                <p key={w} className="grade-receipt__warn">
                  {w}
                </p>
              ))}

              <div className="compose-done__links">
                <Link href="/arena/call" className="btn-inline">
                  See the fan card
                </Link>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setResult(null);
                    void load();
                  }}
                >
                  Back to the sheet
                </button>
              </div>
            </section>
          )}

          {/* ---- THE WASH'S RECEIPT. No pot, no bands, no score — the three
               things a graded card's receipt is made of, and none of them
               happened here. ---- */}
          {voided && (
            <section className="card game grade-receipt">
              <span className="game-kicker">
                {voided.status === 'voided' ? 'Voided' : 'Already settled'}
              </span>
              {voided.status === 'voided' ? (
                <>
                  <h2 className="grade-receipt__headline">
                    {points(voided.pointsPaid)} points paid
                  </h2>
                  <p className="grade-receipt__sub">
                    {voided.entries} entrant{voided.entries === 1 ? '' : 's'} kept
                    their participation points. Nothing was scored and the pot paid
                    out nothing.
                  </p>
                </>
              ) : (
                <p className="grade-receipt__sub">
                  This card was already graded or already voided, so the wash did
                  nothing. Nothing was paid twice.
                </p>
              )}
              <div className="compose-done__links">
                <Link href="/arena/call" className="btn-inline">
                  See the fan card
                </Link>
              </div>
            </section>
          )}

          {!result && !voided && neverPublished && (
            <div className="results-empty">
              <p className="results-empty__title">This card was never published</p>
              <p className="results-empty__hint">
                There is nothing to grade — no fan has answered it. Finish the
                card and publish it first.
              </p>
              <p className="results-empty__hint">
                <Link href={`/arena/call/compose/${callId}`} className="callstaff-inline-link">
                  Go to the compose tool →
                </Link>
              </p>
            </div>
          )}

          {!result && !voided && terminal && (
            <div className="results-empty">
              <p className="results-empty__title">This card was voided</p>
              <p className="results-empty__hint">
                Nothing was scored and every entrant kept their participation
                points. A voided card cannot be graded afterwards.
              </p>
            </div>
          )}

          {/* ---- BEFORE KICKOFF: the sheet renders, but grading is not open.
               Void is, though — games get called off in the morning, and it is
               deliberately not gated on the clock. ---- */}
          {!result && !voided && !terminal && !neverPublished && !sheet.locked && (
            <div className="results-empty">
              <p className="results-empty__title">The game hasn&apos;t started yet</p>
              <p className="results-empty__hint">
                Answers lock at kickoff — {formatKickoff(kickoff)}
                {relativeTo(kickoff, now) ? `, ${relativeTo(kickoff, now)}` : ''}. There
                is nothing to grade until then, and the card is still taking
                entries.
              </p>
            </div>
          )}

          {/* ---- THE SHEET. ---- */}
          {!result && !voided && !terminal && !neverPublished && sheet.locked && (
            <>
              {isRegrade && (
                <div className="grade-regrade">
                  <span className="console-label">Regrading</span>
                  <p>
                    This card is already settled and these are the verdicts it was
                    settled on. Changing one and grading again pays the difference
                    to whoever is owed more — nothing is ever taken back from
                    anyone.
                  </p>
                </div>
              )}

              <ol className="call-qs grade-qs">
                {sheet.questions.map((q) => {
                  const v = verdicts[q.id];
                  // Unknown -> offer it. See the header.
                  const canPush = pushable[q.id] ?? true;
                  return (
                    <li
                      key={q.id}
                      className={`call-q grade-q${
                        flagged === q.index ? ' call-q--flagged' : ''
                      }${v ? ' grade-q--done' : ''}`}
                    >
                      <div className="call-q__head">
                        <span className="call-q__slot">{q.index + 1}</span>
                        <p className="call-q__prompt">{q.prompt}</p>
                      </div>

                      {/* ONE TAP: the option sets 'answered' and names the
                          winner together. */}
                      <div className="call-q__options">
                        {q.options.map((o) => {
                          const on =
                            v?.resolution === 'answered' && v.correctKey === o.key;
                          return (
                            <button
                              key={o.key}
                              type="button"
                              className={`call-opt${on ? ' call-opt--on' : ''}`}
                              aria-pressed={on}
                              disabled={busy}
                              onClick={() =>
                                setVerdict(q.id, {
                                  resolution: 'answered',
                                  correctKey: o.key,
                                })
                              }
                            >
                              <span className="call-opt__label">{o.label}</span>
                              <span className="call-opt__tick" aria-hidden="true">
                                ✓
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* The two exceptions, quieter than the options they sit
                          under — and worded as what they MEAN, because "push"
                          and "void" are not what a correspondent is thinking. */}
                      <div className="grade-alts">
                        {canPush && (
                          <button
                            type="button"
                            className={`grade-alt${
                              v?.resolution === 'push' ? ' grade-alt--on' : ''
                            }`}
                            disabled={busy}
                            aria-pressed={v?.resolution === 'push'}
                            onClick={() =>
                              setVerdict(q.id, { resolution: 'push', correctKey: null })
                            }
                          >
                            Landed on the number
                          </button>
                        )}
                        <button
                          type="button"
                          className={`grade-alt grade-alt--void${
                            v?.resolution === 'void' ? ' grade-alt--on' : ''
                          }`}
                          disabled={busy}
                          aria-pressed={v?.resolution === 'void'}
                          onClick={() =>
                            setVerdict(q.id, { resolution: 'void', correctKey: null })
                          }
                        >
                          Couldn&apos;t call it
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* ---- The tiebreaker actual. The one keyboard on this screen. ---- */}
              <div className="call-tb">
                <span className="call-tb__label">Tiebreaker</span>
                <p className="call-tb__prompt">
                  {sheet.tiebreaker.prompt ?? 'No tiebreaker prompt on this card.'}
                </p>
                <input
                  className="call-tb__input"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  max={CALL_TIEBREAKER_MAX}
                  value={tiebreaker}
                  placeholder="What was it?"
                  disabled={busy}
                  aria-label="Tiebreaker actual"
                  onChange={(e) => {
                    setTiebreaker(e.target.value);
                    setSubmitError(null);
                    setDry(null);
                  }}
                  onFocus={(e) => e.target.select()}
                />
                <p className="call-tb__hint">
                  Recorded, not scored — fans tied on the same score are in the
                  same band and paid the same. It is the record of how close the
                  room got.
                </p>
              </div>

              {/* ---- The dry run, when asked for. Never a step. ---- */}
              {dry && (
                <div className="grade-dry">
                  <span className="console-label">Checked — nothing paid yet</span>
                  <p className="grade-dry__line">
                    {points(dry.pointsPaid)} points would go out across {dry.entries}{' '}
                    card{dry.entries === 1 ? '' : 's'} · {dry.whistles} Golden
                    Whistle{dry.whistles === 1 ? '' : 's'} ·{' '}
                    {points(dry.potPaid)} of the pot
                  </p>
                  {dry.bands.length === 0 && (
                    <p className="grade-dry__line">
                      No band would pay: nobody scores above zero on these
                      verdicts.
                    </p>
                  )}
                  {dry.bands.map((b) => (
                    <p key={b.band} className="grade-dry__line">
                      Band {b.band}: {b.members} fan{b.members === 1 ? '' : 's'} at{' '}
                      {b.score} correct, {points(b.share)} between them
                    </p>
                  ))}
                </div>
              )}

              {submitError && <div className="error">{submitError}</div>}

              <div className="grade-actions">
                <button
                  type="button"
                  className="call-file"
                  disabled={!complete || busy}
                  onClick={() => void submit(false)}
                >
                  {busy
                    ? 'Working…'
                    : isRegrade
                      ? 'Regrade and pay the difference'
                      : `Grade and pay ${sheet.entries} card${sheet.entries === 1 ? '' : 's'}`}
                </button>
                <div className="grade-actions__meta">
                  <span className="grade-actions__count">
                    {done}/{sheet.questions.length} called
                    {!tbValid && done === sheet.questions.length
                      ? ' · needs the tiebreaker'
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={!complete || busy}
                    onClick={() => void submit(true)}
                  >
                    Check without paying
                  </button>
                </div>
              </div>

              {/* ---- THE WASH. Below everything, behind a disclosure, and never
                   adjacent to the grade button: it pays every entrant, scores
                   nothing, and ends the week. ---- */}
              <div className="grade-wash">
                <button
                  type="button"
                  className="link-btn grade-wash__open"
                  onClick={() => setShowVoid(true)}
                >
                  The game didn&apos;t happen →
                </button>
              </div>
            </>
          )}

          {/* Void is reachable before kickoff too — a game called off in the
              morning never reaches the locked state at all. */}
          {!result && !voided && !terminal && !neverPublished && !sheet.locked && (
            <div className="grade-wash">
              <button
                type="button"
                className="link-btn grade-wash__open"
                onClick={() => setShowVoid(true)}
              >
                The game didn&apos;t happen →
              </button>
            </div>
          )}

          {showVoid && (
            <SlideOver
              onClose={() => setShowVoid(false)}
              label="Void this Call"
              kicker="Ends the week"
              title="Void the card"
              footer={
                <>
                  <button
                    type="button"
                    className="btn-inline grade-void__confirm"
                    disabled={busy}
                    onClick={() => void washIt()}
                  >
                    {busy ? 'Voiding…' : 'Yes — void the card'}
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => setShowVoid(false)}
                  >
                    Cancel
                  </button>
                </>
              }
            >
              <p>
                This washes the Call. Every one of the{' '}
                <strong>
                  {sheet.entries} entrant{sheet.entries === 1 ? '' : 's'}
                </strong>{' '}
                keeps their participation points, <strong>nothing is scored</strong>,
                and the {points(sheet.pot)} pot pays out nothing at all.
              </p>
              <p>
                It ends the week: there is one Call per week, and a voided one
                cannot be graded afterwards. If you can call even some of the
                questions, grading them and voiding the rest individually is the
                better outcome — a question you couldn&apos;t see costs a fan
                nothing.
              </p>
              <p className="muted">
                This is for a game that was called off, abandoned, or never
                played. It cannot be undone.
              </p>
            </SlideOver>
          )}
        </>
      )}
    </CallStaffShell>
  );
}
