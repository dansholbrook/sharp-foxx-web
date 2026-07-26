'use client';

// ============================================================================
// /arena/call/compose/:callId — THE COMPOSE TOOL. Five questions, a tiebreaker,
// and a publish, in under five minutes on a phone on a Thursday night.
//
// The budget is a product requirement, and three decisions carry it:
//
//   1. THE TEMPLATE PICKER IS THE SERVER'S OWN LIST. `availableTemplates` comes
//      down already filtered to this game's sport, so nothing here can offer a
//      three-pointers question on a football card and nothing has to be kept in
//      sync with the backend's applicability rules.
//
//   2. PICKING A TEMPLATE FILLS ITS PARAMETERS IN. A slot that lands with an
//      empty required number costs a keyboard, and five of those is the budget.
//      Defaults are sport-aware starting points a correspondent EDITS — see
//      app/arena/call/templates.ts.
//
//   3. THE TIEBREAKER IS THREE CHIPS. It is the only free-text field in the
//      flow, and free text on a phone is where five minutes go.
//
// ONE SAVE, AND IT IS THE WHOLE CARD. PUT questions is a REPLACE: the backend
// deletes every question on the Call and re-inserts exactly what is sent. So the
// five slots live in React state and one button writes them. There is no
// per-slot save and there must never be one — a slot-shaped write against a
// whole-card endpoint deletes the other four.
//
// NO SEPARATE PREVIEW ROUND TRIP. The save response carries the server-rendered
// prompts, the generated options AND the publish checklist, so proofreading is a
// re-render rather than a request. GET preview is used once, for a session that
// arrives cold.
//
// ----------------------------------------------------------------------------
// THE ONE THING THIS SCREEN CANNOT DO, stated plainly because it shapes the
// whole component: A CARD IT DID NOT WRITE THIS SESSION IS NOT EDITABLE.
//
// preview() runs its questions through fanQuestionView, which omits `params` —
// only a save (or a publish) echoes params back. So a correspondent who saved
// three questions last night and reopens the tool has the rendered prompts but
// not the numbers behind them, and cannot re-send those slots. Against a
// whole-card replace that is not a partial-edit problem, it is a data-loss one:
// editing slot 4 would mean sending slots 1-3 with GUESSED params and silently
// rewriting three questions that were already right.
//
// So a card loaded cold renders READ-ONLY — the real prompts, the checklist, and
// Publish, all of which work — and the only way back into editing is "Rewrite
// the card", which resets all five, because a whole-card replace is what the
// write actually is. Adding `params` to the preview projection removes this
// entire branch; see docs/call-staff-backend-spec.md P3.
// ----------------------------------------------------------------------------
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../../../auth-context';
import { AccessDenied } from '../../../../nav';
import { canAccess } from '../../../../roles';
import { CallStaffShell, NotYourCall, formatKickoff, relativeTo } from '../../staff';
import {
  CALL_TEMPLATE_FORMS,
  buildCallParams,
  tiebreakerSuggestions,
  validateCallParams,
  CallComposeContext,
} from '../../templates';
import {
  getCallPreview,
  saveCallQuestions,
  publishCall,
  callComposeErrorSlot,
  callStatusLabel,
  callWeekLabel,
  isCallForbidden,
  points,
  CallComposedQuestion,
  CallOption,
  CallPreview,
  CallPublishable,
  CallQuestionInput,
  CallTemplateChoice,
  CallTemplateId,
} from '../../../../api';

const SLOTS = 5;

// One slot as the composer is holding it. `templateId: null` is an empty slot,
// which is legal to save (fewer than five is a draft) and illegal to publish.
type Slot = {
  templateId: CallTemplateId | null;
  params: Record<string, unknown>;
};

const EMPTY_SLOTS: Slot[] = Array.from({ length: SLOTS }, () => ({
  templateId: null,
  params: {},
}));

// What the server last stored for a slot, keyed by index — the authoritative
// text. A slot whose current template+params still match this is SAVED and shows
// the server's prompt; one that differs is unsaved and shows the local preview.
type SavedSlot = {
  templateId: CallTemplateId;
  params: Record<string, unknown>;
  prompt: string;
  options: CallOption[];
};

// Comparing params by shape rather than by key order, which is what
// JSON.stringify would do to `{team, edges}` vs `{edges, team}`.
function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => kb[i] === k && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

// ---------------------------------------------------------------------------
// ONE SLOT.
//
// 56px targets throughout, matching the fan sheet — the same thumb is doing both
// jobs, and this one is being done standing up.
// ---------------------------------------------------------------------------
function SlotEditor({
  slot,
  index,
  templates,
  ctx,
  flagged,
  saved,
  busy,
  blockRef,
  onPick,
  onParams,
}: {
  slot: Slot;
  index: number;
  templates: CallTemplateChoice[];
  ctx: CallComposeContext;
  // This slot is the one the last 400 named.
  flagged: boolean;
  // The server's own rendering, when the slot is saved and unchanged since.
  saved: SavedSlot | null;
  busy: boolean;
  blockRef: (el: HTMLLIElement | null) => void;
  onPick: (templateId: CallTemplateId) => void;
  onParams: (params: Record<string, unknown>) => void;
}) {
  // The picker is open while nothing is chosen, and reopens on "Change".
  const [picking, setPicking] = useState(slot.templateId === null);
  useEffect(() => {
    if (slot.templateId === null) setPicking(true);
  }, [slot.templateId]);

  const form = slot.templateId ? CALL_TEMPLATE_FORMS[slot.templateId] : null;
  const problem = slot.templateId ? validateCallParams(slot.templateId, slot.params) : null;
  // Saved and untouched -> show what the SERVER wrote. Otherwise the local
  // mirror, which is a preview and never a payload.
  const rendered =
    saved && slot.templateId === saved.templateId && sameParams(slot.params, saved.params)
      ? { prompt: saved.prompt, options: saved.options, fromServer: true }
      : form
        ? { ...form.preview(slot.params, ctx), fromServer: false }
        : null;

  function setNumber(key: string, raw: string) {
    // '' clears the key rather than writing NaN — validateCallParams then says
    // "required", which is the honest reading of an emptied field.
    const next = { ...slot.params };
    if (raw.trim() === '') delete next[key];
    else next[key] = Number(raw);
    onParams(next);
  }

  function setEdge(which: 0 | 1, raw: string) {
    const current = Array.isArray(slot.params.edges) ? [...slot.params.edges] : [];
    current[which] = raw.trim() === '' ? undefined : Number(raw);
    onParams({ ...slot.params, edges: current });
  }

  const edges = Array.isArray(slot.params.edges) ? slot.params.edges : [];

  return (
    <li ref={blockRef} className={`call-q compose-slot${flagged ? ' call-q--flagged' : ''}`}>
      <div className="call-q__head">
        <span className="call-q__slot">{index + 1}</span>
        <p className="call-q__prompt">
          {form ? form.id.replace(/_/g, ' ') : 'Choose a question'}
        </p>
        {form && !picking && (
          <button
            type="button"
            className="link-btn compose-slot__change"
            disabled={busy}
            onClick={() => setPicking(true)}
          >
            Change
          </button>
        )}
      </div>

      {picking && (
        <div className="compose-picker">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`console-chip${slot.templateId === t.id ? ' console-chip--on' : ''}`}
              disabled={busy}
              onClick={() => {
                onPick(t.id);
                setPicking(false);
              }}
            >
              {/* The catalog prefix ("T3 - ") is bookkeeping, not copy. */}
              {t.label.replace(/^T\d+\s*-\s*/, '')}
              {t.pushPossible && (
                <span className="compose-push-flag" title="This one can push">
                  ·P
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {form && (
        <>
          <p className="compose-slot__hint">{form.hint}</p>

          {form.fields.length > 0 && (
            <div className="compose-params">
              {form.fields.map((field) => {
                if (field.kind === 'number') {
                  return (
                    <label key={field.key} className="compose-param">
                      <span className="compose-param__label">{field.label}</span>
                      <span className="compose-param__row">
                        <input
                          type="number"
                          inputMode="numeric"
                          step="1"
                          min={field.min}
                          max={field.max}
                          value={
                            typeof slot.params[field.key] === 'number'
                              ? String(slot.params[field.key])
                              : ''
                          }
                          disabled={busy}
                          onChange={(e) => setNumber(field.key, e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                        <span className="compose-param__unit">{field.unit}</span>
                      </span>
                    </label>
                  );
                }
                if (field.kind === 'edges') {
                  return (
                    <div key={field.key} className="compose-param">
                      <span className="compose-param__label">
                        {field.label}{' '}
                        <span className="muted">
                          (three bands, from {field.floor})
                        </span>
                      </span>
                      <span className="compose-param__row">
                        <input
                          type="number"
                          inputMode="numeric"
                          step="1"
                          aria-label="First bucket edge"
                          value={typeof edges[0] === 'number' ? String(edges[0]) : ''}
                          disabled={busy}
                          onChange={(e) => setEdge(0, e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                        <span className="compose-param__unit">and</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          step="1"
                          aria-label="Second bucket edge"
                          value={typeof edges[1] === 'number' ? String(edges[1]) : ''}
                          disabled={busy}
                          onChange={(e) => setEdge(1, e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={field.key} className="compose-param">
                    <span className="compose-param__label">{field.label}</span>
                    <span className="compose-param__row">
                      {(['home', 'away'] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          className={`console-chip${
                            slot.params.team === side ? ' console-chip--on' : ''
                          }`}
                          disabled={busy}
                          onClick={() => onParams({ ...slot.params, team: side })}
                        >
                          {side === 'home' ? ctx.homeTeam : ctx.awayTeam}
                        </button>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* WHAT THE FAN WILL READ. Server text once saved, the local mirror
              while typing — the distinction is drawn on screen rather than
              hidden, because one of them is authoritative and the other is a
              guess this client is making about the server's renderer. */}
          {rendered && (
            <div className="compose-preview">
              <span className="compose-preview__label">
                {rendered.fromServer ? 'Filed ✓' : 'Fans will read'}
              </span>
              <p className="compose-preview__prompt">{rendered.prompt}</p>
              <div className="compose-preview__opts">
                {rendered.options.map((o) => (
                  <span key={o.key} className="compose-preview__opt">
                    {o.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {problem && <p className="compose-slot__problem">{problem}</p>}
        </>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
export default function CallComposePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ callId: string }>();
  const callId = params.callId;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [card, setCard] = useState<CallPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The 403 from assertCanCompose — a state, not a failure. See NotYourCall.
  const [forbidden, setForbidden] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[]>(EMPTY_SLOTS);
  const [tiebreaker, setTiebreaker] = useState('');
  // Slots the server has stored, keyed by index. Populated only by a save or a
  // publish — preview cannot fill it (no params), which is what "editable" turns
  // on. See the header.
  const [savedSlots, setSavedSlots] = useState<Record<number, SavedSlot>>({});
  // A card that arrived already written, which this session cannot edit.
  const [readOnly, setReadOnly] = useState(false);

  const [publishable, setPublishable] = useState<CallPublishable | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<number | null>(null);
  const [published, setPublished] = useState(false);

  // One ref per slot, so a slot-named 400 can be scrolled to. An error at the
  // bottom of a five-slot scroll is an error nobody acts on — the same reason
  // the fan sheet keeps these.
  const slotRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // A minute is plenty: the only clock on this screen is "kickoff in 2 days".
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setForbidden(null);
    try {
      const preview = await getCallPreview(token, callId);
      setCard(preview);
      setPublishable(preview.publishable);
      setTiebreaker(preview.tiebreaker?.prompt ?? '');
      // Questions already on the card, whose params this session does not hold.
      setReadOnly(preview.questions.length > 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open the card';
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

  const ctx: CallComposeContext | null = useMemo(() => {
    if (!card?.event.homeTeam || !card.event.awayTeam) return null;
    return {
      sport: card.event.sport,
      homeTeam: card.event.homeTeam,
      awayTeam: card.event.awayTeam,
    };
  }, [card]);

  function pickTemplate(index: number, templateId: CallTemplateId) {
    if (!card) return;
    setNotice(null);
    setFlagged(null);
    setSlots((prev) =>
      prev.map((s, i) =>
        i === index
          ? {
              templateId,
              // Defaults on pick — the whole point of the picker being one tap
              // rather than a tap plus a keyboard. A template CHANGE also drops
              // the old template's params, which matters: every schema is
              // .strict(), so a leftover key would be a 400.
              params: CALL_TEMPLATE_FORMS[templateId].defaults(card.event.sport),
            }
          : s,
      ),
    );
  }

  function setSlotParams(index: number, next: Record<string, unknown>) {
    setNotice(null);
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, params: next } : s)));
  }

  // The slots that are actually filled in, as the wire wants them. Their INDEX
  // is their position on screen, so a gap stays a gap rather than shifting the
  // questions below it up.
  const filled = slots
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.templateId !== null);

  const slotProblems = filled
    .map(({ s, index }) => ({
      index,
      problem: validateCallParams(s.templateId!, s.params),
    }))
    .filter((p) => p.problem !== null);

  const readyToPublish =
    filled.length === SLOTS && slotProblems.length === 0 && tiebreaker.trim().length > 0;

  function foldSaveResult(
    questions: CallComposedQuestion[],
    nextPublishable: CallPublishable,
  ) {
    const next: Record<number, SavedSlot> = {};
    for (const q of questions) {
      next[q.index] = {
        templateId: q.templateId,
        params: q.params,
        prompt: q.prompt,
        options: q.options,
      };
    }
    setSavedSlots(next);
    setPublishable(nextPublishable);
  }

  // The one write. Returns true so publish can chain off it without a second
  // button — see below.
  async function save(): Promise<boolean> {
    if (!token || busy) return false;
    setBusy(true);
    setSaveError(null);
    setNotice(null);
    setFlagged(null);
    try {
      const questions: CallQuestionInput[] = filled.map(({ s, index }) => ({
        index,
        templateId: s.templateId!,
        // Only the keys this template declares — .strict() on every schema.
        params: buildCallParams(s.templateId!, s.params),
      }));
      const result = await saveCallQuestions(token, callId, {
        questions,
        // undefined would leave the stored prompt alone; the composer's field is
        // the truth here, and an emptied field means "clear it".
        tiebreakerPrompt: tiebreaker.trim() === '' ? null : tiebreaker.trim(),
      });
      foldSaveResult(result.questions, result.publishable);
      setNotice(
        result.questions.length === SLOTS
          ? 'Card saved. Proofread the five below, then publish.'
          : `Saved ${result.questions.length} of ${SLOTS} questions. Finish the card to publish.`,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save the card';
      setSaveError(message);
      // The backend names the slot it choked on. Flag it and put it on screen —
      // both of this endpoint's slot-bearing errors are near-unreachable from
      // here (the picker is the server's own list, params are validated before
      // the PUT), so this is a backstop rather than a routine path.
      const slot = callComposeErrorSlot(message);
      if (slot !== null && slot >= 0 && slot < SLOTS) {
        setFlagged(slot);
        slotRefs.current[slot]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  // SAVE THEN PUBLISH, ONE TAP. Publishing off unsaved state is the mistake this
  // avoids: publish counts questions in its own transaction, so a composer who
  // filled the fifth slot and tapped Publish without saving would get "needs
  // exactly 5 questions (currently 4)" about a card they are looking at.
  async function saveAndPublish() {
    const ok = await save();
    if (!ok) return;
    setBusy(true);
    setSaveError(null);
    try {
      const result = await publishCall(token!, callId);
      setPublished(true);
      // Fold only the fields publishing MOVED. Not a spread of the whole
      // response: it carries the composer's question projection, and this state
      // holds the fan-exact one — merging them would put params-bearing rows
      // into a shape whose whole point is not having them.
      setCard((prev) =>
        prev
          ? {
              ...prev,
              status: result.status,
              publishesAt: result.publishesAt,
              locksAt: result.locksAt,
              pot: result.pot,
            }
          : prev,
      );
      setNotice(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setBusy(false);
    }
  }

  // Publish a card this session did not write (the read-only branch). No save
  // first — there is nothing local to save, and the stored card is what publish
  // will count.
  async function publishOnly() {
    if (!token || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      await publishCall(token, callId);
      setPublished(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const kickoff = card?.event.scheduledAt ?? null;
  const isAdminish = (user?.roles ?? []).some(
    (r) => r === 'admin' || r === 'regional_manager',
  );

  return (
    <CallStaffShell
      kicker={
        card
          ? `${callWeekLabel(card.weekStart)} · ${callStatusLabel(card.status)}`
          : "The Correspondent's Call"
      }
      title={card ? card.event.matchup : 'Compose the card'}
      standfirst={
        card ? (
          <>
            {card.event.venue ? `${card.event.venue} · ` : ''}
            {formatKickoff(kickoff)}
            {relativeTo(kickoff, now) ? ` · kickoff ${relativeTo(kickoff, now)}` : ''}
            {card.correspondent?.displayName
              ? ` · filed by ${card.correspondent.displayName}`
              : ''}
          </>
        ) : undefined
      }
      actions={
        // Editorial only: a field rep has no desk to go back to (they cannot
        // list Calls), so the link would be a 403 dressed as navigation.
        isAdminish ? (
          <Link href="/arena/call/desk" className="link-btn">
            ← Call desk
          </Link>
        ) : undefined
      }
    >
      {loading && <div className="card muted">Opening the card…</div>}
      {error && <div className="error">{error}</div>}
      {forbidden && <NotYourCall detail={forbidden} />}

      {!loading && !forbidden && card && (
        <>
          {/* ---- Published already: composing is over, grading is next. ---- */}
          {(published || card.status !== 'draft') && (
            <section className="card game compose-done">
              <span className="game-kicker">
                {published ? 'Published' : callStatusLabel(card.status)}
              </span>
              <h2>
                {published
                  ? 'The card is live.'
                  : 'This card has already been published.'}
              </h2>
              <p className="compose-done__note">
                Answers lock at kickoff — {formatKickoff(kickoff)}. Questions can
                no longer be rewritten: fans are answering these exact ones. Grade
                it from the stands once the game ends.
              </p>
              <div className="compose-done__links">
                <Link href={`/arena/call/grade/${callId}`} className="btn-inline">
                  Go to the grade sheet
                </Link>
                <Link href="/arena/call" className="link-btn">
                  See the fan card →
                </Link>
              </div>
            </section>
          )}

          {/* ---- The composer, only while it is still a draft. ---- */}
          {!published && card.status === 'draft' && (
            <>
              {/* Both team names are needed to RENDER a question; without them
                  the save 409s as a whole rather than per slot, so refuse up
                  front instead of after five slots of work. */}
              {!ctx ? (
                <div className="results-empty">
                  <p className="results-empty__title">This game needs both teams set</p>
                  <p className="results-empty__hint">
                    Questions are rendered from the team names — &ldquo;Who wins:
                    away or home?&rdquo; — so a game missing one has nothing to
                    render. Set both teams on the game, then come back.
                  </p>
                </div>
              ) : readOnly ? (
                // ---- The cold-start card: real prompts, publish works,
                //      editing means rewriting. See the header. ----
                <section className="card game">
                  <span className="game-kicker">Filed</span>
                  <h2>The card as it stands</h2>
                  <p className="compose-readonly__note">
                    {card.questions.length} of {SLOTS} questions are saved. You can
                    publish this card as it is — but the numbers behind each
                    question (lines, buckets) don&apos;t come back down with a
                    saved card, so editing one means writing all five again.
                  </p>
                  <ol className="call-qs compose-readonly">
                    {card.questions.map((q) => (
                      <li key={q.id} className="call-q">
                        <div className="call-q__head">
                          <span className="call-q__slot">{q.index + 1}</span>
                          <p className="call-q__prompt">{q.prompt}</p>
                        </div>
                        <div className="compose-preview__opts">
                          {q.options.map((o) => (
                            <span key={o.key} className="compose-preview__opt">
                              {o.label}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="call-tb">
                    <span className="call-tb__label">Tiebreaker</span>
                    <p className="call-tb__prompt">
                      {card.tiebreaker?.prompt ?? (
                        <span className="muted">Not written yet.</span>
                      )}
                    </p>
                  </div>
                  <div className="compose-actions">
                    <button
                      type="button"
                      className="call-file"
                      disabled={busy || !publishable?.ready}
                      onClick={publishOnly}
                    >
                      {busy ? 'Publishing…' : 'Publish the card'}
                    </button>
                    <button
                      type="button"
                      className="btn-inline btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setReadOnly(false);
                        setSlots(EMPTY_SLOTS);
                        setSavedSlots({});
                        setNotice(
                          'Writing a fresh card. Saving replaces all five questions.',
                        );
                      }}
                    >
                      Rewrite the card
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  <ol className="call-qs">
                    {slots.map((slot, i) => (
                      <SlotEditor
                        key={i}
                        slot={slot}
                        index={i}
                        templates={card.availableTemplates}
                        ctx={ctx}
                        flagged={flagged === i}
                        saved={savedSlots[i] ?? null}
                        busy={busy}
                        blockRef={(el) => {
                          slotRefs.current[i] = el;
                        }}
                        onPick={(t) => pickTemplate(i, t)}
                        onParams={(p) => setSlotParams(i, p)}
                      />
                    ))}
                  </ol>

                  {/* ---- The tiebreaker: three chips, then the field. ---- */}
                  <div className="call-tb">
                    <span className="call-tb__label">Tiebreaker</span>
                    <div className="compose-tb__chips">
                      {tiebreakerSuggestions(card.event.sport).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`console-chip${
                            tiebreaker === s ? ' console-chip--on' : ''
                          }`}
                          disabled={busy}
                          onClick={() => setTiebreaker(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <input
                      className="call-tb__input"
                      value={tiebreaker}
                      placeholder="Or write your own…"
                      maxLength={200}
                      disabled={busy}
                      aria-label="Tiebreaker prompt"
                      onChange={(e) => setTiebreaker(e.target.value)}
                    />
                    <p className="call-tb__hint">
                      A number every fan can guess and you can read off the
                      scoreboard. It settles nothing about the money — it is the
                      record of how close the room got.
                    </p>
                  </div>

                  {/* ---- The checklist. Server copy, verbatim. ---- */}
                  {publishable && !publishable.ready && publishable.problems.length > 0 && (
                    <div className="compose-checklist">
                      <span className="console-label">Before this can publish</span>
                      <ul className="compose-checklist__list">
                        {publishable.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {notice && !saveError && <div className="success">{notice}</div>}
                  {saveError && <div className="error">{saveError}</div>}

                  <div className="compose-actions">
                    <button
                      type="button"
                      className="call-file"
                      disabled={busy || !readyToPublish}
                      onClick={saveAndPublish}
                    >
                      {busy ? 'Working…' : 'Save & publish'}
                    </button>
                    {/* A half-finished CARD is savable (fewer than five is a
                        legal draft); a half-finished SLOT is not — an emptied
                        number would go out as null and come back a 400. So the
                        gate is "every slot you HAVE written is valid", not
                        "you have written five". */}
                    <button
                      type="button"
                      className="btn-inline btn-ghost"
                      disabled={busy || filled.length === 0 || slotProblems.length > 0}
                      onClick={() => void save()}
                    >
                      Save draft
                    </button>
                    <span className="compose-actions__count">
                      {filled.length}/{SLOTS} written
                      {card.pot.points ? ` · pot ${points(card.pot.points)}` : ''}
                    </span>
                  </div>

                  {/* Why the big button is off. Named by SLOT (1-based, the
                      number on screen) rather than left to be hunted for. */}
                  {!readyToPublish && filled.length > 0 && (
                    <p className="compose-actions__why">
                      {slotProblems.length > 0
                        ? `Question ${slotProblems[0].index + 1} needs fixing first.`
                        : filled.length < SLOTS
                          ? `${SLOTS - filled.length} more question${
                              SLOTS - filled.length === 1 ? '' : 's'
                            } before this can publish.`
                          : 'Add a tiebreaker to publish.'}
                    </p>
                  )}
                </>
              )}

              {/* ---- The handoff line. A draft's id is not readable by the
                   correspondent through any route they can call, so until
                   scope=mine exists this link IS their way in. Editorial only —
                   the correspondent is already here. ---- */}
              {isAdminish && card.correspondent && (
                <p className="compose-handoff">
                  <span className="console-label">
                    Send to {card.correspondent.displayName ?? 'the correspondent'}
                  </span>
                  <span className="mono compose-handoff__url">
                    /arena/call/compose/{callId}
                  </span>
                  <span className="callstaff-help">
                    A correspondent cannot list their own drafts yet, so this link
                    is how they reach the card before it publishes.
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}
    </CallStaffShell>
  );
}
