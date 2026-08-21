'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AccessDenied } from '../../nav';
import { StatLinesPanel } from './stat-lines';
import { canAccess } from '../../roles';
import { useOwnRep, TrainingGate } from '../../training-gate';
import { getMyAssignments, updateAssignment, generateArticle, getEventContent, getContentItem, updateContent, submitContent, publishContent, unpublishContent, getEvents, updateEventResult, getMyAdOrders, getAdvertisers, getEventSponsorship, createSponsorship, deleteSponsorship, getLiveEvents, createLiveEvent, deleteLiveEvent, presignGamePhoto, uploadToPresignedUrl, confirmMedia, getGamePhotos, deleteMedia, getEventPredictions, createPrediction, lockPrediction, resolvePrediction, voidPrediction, getCallEvents, callWeekLabel, callListPhase, callStaffRoute, points, etDateTime, etDateKey, eventStatusLabel, etTime, CallListItem, Prediction, PredictionKind, MyAssignment, ContentItem, EventContentItem, UpdateEventResultInput, EventResult, AdOrder, Sponsorship, LiveEvent, LiveEventType, GamePhoto, teamLabel } from '../../api';

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// The scores/replay link already on an event, used to pre-fill the Report Result
// form. /assignments/mine doesn't carry these, so the workspace loads them from
// GET /events and seeds the form by event id.
type ResultSeed = {
  homeScore: number | null;
  awayScore: number | null;
  videoUrl: string | null;
  status: MyAssignment['event']['status'];
};

// The editable article state accepts either the joined listing row we load on
// mount (EventContentItem) or the bare ContentItem returned by generate/edit/
// publish. Only the overlapping fields (id/status/title/body/publishedAt) are
// ever read, so the union needs no mapping.
type EditableArticle = ContentItem | EventContentItem;

// The status values a rep can move an assignment through, in workflow order.
const STATUSES: MyAssignment['status'][] = ['assigned', 'accepted', 'submitted'];

// Format the timestamptz string the API returns, in ET; fall back to the raw
// value if it somehow doesn't parse. Labelled — this is the kickoff the rep is
// filing against.
function formatWhen(iso: string): string {
  return etDateTime(iso, { zone: true }) || iso;
}

// The matchup as readable team names ("Home vs Away"), or null when either side
// is missing a name -- in which case the header falls back to the sport headline.
// ---- E7 ON THE WORKSPACE ASSIGNMENT SHAPE -------------------------------
// This read `${homeTeam} vs ${awayTeam}` off the RAW team names, so a covered
// college fixture rendered "Georgia State University Basketball (M) Vs Albany
// State University Basketball (M)" -- the sport and the gender repeated twice
// in a line that is supposed to say which game you are at.
//
// `assignment.event` is the inline shape E8 called out as missing from BOTH
// halves of its own sweep: it is not EventListItem, so grepping for that type
// never found this call site. teamLabel prefers the linked institution name and
// falls back to the raw name, which is the same rule the ten fan-facing
// projections use.
//
// WHAT THIS DOES NOT DO, deliberately: it yields "Georgia State University vs
// Albany State University", not "Georgia State vs Albany State".
// `institutions.name` is literally "Georgia State University". Trimming the
// suffix would be a regex over editorial data -- see RESOLVER_TICKETS.md D8 for
// why that is a data decision rather than a string trick.
function matchup(a: MyAssignment): string | null {
  const home = teamLabel(a.event.homeInstitution, a.event.homeTeam);
  const away = teamLabel(a.event.awayInstitution, a.event.awayTeam);
  if (!home || !away) return null;
  return `${home} vs ${away}`;
}

// The shared pulsing LIVE badge (dot + wordmark) — same scoped .live-badge
// treatment used on the feed/search cards and the game page.
function LiveBadge() {
  return (
    <span className="live-badge">
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Small modal to attach one of the rep's own ad orders to a game as its
// presenting sponsor. Dropdown of the rep's orders (advertiser name + amount),
// POSTs the link, and handles a 409 (game already sponsored) inline. On success
// it hands the new Sponsorship back up so the workspace updates without a refetch.
function AttachSponsorForm({
  token,
  eventId,
  orders,
  advertisersById,
  onLinked,
  onClose,
}: {
  token: string;
  eventId: string;
  orders: AdOrder[];
  advertisersById: Record<string, string>;
  onLinked: (sponsorship: Sponsorship) => void;
  onClose: () => void;
}) {
  const [adOrderId, setAdOrderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!adOrderId) {
      setError('Pick one of your sales to link.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sponsorship = await createSponsorship(token, { eventId, adOrderId });
      onLinked(sponsorship);
    } catch (err) {
      // 409 -> "409 This game already has a presenting sponsor"; shown inline so
      // the rep can pick a different sale or back out.
      setError(err instanceof Error ? err.message : 'Failed to attach sponsor');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card card"
        role="dialog"
        aria-modal="true"
        aria-label="Attach sponsor"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">Presenting sponsor</span>
            <h2 style={{ margin: '2px 0 0' }}>Attach sponsor</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="rep-form">
          <div className="field field--wide">
            <label htmlFor="attach-order">Your sale</label>
            <select
              id="attach-order"
              value={adOrderId}
              onChange={(e) => {
                setAdOrderId(e.target.value);
                setError(null);
              }}
            >
              <option value="">Choose one of your sales…</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {(advertisersById[o.advertiserId] ?? 'Advertiser')} — {usd(o.amount)}
                </option>
              ))}
            </select>
            {orders.length === 0 && (
              <span className="muted sponsor-field-hint">
                Log a sale first — you can only sponsor a game with one of your own
                orders.
              </span>
            )}
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting || orders.length === 0}>
              {submitting ? 'Attaching…' : 'Attach sponsor'}
            </button>
          </div>

          {error && <div className="error rep-form-msg">{error}</div>}
        </form>
      </div>
    </div>
  );
}

// Time-of-day only in ET ("7:04 PM"), for the emitted-events feed + sponsor
// "aired at". Unlabelled: past stamps in a column, under a header that already
// names the night.
function formatClock(iso: string): string {
  return etTime(iso) || iso;
}

// Sport-agnostic period chips + the three instant big-play presets.
const PERIOD_LABELS = ['1st', '2nd', '3rd', '4th', 'Half', 'OT'];
const BIG_PLAY_PRESETS = ['Big play!', 'And-one!', 'Clutch shot!'];

// A one-line label for a live event in the compact emitted feed.
function liveEventSummary(ev: LiveEvent): string {
  switch (ev.type) {
    case 'score_update':
      return `Score ${ev.payload.homeScore ?? '?'} – ${ev.payload.awayScore ?? '?'}`;
    case 'period':
      return `Period: ${ev.payload.label ?? ''}`.trim();
    case 'big_play':
      return ev.payload.text ? String(ev.payload.text) : 'Big play';
    case 'timeout':
      return 'Timeout';
    case 'sponsor_spot':
      return 'Sponsor spot';
    case 'status_note':
      return ev.payload.text ? String(ev.payload.text) : 'Status note';
    default:
      return ev.type;
  }
}

// ---- Predictions, courtside. POINTS ONLY — the rep opens a question, fans
// stake points on it, the rep settles it. No money is involved and the copy must
// never imply otherwise ("points"/"picks", never "bet"/"wager"/"odds").
//
// The three kinds and their key sets are fixed server-side (KIND_KEYS in
// predictions.service.ts); this form mirrors them. LABELS are deliberately not
// sent: the backend owns them — team names off the event for `winner` (a client
// label there is ignored outright), "Yes"/"No", "Over <line>"/"Under <line>" —
// so sending keys only keeps one authority.
const PREDICTION_KINDS: Array<{ value: PredictionKind; label: string }> = [
  { value: 'winner', label: 'Winner' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'over_under', label: 'Over / Under' },
];

// Keys per kind, in the canonical order the backend stores them.
const KIND_KEYS: Record<PredictionKind, [string, string]> = {
  winner: ['home', 'away'],
  yes_no: ['yes', 'no'],
  over_under: ['over', 'under'],
};

// What the fan will SEE as the two options, previewed live in the form. This
// mirrors the server's labelling rules rather than driving them — it's a
// preview, not a payload.
function optionPreview(
  kind: PredictionKind,
  line: string,
  homeLabel: string,
  awayLabel: string,
): [string, string] {
  if (kind === 'winner') return [homeLabel, awayLabel];
  if (kind === 'yes_no') return ['Yes', 'No'];
  // Normalize through Number the way the backend does (it labels with
  // String(dto.line), and `line` is sent as a number). Without this a rep who
  // types "7.0" previews "Over 7.0" but fans get "Over 7" — a preview that
  // doesn't match what ships isn't one.
  const raw = line.trim();
  const n = Number(raw);
  const l = raw === '' || !Number.isFinite(n) ? '…' : String(n);
  return [`Over ${l}`, `Under ${l}`];
}

// The console's prediction tool: a compact open-a-question form plus the live
// board with one-tap Lock / Resolve / Void. Sits inside the live console card,
// so it renders body-only (no card chrome of its own).
function ConsolePredictions({
  token,
  eventId,
  homeLabel,
  awayLabel,
  // False when either team FK is unset on the event. A `winner` question then
  // genuinely cannot be built (the backend 409s: it has no team names to
  // resolve against), so the kind is disabled with the reason shown rather than
  // offered and rejected.
  canAskWinner,
}: {
  token: string;
  eventId: string;
  homeLabel: string;
  awayLabel: string;
  canAskWinner: boolean;
}) {
  const [rows, setRows] = useState<Prediction[]>([]);
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<PredictionKind>(
    canAskWinner ? 'winner' : 'yes_no',
  );
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The prediction whose winner the rep is choosing (Resolve expands in place
  // into its own options rather than opening a dialog — one thumb, courtside).
  const [resolving, setResolving] = useState<string | null>(null);

  // Best-effort load; a failed read just leaves an empty board and the rep can
  // still open a question.
  const load = async () => {
    try {
      setRows(await getEventPredictions(token, eventId));
    } catch {
      /* leave the board as-is; opening/settling still works */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getEventPredictions(token, eventId);
        if (!cancelled) setRows(list);
      } catch {
        /* empty board on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  const lineNum = Number(line);
  const lineValid = line.trim() !== '' && Number.isFinite(lineNum);
  const canOpen =
    question.trim().length > 0 &&
    !busy &&
    (kind !== 'over_under' || lineValid) &&
    (kind !== 'winner' || canAskWinner);

  async function open() {
    if (!canOpen) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createPrediction(token, {
        eventId,
        question: question.trim(),
        kind,
        // Keys only — the server labels them (see the header above).
        options: KIND_KEYS[kind].map((key) => ({ key })),
        ...(kind === 'over_under' ? { line: lineNum } : {}),
        // No stake sent: the column default (100) applies. v1 stake is FIXED per
        // question by design — every fan on a question risks the same amount —
        // so there's no field here to get wrong at 9pm in a gym.
      });
      setQuestion('');
      setLine('');
      // create returns the RAW row (no options distribution, no myPick), so the
      // board is re-read rather than spliced.
      await load();
      setNotice('Question is open — fans can pick now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open prediction');
    } finally {
      setBusy(false);
    }
  }

  async function lock(p: Prediction) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await lockPrediction(token, p.id);
      await load();
      setNotice('Picks locked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock');
    } finally {
      setBusy(false);
    }
  }

  // Pays out irreversibly, so this one confirms — naming the winner and the
  // number of picks riding on it, which is the thing a rep would want to catch
  // before it's too late to catch it.
  async function resolve(p: Prediction, winningKey: string) {
    const label = p.options.find((o) => o.key === winningKey)?.label ?? winningKey;
    if (
      !window.confirm(
        `Resolve "${p.question}" with ${label} as the winner? This pays out ${p.totalPicks} pick${
          p.totalPicks === 1 ? '' : 's'
        } immediately and cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await resolvePrediction(token, p.id, winningKey);
      setResolving(null);
      await load();
      setNotice(
        `Resolved — ${res.tally.winners} of ${res.tally.picks} picks won, ${points(
          res.tally.pointsPaid,
        )} points paid out.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setBusy(false);
    }
  }

  // The mercy switch: refunds every stake and settles nothing. Also confirms —
  // it's not destructive to a fan, but it does end the question.
  async function voidIt(p: Prediction) {
    if (
      !window.confirm(
        `Void "${p.question}"? Every stake is refunded and nobody wins or loses.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await voidPrediction(token, p.id);
      await load();
      setNotice(
        `Voided — ${points(res.tally.pointsRefunded)} points refunded to ${
          res.tally.refunded
        } pick${res.tally.refunded === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void');
    } finally {
      setBusy(false);
    }
  }

  // Only questions still in play carry actions. Settled ones drop off the
  // console — the fan page is where a resolved question lives on.
  const liveRows = rows.filter(
    (p) => p.status === 'open' || p.status === 'locked',
  );
  const [optA, optB] = optionPreview(kind, line, homeLabel, awayLabel);

  return (
    <div className="console-group predict-console">
      <span className="console-label">Predictions · points only</span>

      {/* ---- Open a question ---- */}
      <div className="predict-console__form">
        <input
          value={question}
          placeholder="Ask the crowd…"
          disabled={busy}
          maxLength={200}
          aria-label="Prediction question"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canOpen) void open();
          }}
        />
        <div className="predict-console__kinds">
          {PREDICTION_KINDS.map((k) => {
            const blocked = k.value === 'winner' && !canAskWinner;
            return (
              <button
                key={k.value}
                type="button"
                className={`console-chip${
                  kind === k.value ? ' console-chip--on' : ''
                }`}
                disabled={busy || blocked}
                title={
                  blocked
                    ? 'This game does not have both teams set, so a winner question has no team names to resolve.'
                    : undefined
                }
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            );
          })}
          {kind === 'over_under' && (
            <input
              type="number"
              step="any"
              inputMode="decimal"
              className="predict-console__line"
              placeholder="Line"
              aria-label="Over/under line"
              value={line}
              disabled={busy}
              onChange={(e) => setLine(e.target.value)}
            />
          )}
        </div>
        {/* Exactly what the fan will see, before it's live in front of them. */}
        <div className="predict-console__preview">
          <span className="predict-console__preview-label">Fans will pick</span>
          <span className="predict-console__preview-opts">
            {optA} <span className="predict-console__preview-or">or</span> {optB}
          </span>
        </div>
        <button
          type="button"
          className="btn-inline predict-console__open"
          disabled={!canOpen}
          onClick={() => void open()}
        >
          {busy ? 'Working…' : 'Open prediction'}
        </button>
      </div>

      {notice && <div className="success predict-console__notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {/* ---- The live board: one row per question still in play ---- */}
      {liveRows.length === 0 ? (
        <p className="muted console-feed__empty">
          No questions open. Ask the crowd something.
        </p>
      ) : (
        <ul className="predict-console__list">
          {liveRows.map((p) => (
            <li key={p.id} className="predict-console__row">
              <div className="predict-console__row-head">
                <span className="predict-console__q">{p.question}</span>
                <span className={`pill predict-pill predict-pill--${p.status}`}>
                  {p.status === 'open' ? 'Open' : 'Locked'}
                </span>
              </div>
              <span className="predict-console__meta">
                {p.totalPicks === 1 ? '1 pick' : `${points(p.totalPicks)} picks`} ·{' '}
                {points(p.stake)} points each
              </span>

              {resolving === p.id ? (
                // Resolve expanded: name the winner. The options ARE the
                // buttons — no select, no second dialog before the confirm.
                <div className="predict-console__resolve">
                  <span className="predict-console__resolve-label">
                    Who won?
                  </span>
                  {p.options.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className="btn-inline predict-console__winner"
                      disabled={busy}
                      onClick={() => void resolve(p, o.key)}
                    >
                      {o.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => setResolving(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="predict-console__actions">
                  {p.status === 'open' && (
                    <button
                      type="button"
                      className="btn-inline btn-ghost"
                      disabled={busy}
                      onClick={() => void lock(p)}
                    >
                      Lock
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-inline btn-ghost"
                    disabled={busy}
                    onClick={() => setResolving(p.id)}
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    className="btn-inline btn-ghost predict-console__void"
                    disabled={busy}
                    onClick={() => void voidIt(p)}
                  >
                    Void
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A score for an input draft: a real number (including 0) becomes its digits,
// "no score yet" becomes an empty field — which renders as the board's em-dash
// placeholder instead of a 0 nobody entered.
function scoreText(n: number | null): string {
  return n === null ? '' : String(n);
}

// A score_update against a game the API has already settled (final, postponed
// or canceled) comes back 409. The client formats every failure as
// "<status> <message>", so strip the numeric prefix and show the server's
// sentence on its own — it explains a precondition ("its score is settled"),
// and reading as a status dump would make it look like a transient failure the
// rep should retry. Colour events (big_play, period, timeout, status_note,
// sponsor_spot) are still accepted on a terminal game and don't come through here.
function scoreErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to update score';
  const settled = err.message.match(/^409 (.+)$/s);
  return settled ? settled[1] : err.message;
}

// The COURTSIDE console — shown at the top of the workspace only while a game is
// live. Phone-first, big tap targets: a score pad (+1/+2/+3 per team, optimistic
// then reconciled from the emit response), period chips, big-play input + preset
// buttons, a timeout button, the gold sponsor-spot button, and a reverse-chron
// feed of tonight's emitted events with a confirm-first retract. Score updates
// also sync the events scoreboard server-side, so fans see them via the poller.
// The console's own view. First in the bar, selected by default, and the one a
// correspondent returns to -- so it is a value in the same set as the others
// rather than a special case outside them.
const COURTSIDE = 'courtside';

// One view besides the console. `chip: false` keeps the body MOUNTED but offers
// no chip -- the Call uses it, because the tile has to fetch before anyone can
// know whether this game has a card to show.
interface ConsolePanel {
  id: string;
  label: string;
  body: React.ReactNode;
  chip?: boolean;
}

function LiveConsole({
  token,
  eventId,
  sponsorship,
  initialHome,
  initialAway,
  homeLabel,
  awayLabel,
  canAskWinner,
  canEndGame,
  onEndGame,
  label,
  panels,
}: {
  token: string;
  eventId: string;
  sponsorship: Sponsorship | null;
  initialHome: number | null;
  initialAway: number | null;
  homeLabel: string;
  awayLabel: string;
  // Both team FKs are set on the event -> a `winner` question can resolve to a
  // real team name. Passed through to the predictions tool.
  canAskWinner: boolean;
  // Admin or field_rep. End Game writes through PATCH /events/:id/result, which
  // an RM 403s on -- and it is the ONLY control in this console they cannot use.
  // Everything else here posts live events, which accept a regional_manager. So
  // the whole console stays, and one button goes. See RESOLVER_TICKETS.md R1a.
  canEndGame: boolean;
  // End the game from the console (marks it final with the live scores). The
  // standalone Live & Result section doesn't render while live, so End Game
  // lives here — the console is the page courtside. Resolves once the PATCH
  // lands; throws so the console can surface the failure on its own error line.
  onEndGame: (homeScore: number, awayScore: number) => Promise<void>;
  // ---- WHAT THIS COMPONENT PLACES BUT DOES NOT OWN ------------------------
  // While a game is live the console IS the page, so the console owns the page
  // LAYOUT -- and the things that are not console state get passed in rather
  // than lifted out.
  //
  // `label` is the one-line matchup + status. `panels` are the views the bar
  // switches to besides Courtside: stream, predictions, the Call, notes,
  // article, sponsor, photos.
  //
  // The alternative was lifting `feed` to the page so the page could lay the
  // three columns out itself. That would move the emit surface's own state
  // (scoreEntered reads the feed, so does the sponsor-spot counter) away from
  // the controls that write it, to buy a layout the console expresses here.
  label: React.ReactNode;
  panels: ConsolePanel[];
}) {
  // null means NOBODY HAS SCORED THIS GAME YET -- it is not zero. Defaulting it
  // to 0 would render a 0 - 0 board that End Game would then publish as a real
  // final, and reportResult settles pick'em/predictions/Oracle/Trail off that
  // score irreversibly. Keep the null all the way to the End Game gate below.
  const [home, setHome] = useState<number | null>(initialHome);
  const [away, setAway] = useState<number | null>(initialAway);
  // The Sync inputs are the PRIMARY control: editable drafts of each score,
  // kept in step with the reconciled totals (history load, +N bumps, and the
  // post-sync echo all flow through home/away) so the fields always show the
  // live number until the rep types a new one. Empty draft == no score entered.
  const [homeDraft, setHomeDraft] = useState(scoreText(initialHome));
  const [awayDraft, setAwayDraft] = useState(scoreText(initialAway));
  const [feed, setFeed] = useState<LiveEvent[]>([]); // newest-first for display
  const [showAllFeed, setShowAllFeed] = useState(false);
  const [bigPlay, setBigPlay] = useState('');
  const [emitting, setEmitting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHomeDraft(scoreText(home));
    setAwayDraft(scoreText(away));
  }, [home, away]);

  // The rep has typed a score that differs from what's on the board -> Sync is
  // meaningful (and enabled).
  const scoreDirty =
    homeDraft !== scoreText(home) || awayDraft !== scoreText(away);
  // Both fields have to carry a number before Sync can fire: Number('') is 0,
  // so syncing a half-filled board would invent a 0 for the empty side -- the
  // same fabrication as the old `?? 0` default, one field over.
  const scoreDraftsFilled =
    homeDraft.trim() !== '' && awayDraft.trim() !== '';
  // A score EXISTS once both sides are non-null. Deliberately a null test, not
  // a truthiness test: a real, entered 0 - 0 is a publishable final, and
  // `!home` would block it while letting the never-entered case through.
  const scoreEntered = home !== null && away !== null;

  // Seed tonight's emitted events, and derive the running score from the last
  // score_update (if any) so reopening the console mid-game shows the right
  // total and history. Best-effort: a failed load just leaves an empty feed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const history = await getLiveEvents(token, eventId);
        if (cancelled) return;
        const lastScore = [...history]
          .reverse()
          .find((e) => e.type === 'score_update');
        if (lastScore) {
          if (typeof lastScore.payload.homeScore === 'number') {
            setHome(lastScore.payload.homeScore);
          }
          if (typeof lastScore.payload.awayScore === 'number') {
            setAway(lastScore.payload.awayScore);
          }
        }
        setFeed(history.slice().reverse());
      } catch {
        /* history is a convenience — leave the feed empty on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  // Emit a non-score event, prepending the created row to the feed. Score
  // updates use their own optimistic path (bumpScore) below.
  async function emit(type: LiveEventType, payload?: Record<string, unknown>) {
    setEmitting(true);
    setError(null);
    try {
      const created = await createLiveEvent(token, eventId, { type, payload });
      setFeed((f) => [created, ...f]);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to emit event');
      return null;
    } finally {
      setEmitting(false);
    }
  }

  // The one score path shared by Sync (direct entry) and +N (quick add): set the
  // new totals optimistically, POST a single score_update, then reconcile from
  // the echoed payload — reverting to the prior totals on failure. Buttons
  // disable during the flight.
  async function commitScore(nextHome: number, nextAway: number) {
    const prevHome = home;
    const prevAway = away;
    setHome(nextHome);
    setAway(nextAway);
    setEmitting(true);
    setError(null);
    try {
      const created = await createLiveEvent(token, eventId, {
        type: 'score_update',
        payload: { homeScore: nextHome, awayScore: nextAway },
      });
      if (typeof created.payload.homeScore === 'number') {
        setHome(created.payload.homeScore);
      }
      if (typeof created.payload.awayScore === 'number') {
        setAway(created.payload.awayScore);
      }
      setFeed((f) => [created, ...f]);
    } catch (err) {
      // Roll the board back to exactly what it was — including back to null if
      // this was the first score entered, so a rejected update can't leave a
      // number on a board that never had one. Covers the terminal-game 409.
      setHome(prevHome);
      setAway(prevAway);
      setError(scoreErrorMessage(err));
    } finally {
      setEmitting(false);
    }
  }

  // PRIMARY: sync both scores at once from the editable inputs (the "glance at
  // the gym board and match it" flow). Clamp to non-negative integers; bail on
  // a non-numeric draft (type=number makes that unlikely, but be safe).
  function syncScore() {
    // Both fields must carry something — an empty one would read as 0 through
    // Number('') and publish a score the rep never entered.
    if (!scoreDraftsFilled) return;
    const nextHome = Math.max(0, Math.trunc(Number(homeDraft)));
    const nextAway = Math.max(0, Math.trunc(Number(awayDraft)));
    if (!Number.isFinite(nextHome) || !Number.isFinite(nextAway)) return;
    void commitScore(nextHome, nextAway);
  }

  // SECONDARY: tap +1/+2/+3 for one team — a one-tap optimistic bump through the
  // same commit/reconcile path.
  function bumpScore(team: 'home' | 'away', points: number) {
    // A bump off an unscored board materializes BOTH sides: a score_update
    // carries { homeScore, awayScore } together, so there's no wire shape for
    // "home 2, away unknown". Tapping +2 is the rep entering a score, and the
    // other side genuinely standing at 0 is part of what they just said.
    const baseHome = home ?? 0;
    const baseAway = away ?? 0;
    const nextHome = team === 'home' ? baseHome + points : baseHome;
    const nextAway = team === 'away' ? baseAway + points : baseAway;
    void commitScore(nextHome, nextAway);
  }

  async function emitBigPlay(text: string) {
    const t = text.trim();
    if (t.length < 2) return;
    const created = await emit('big_play', { text: t });
    if (created) setBigPlay('');
  }

  async function retract(ev: LiveEvent) {
    if (
      !window.confirm(
        "Retract this live event? Fans already on the game page won't see it removed until they reload.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteLiveEvent(token, eventId, ev.id);
      setFeed((f) => f.filter((x) => x.id !== ev.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retract event');
    }
  }

  // End the game from courtside: confirm, then hand the live scores up to the
  // workspace's PATCH. Owns its own busy/error state so a failure shows on the
  // console's error line (the Live & Result section isn't on screen while live).
  async function handleEndGame() {
    // Precondition, mirrored by the disabled button: never publish a final off
    // a board nobody has scored. Also narrows both to number for onEndGame.
    if (home === null || away === null) return;
    if (
      !window.confirm(
        'End this game and mark it final? The current live score will be published as the final result.',
      )
    ) {
      return;
    }
    setEnding(true);
    setError(null);
    try {
      await onEndGame(home, away);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end game');
    } finally {
      setEnding(false);
    }
  }

  // Tonight's sponsor spots (newest-first), for the "aired at … · run N tonight".
  const sponsorSpots = feed.filter((e) => e.type === 'sponsor_spot');
  const lastSpot = sponsorSpots[0];

  // ---- WHICH VIEW IS ON THE STAGE -----------------------------------------
  // A STRING, NEVER NULL, and that is the whole change from the drawer this
  // replaced. The console is not the thing an overlay covers -- it is
  // 'courtside', the first view and the default one. Every chip swaps the
  // working area for another view of the same screen.
  //
  // THERE IS NO STATE YOU CAN BE STUCK IN. The drawer had an open state and a
  // shut state and needed an exit from one to the other; a correspondent who
  // could not find the exit was locked out of the scoreboard mid-game. A view
  // switcher has no exit because it has no modality: you are always in a view,
  // and one tap is always a move to another. Nothing to dismiss, so nothing to
  // fail to dismiss.
  const [view, setView] = useState<string>(COURTSIDE);

  // Keep the feed calm courtside: show only the latest 8 until the rep expands
  // it. Retract still works on every shown row.
  const FEED_CAP = 8;
  const shownFeed = showAllFeed ? feed : feed.slice(0, FEED_CAP);

  return (
    // ========================================================================
    // THE COURTSIDE DASHBOARD. A correspondent running a live game does not
    // scroll: everything they act on is on one screen at once and stays there.
    //
    // THREE ROWS -- label / working area / bar -- and the middle one is the
    // only elastic thing on the page. See .cdash in globals.css for the height
    // arithmetic and for the 813-in-495 measurement that rules out the old
    // stacked shape.
    // ========================================================================
    <div className="cdash">
      {/* ---- ROW 1: WHICH GAME. A LABEL, NOT A MASTHEAD. -------------------
          One line at body scale. A correspondent knows which game they are at;
          this is here so the screen can be identified at a glance, not so the
          matchup can be announced. It replaced a 2.4rem display headline that
          ran nine lines down a 261px column. ---- */}
      <div className="cdash__label">
        <LiveBadge />
        {/* ---- THE SCORE, IN EVERY VIEW -------------------------------------
            Someone writing notes still needs to know the score without
            switching back. It lives in the label row rather than the working
            area precisely so it survives a view change -- the label row is the
            one band that never swaps.
            It is a READOUT, not a control: the editable board is in Courtside,
            and there is exactly one place to change a score. An em dash rather
            than a hyphen, and tabular figures, so the pair does not jitter as
            the numbers change. ---- */}
        <span
          className="cdash__score"
          aria-label={`Score: ${homeLabel} ${home ?? 0}, ${awayLabel} ${away ?? 0}`}
        >
          <span className="cdash__score-n">{home ?? '–'}</span>
          <span className="cdash__score-sep" aria-hidden="true">
            —
          </span>
          <span className="cdash__score-n">{away ?? '–'}</span>
        </span>
        {label}
      </div>

      {/* ---- ROW 2: THE WORKING AREA ---------------------------------------
          A -- SCORE & SCORING: the board and the two ways to move it.
          B -- CALLS:           period, big play, timeout, sponsor spot.
          C -- FEED:            what you have put on the air tonight.

          A and B are sized to their contents and carry real slack (~109px and
          ~169px at a 700px viewport). C takes the remainder and scrolls
          INTERNALLY, so it is the only thing that shortens as the window does.
          That is deliberate: the feed is the one block whose value degrades
          gracefully with fewer rows, and every control keeps its full size at
          every height the dashboard is switched on for. ---- */}
      <div className="cdash__stage">
        <div className="cdash__grid" hidden={view !== COURTSIDE}>
          <section className="card game cdash__col cdash-score">
            {/* (a) PRIMARY — two-team scoreboard with editable scores + one Sync */}
            <div className="console-board">
              <div className="console-board__label console-board__label--home">
                <span className="console-board__tag">Home</span>
                <span className="console-board__name">{homeLabel}</span>
              </div>
              <div className="console-board__label console-board__label--away">
                <span className="console-board__tag">Away</span>
                <span className="console-board__name">{awayLabel}</span>
              </div>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                className="console-board__score console-board__score--home"
                aria-label={`${homeLabel} score`}
                placeholder="—"
                value={homeDraft}
                disabled={emitting}
                onChange={(e) => setHomeDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              <span className="console-board__dash" aria-hidden="true">
                –
              </span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                className="console-board__score console-board__score--away"
                aria-label={`${awayLabel} score`}
                placeholder="—"
                value={awayDraft}
                disabled={emitting}
                onChange={(e) => setAwayDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </div>
            <button
              type="button"
              className="console-sync"
              disabled={emitting || !scoreDirty || !scoreDraftsFilled}
              onClick={syncScore}
            >
              {emitting ? 'Syncing…' : 'Sync score'}
            </button>

            {/* (a2) SECONDARY — quick add (+1/+2/+3 per team), quieter than Sync */}
            <div className="console-group">
              <span className="console-label">Quick add</span>
              <div className="console-quickadd">
                {(['home', 'away'] as const).map((side) => (
                  <div key={side} className="console-quickadd__row">
                    <span className="console-quickadd__team">
                      {side === 'home' ? homeLabel : awayLabel}
                    </span>
                    <div className="console-bumps">
                      {[1, 2, 3].map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="console-bump"
                          disabled={emitting}
                          onClick={() => bumpScore(side, p)}
                        >
                          +{p}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="card game cdash__col cdash-calls">
            {/* (b) Period chips */}
            <div className="console-group">
              <span className="console-label">Period</span>
              <div className="console-chips">
                {PERIOD_LABELS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="console-chip"
                    disabled={emitting}
                    onClick={() => emit('period', { label })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* (c) Big play */}
            <div className="console-group">
              <span className="console-label">Big play</span>
              <div className="console-bigplay">
                <input
                  value={bigPlay}
                  placeholder="Describe the moment…"
                  disabled={emitting}
                  onChange={(e) => setBigPlay(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') emitBigPlay(bigPlay);
                  }}
                />
                <button
                  type="button"
                  className="btn-inline"
                  disabled={emitting || bigPlay.trim().length < 2}
                  onClick={() => emitBigPlay(bigPlay)}
                >
                  Emit
                </button>
              </div>
              <div className="console-chips">
                {BIG_PLAY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="console-chip"
                    disabled={emitting}
                    onClick={() => emitBigPlay(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* (d) Timeout + (e) Sponsor spot */}
            <div className="console-group console-actions">
              <button
                type="button"
                className="btn-inline btn-ghost"
                disabled={emitting}
                onClick={() => emit('timeout', {})}
              >
                Timeout
              </button>
              {sponsorship && (
                <div className="console-sponsor">
                  <button
                    type="button"
                    className="console-sponsor-btn"
                    disabled={emitting}
                    onClick={() => emit('sponsor_spot', { sponsorshipId: sponsorship.id })}
                  >
                    Run {sponsorship.businessName} spot
                  </button>
                  {lastSpot && (
                    <span className="console-sponsor-meta">
                      Aired at {formatClock(lastSpot.createdAt)} · run {sponsorSpots.length}{' '}
                      tonight
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="card game cdash__col cdash-feed">
            <div className="console-feed">
              <span className="console-label">Tonight&apos;s feed</span>
              {feed.length === 0 ? (
                <p className="muted console-feed__empty">
                  No events yet — tap a control above to go on the air.
                </p>
              ) : (
                <>
                  <ul className="console-feed__list">
                    {shownFeed.map((ev) => (
                      <li key={ev.id} className="console-feed__item">
                        <span className="console-feed__time">{formatClock(ev.createdAt)}</span>
                        <span className="console-feed__text">{liveEventSummary(ev)}</span>
                        <button
                          type="button"
                          className="console-retract"
                          aria-label="Retract event"
                          onClick={() => retract(ev)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  {feed.length > FEED_CAP && (
                    <button
                      type="button"
                      className="link-btn console-feed__more"
                      onClick={() => setShowAllFeed((v) => !v)}
                    >
                      {showAllFeed ? 'Show less' : `Show all (${feed.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {/* ---- THE OTHER VIEWS -----------------------------------------------
            One card each, filling the same stage the three columns fill, so a
            view change swaps CONTENT and never moves the label row or the bar.

            EVERY VIEW STAYS MOUNTED, hidden rather than unmounted, for the two
            reasons the drawer had and one it did not:
              * an in-flight PHOTO UPLOAD survives switching views;
              * the CALL TILE fetches on mount and reports whether this game has
                a card, which is what lets its chip be conditional;
              * and now the working state of every view -- a half-typed note, a
                prediction being drafted -- survives a glance at the score and a
                tap back. Switching views courtside must cost nothing. ---- */}
        {panels.map((pnl) => (
          <div key={pnl.id} className="cdash__view" hidden={view !== pnl.id}>
            <section className="card game cdash__viewcard">{pnl.body}</section>
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      {/* ---- ROW 3: THE BAR. The view switcher, and End Game. --------------
          Left: one chip per view, Courtside first and selected by default.
          Right: End Game, in every view without exception -- a correspondent
          must be able to end the game from wherever they are, and the bar is
          the band that never swaps.

          The bar costs the 44px End Game was already spending, which is how six
          other surfaces reach the screen without taking a pixel from the
          controls.

          role="tablist" and aria-selected rather than aria-expanded: these are
          peer views now, not a thing that opens. The markup says so for the
          same reason the model changed. ---- */}
      <div className="cdash__bar">
        <div className="cdash__chips" role="tablist" aria-label="Console views">
          {[{ id: COURTSIDE, label: 'Courtside', chip: true }, ...panels]
            .filter((pnl) => pnl.chip !== false)
            .map((pnl) => (
              <button
                key={pnl.id}
                type="button"
                role="tab"
                className={`cdash__chip${view === pnl.id ? ' cdash__chip--on' : ''}`}
                aria-selected={view === pnl.id}
                onClick={() => setView(pnl.id)}
              >
                {pnl.label}
              </button>
            ))}
        </div>
          {/* ---- (g) END GAME, ON ITS OWN DOCKED ROW ---------------------------
               It used to sit inside the row above, one flex item along from
               Timeout. Two reasons it moved, and only one of them is the phone:

               * COURTSIDE. Below the console lies the predictions tool and the
                 night's feed, so on a phone this button is a long way down a very
                 tall card and it scrolls away exactly when the game ends. The dock
                 is sticky at <=767px, and sticky is bounded by the containing
                 block -- which is why the row had to become a direct child of the
                 console section rather than stay inside .console-actions. Stuck to
                 a two-line flex row it would have had almost no scroll run to
                 travel over, which is the trap this shape avoids.
               * It was never meant to read as Timeout's neighbour anyway (see the
                 note on .console-endgame). Its own row says that louder than a
                 tint does, at every width.

               The --idle class un-sticks it on a board nobody has scored: the
               button is disabled in that state, so docking it would nail a
               permanently disabled button and its hint across the bottom of a
               390px screen. Same argument, same shape, as .call-slip--empty and
               .parlay-stub--empty. ------------------------------------------- */}
          {/* A manager gets the sentence, not the button. The dock keeps its
              --idle shape so nothing is nailed across the bottom of a phone. */}
          {!canEndGame ? (
            <div className="console-endgame-dock console-endgame-dock--idle">
              <span className="console-endgame-hint">
                Ending the game is the assigned correspondent&apos;s to do, or an
                admin&apos;s.
              </span>
            </div>
          ) : (
          <div
            className={`console-endgame-dock${
              scoreEntered ? '' : ' console-endgame-dock--idle'
            }`}
          >
            <button
              type="button"
              className="btn-inline btn-ghost console-endgame"
              disabled={emitting || ending || !scoreEntered}
              title={
                scoreEntered ? undefined : 'Enter a score before ending the game'
              }
              onClick={handleEndGame}
            >
              {ending ? 'Ending…' : 'End Game (Final)'}
            </button>
            {/* Reads as a precondition rather than a broken button. An entered
                0 - 0 clears this; a never-entered board does not. */}
            {!scoreEntered && (
              <span className="console-endgame-hint">
                Enter a score before ending the game
              </span>
            )}
          </div>
          )}
      </div>

    </div>
  );
}

// Client-side upload guards, mirrored on the backend: only these image types,
// and 10MB max. We reject a bad file BEFORE presigning so the rep gets an
// instant, clear message instead of a round-trip 400.
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// A file mid-flight through presign -> PUT -> confirm. `file` is kept so a failed
// upload can be retried in place; on success it's dropped from the pending list
// and its confirmed GamePhoto joins the grid. `key` is a stable per-attempt id.
type PhotoUpload = {
  key: string;
  file: File;
  status: 'uploading' | 'failed';
  error?: string;
};

// The workspace Photos body: a multi-file picker that runs each file through
// the presign -> PUT -> confirm chain with per-file state, plus a grid of the
// game's confirmed photos with an owner-only delete (×). Best-effort load; a
// failed initial fetch just leaves an empty grid and never breaks the page.
// Renders body-only — the surrounding collapsible Section owns the card chrome,
// and stays mounted (hidden, not unmounted) while collapsed so an in-flight
// upload survives a collapse/expand.
function PhotosSection({
  token,
  eventId,
  myUserId,
}: {
  token: string;
  eventId: string;
  myUserId: string;
}) {
  const [photos, setPhotos] = useState<GamePhoto[]>([]);
  const [uploads, setUploads] = useState<PhotoUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The camera input is a SECOND control with its own ref, never `capture` bolted
  // onto the gallery one -- see the comment on the pick row below.
  const captureInputRef = useRef<HTMLInputElement>(null);
  // A monotonic counter for unique upload keys (Date.now/random are fine in the
  // browser, but a counter keeps keys stable and collision-free across a batch).
  const keySeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await getGamePhotos(token, eventId);
        if (!cancelled) setPhotos(list);
      } catch {
        /* a failed photo load shouldn't break the workspace -- leave it empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  // Run one file through the full chain, driving its tile's state. On success the
  // tile is removed and the confirmed photo is prepended to the grid; on failure
  // the tile flips to `failed` (with a Retry that calls back in).
  async function runUpload(key: string, file: File) {
    setUploads((u) =>
      u.map((x) => (x.key === key ? { ...x, status: 'uploading', error: undefined } : x)),
    );
    try {
      const { uploadUrl, publicUrl, mediaId } = await presignGamePhoto(token, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        eventId,
      });
      await uploadToPresignedUrl(uploadUrl, file, file.type);
      await confirmMedia(token, mediaId);
      const photo: GamePhoto = {
        id: mediaId,
        publicUrl,
        createdAt: new Date().toISOString(),
        uploaderUserId: myUserId,
      };
      setPhotos((p) => [photo, ...p]);
      setUploads((u) => u.filter((x) => x.key !== key));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploads((u) =>
        u.map((x) => (x.key === key ? { ...x, status: 'failed', error: msg } : x)),
      );
    }
  }

  // Validate + enqueue each picked file. Oversize/wrong-type files become an
  // immediate `failed` tile (no presign attempt) with a clear reason.
  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const key = `up-${keySeq.current++}`;
      if (!PHOTO_TYPES.includes(file.type)) {
        setUploads((u) => [
          ...u,
          { key, file, status: 'failed', error: 'Use a JPEG, PNG, or WebP image.' },
        ]);
        continue;
      }
      if (file.size > PHOTO_MAX_BYTES) {
        setUploads((u) => [
          ...u,
          { key, file, status: 'failed', error: 'Too large — max 10MB.' },
        ]);
        continue;
      }
      setUploads((u) => [...u, { key, file, status: 'uploading' }]);
      void runUpload(key, file);
    }
    // Reset BOTH inputs so re-picking the same file fires onChange again. The
    // camera one matters most: two shots of the same play come back with the
    // same generated name, and a stale value would swallow the second.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (captureInputRef.current) captureInputRef.current.value = '';
  }

  async function removePhoto(photo: GamePhoto) {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;
    try {
      await deleteMedia(token, photo.id);
      setPhotos((p) => p.filter((x) => x.id !== photo.id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete photo');
    }
  }

  function dismissUpload(key: string) {
    setUploads((u) => u.filter((x) => x.key !== key));
  }

  const isEmpty = !loading && photos.length === 0 && uploads.length === 0;

  return (
    <>
      {/* ---- TWO CONTROLS, NOT ONE INPUT WITH A CAPTURE HINT. ---------------
           The common case courtside is a photo taken thirty seconds ago, and
           the gallery-only picker charges it two extra taps. The fix is NOT to
           add `capture` to the input below: `capture` and `multiple` are
           mutually exclusive in practice, so that one attribute would silently
           kill the bulk upload -- the post-game flow where a correspondent
           sends thirty frames at once. It would have shipped looking done.

           So: a camera door and a gallery door, each with its own input and its
           own ref. Both run the same onPick, so the type/size guards, the
           per-file tiles and the retry path are shared.

           The camera control is hidden unless the pointer is coarse. `capture`
           is a no-op on a desktop browser -- it opens the same file dialog --
           so "Take a photo" on a laptop would be a button that lies.

           UNVERIFIED WITHOUT A PHYSICAL DEVICE: that iOS honours the `accept`
           list on a camera capture. It normally hands back JPEG, but HEIC has
           been reported leaking through on some iOS/Safari combinations. The
           failure is graceful either way -- onPick rejects an unknown type
           before presigning and shows "Use a JPEG, PNG, or WebP image." on the
           tile rather than burning a round trip -- but nobody has held a phone
           and watched it, and this comment is here so that isn't assumed.
           ------------------------------------------------------------------ */}
      <div className="photos-upload">
        <label className="photos-pick photos-capture">
          Take a photo
          <input
            ref={captureInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="photos-file-input"
            onChange={(e) => onPick(e.target.files)}
          />
        </label>
        <label className="photos-pick photos-pick--gallery">
          Add photos
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="photos-file-input"
            onChange={(e) => onPick(e.target.files)}
          />
        </label>
        <span className="game-hint photos-hint">
          JPEG, PNG, or WebP · up to 10MB each
        </span>
      </div>

      {loadError && <div className="error">{loadError}</div>}

      {loading ? (
        <p className="muted">Loading photos…</p>
      ) : isEmpty ? (
        <p className="game-hint" style={{ marginTop: 0 }}>
          No photos yet — add some from courtside.
        </p>
      ) : (
        <div className="photos-grid">
          {uploads.map((up) => (
            <div key={up.key} className="photos-tile photos-tile--pending">
              {up.status === 'uploading' ? (
                <span className="photos-tile__state">Uploading…</span>
              ) : (
                <div className="photos-tile__failed">
                  <span className="photos-tile__err">{up.error ?? 'Failed'}</span>
                  <div className="photos-tile__failed-actions">
                    {PHOTO_TYPES.includes(up.file.type) &&
                      up.file.size <= PHOTO_MAX_BYTES && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => runUpload(up.key, up.file)}
                        >
                          Retry
                        </button>
                      )}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => dismissUpload(up.key)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {photos.map((photo) => (
            <div key={photo.id} className="photos-tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.publicUrl}
                alt="Game photo"
                loading="lazy"
                className="photos-tile__img"
              />
              {photo.uploaderUserId === myUserId && (
                <button
                  type="button"
                  className="photos-tile__delete"
                  aria-label="Delete photo"
                  onClick={() => removePhoto(photo)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// The collapsible section primitive for the game workspace. Header row is a
// button (kicker + title + chevron); the body mounts on open and unmounts on
// close — EXCEPT when `keepMounted` is set, where the body stays mounted and is
// hidden via [hidden], so a section whose form must survive a collapse (Photos,
// mid-upload) keeps its state. Persists nothing: `defaultOpen` re-derives from
// the game's status on each load (each shape keys its sections by status, so a
// go-live / end-game transition remounts them with fresh defaults).
// ---------------------------------------------------------------------------
// THE CORRESPONDENT'S DOOR INTO THE CALL.
//
// A correspondent grades from a parking lot, and the way in has to be somewhere
// they already are — which is this page, on the game they just covered. So the
// workspace carries a TILE and the tool itself lives at /arena/call/grade/:callId.
// Not a section on this page: grading is five taps and a payment, and it should
// not share a scroll with an article draft and a photo uploader.
//
// ----------------------------------------------------------------------------
// HOW THIS FINDS THE CALL ID.
//
// The compose and grade routes are keyed by CALL id; this page holds an EVENT
// id, and there is no event->call lookup. So the derivation is: ask for the
// caller's cards and match `event.id` against this page's eventId.
//
// IT READS THE STAFF LIST, NOT THE FAN CARD, and that is the whole point of this
// component. GET /arena/call/events narrows a field_rep to their OWN cards —
// DRAFTS INCLUDED — and says so on the wire with `mine: true`. The service
// comment states why it exists: "a correspondent has no other way to learn the
// id of their own DRAFT Call."
//
// This used to read GET /arena/call/current, the FAN card, which excludes drafts
// by design (a fan must not see next week's half-written card). The comment here
// said that gap "closes the moment GET /arena/call/events grows a `mine` scope"
// — it had already grown one. The capability shipped, this comment went on
// saying it hadn't, and a correspondent's only route to their own draft stayed a
// link handed to them out of band. See RESOLVER_TICKETS.md R2.
//
// WHAT THE SWITCH ALSO CHANGES, stated because it is a real behaviour change and
// not a side effect worth discovering later: the fan card is the WEEK'S card
// whoever owns it, so any staff user on this game used to see this tile once it
// published. The staff list is scoped — a rep sees their own, an RM their
// roster's, an admin everything. So a rep who is NOT the correspondent no longer
// sees a tile here. That is correct: its CTA opens a tool that would 403 for
// them (CallService.assertCanCompose), and a door that cannot open is worse than
// no door.
//
// TWO SCOPES, AND THE SECOND ONE IS NOT OPTIONAL. 'upcoming' is this ET week and
// later; 'past' is everything before. A Sunday-night game whose card is still
// ungraded on Monday morning has ALREADY MOVED to 'past' — while the
// correspondent still has until Monday evening before the 24-hour sweep washes
// it. Reading only 'upcoming' would take the tile away at the exact moment the
// deadline is closest. The second read is conditional on the kickoff actually
// being before this week, so the common case stays one request.
//
// BEST-EFFORT, SELF-HIDING. Most games are not the week's Call, so the common
// outcome is "no tile" and a failure must look exactly like it: nothing on
// screen and nothing in the error box. The workspace has a dozen other jobs and
// none of them should break because the Arena is down.
// ----------------------------------------------------------------------------
function CallTile({
  token,
  eventId,
  kickoff,
  onAvailable,
}: {
  token: string;
  eventId: string;
  // Told whether this game HAS a Call, so the console can decide whether to
  // offer its chip. The tile has always self-hidden by returning null, which is
  // right when it sits in a stack -- but a chip that switches to an empty view
  // is not the same thing as a section that isn't there, so the console has to
  // know. Views stay mounted, so this fires whether or not the view has ever
  // been opened.
  onAvailable?: (has: boolean) => void;
  // The game's scheduledAt, used ONLY to decide whether the 'past' scope is
  // worth a second request. Not for display and not for phase — the card's own
  // locksAt owns that.
  kickoff: string | null;
}) {
  const [call, setCall] = useState<CallListItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 'upcoming' first — this week and later, which is where a live card
        // almost always is.
        const upcoming = await getCallEvents(token, 'upcoming');
        if (cancelled) return;
        const hit = upcoming.items.find((i) => i.event.id === eventId);
        if (hit) {
          setCall(hit);
          return;
        }
        // The Monday-morning case. `thisWeek` comes from the RESPONSE, not from
        // a Date() here: the backend computes the ET week and a browser in
        // another timezone would disagree about which Monday it is — the same
        // refusal CallList's own comment makes.
        //
        // AND THE KICKOFF IS COMPARED AS AN ET DAY, not by slicing the ISO
        // string. A Sunday-night ET game is already MONDAY in UTC, so a raw
        // comparison would read the exact card this branch exists for as
        // "this week", skip the second request, and drop the tile — the failure
        // it was written to prevent, reintroduced by the comparison itself.
        if (!kickoff || etDateKey(kickoff) >= upcoming.thisWeek) return;
        const past = await getCallEvents(token, 'past');
        if (cancelled) return;
        const older = past.items.find((i) => i.event.id === eventId);
        if (older) setCall(older);
      } catch {
        /* no tile — this game almost certainly isn't one of the caller's Calls */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId, kickoff]);

  useEffect(() => {
    onAvailable?.(call !== null);
  }, [call, onAvailable]);

  if (!call) return null;

  const phase = callListPhase(call);
  const entrants = call.entryCount;
  const filed = `${entrants} card${entrants === 1 ? '' : 's'} filed`;

  // What the correspondent is being asked for, per phase. Only the locked one is
  // urgent — that is the parking lot, and it is the only tile that leads.
  const copy: Record<typeof phase, { note: string; cta: string }> = {
    // THE STATE THIS TILE COULD NOT SEE UNTIL NOW. A draft is the only phase
    // where the card is not yet anybody's but the correspondent's, so it names
    // the work rather than the deadline — and it counts questions, because
    // 0-of-5 versus 4-of-5 is the whole difference between "not started" and
    // "nearly there". No entrant count: nobody can have entered a draft.
    draft: {
      note:
        call.questionCount === 0
          ? 'Yours to write. Five questions, then it goes to the fans.'
          : `Draft — ${call.questionCount} of 5 questions written. It publishes when you say so.`,
      cta: call.questionCount === 0 ? 'Write the card' : 'Finish the card',
    },
    open: {
      note: `Published — fans can still answer until kickoff. ${filed} so far.`,
      cta: 'Open the card',
    },
    locked: {
      note: `Answers are locked and ${filed}. Grade it tonight — an ungraded card is washed 24 hours after kickoff and the pot pays nobody.`,
      cta: 'Grade the card',
    },
    graded: {
      note: `Graded. ${filed}. If a question was called wrong, regrading pays the difference — nothing is ever taken back.`,
      cta: 'Review the grade',
    },
    voided: {
      note: `Voided — nothing was scored, and every one of the ${entrants} entrant${
        entrants === 1 ? '' : 's'
      } kept their participation points.`,
      cta: 'View the card',
    },
  };

  return (
    <section
      className={`card game ws-section calltile${
        phase === 'locked' ? ' calltile--due' : ''
      }`}
    >
      <div className="calltile__head">
        <span className="game-kicker">
          The Correspondent&apos;s Call · {callWeekLabel(call.weekStart)}
        </span>
        {phase === 'locked' && <span className="pill pill--review">Needs grading</span>}
        {phase === 'draft' && <span className="pill">Draft</span>}
      </div>
      <p className="calltile__note">{copy[phase].note}</p>
      {/* callStaffRoute owns the compose-vs-grade split — a draft opens the
          compose tool, everything else the grade sheet. The desk already uses
          it; the route must not be spelled out twice. */}
      <Link href={callStaffRoute(call)} className="calltile__cta">
        {copy[phase].cta} →
      </Link>
    </section>
  );
}

function Section({
  kicker,
  title,
  defaultOpen = true,
  keepMounted = false,
  children,
}: {
  kicker: string;
  title: string;
  defaultOpen?: boolean;
  keepMounted?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={`card game ws-section wsx-section${open ? ' wsx-section--open' : ''}`}
    >
      <button
        type="button"
        className="wsx-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="wsx-head__text">
          <span className="wsx-kicker">{kicker}</span>
          <span className="wsx-title">{title}</span>
        </span>
        <span className="wsx-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {keepMounted ? (
        <div className="wsx-body" hidden={!open}>
          {children}
        </div>
      ) : (
        open && <div className="wsx-body">{children}</div>
      )}
    </section>
  );
}

// One collapsible entry in the live strip. Shape mirrors a Section body.
// One "everything else" surface: notes, article, sponsor, photos. Built once
// and used twice -- as a console VIEW while the game is live, and as an
// expandable Section in the pre-game and final stacks.
//
// `kicker` has no reader while live (the bar labels the view from `title`) and
// is kept because the stacked phases still render it. The LiveStrip component
// that used to consume these below the console is gone: the dashboard's view
// switcher replaced it, and a tab strip below a no-scroll screen is a row of
// height for something nobody can see.
type StripSection = {
  id: string;
  kicker: string;
  title: string;
  body: React.ReactNode;
};

// The courtside workspace for a single assigned game: live controls + result
// reporting, the assignment status/notes, the AI article editor, and the
// presenting-sponsor attach/remove flow. All the interaction that used to live
// inline on each My Games card now lives here, one game per page. Seeds its
// editable state from the loaded assignment + event result; owns all the
// per-action saving/error state so no action blocks another.
function GameWorkspace({
  assignment,
  resultSeed,
  token,
  authorId,
  canSponsor,
  canPublishDirectly,
  canFileResult,
  myOrders,
  advertisersById,
  onLiveChange,
}: {
  assignment: MyAssignment;
  resultSeed?: ResultSeed;
  token: string;
  authorId: string;
  canSponsor: boolean;
  // Admin/regional_manager viewing a game they claimed: they publish/unpublish
  // directly. A field_rep author instead submits for review (and never sees
  // Unpublish -- that's staff-only now on the backend).
  canPublishDirectly: boolean;
  // Admin or field_rep. Gates every control that writes through
  // PATCH /events/:id/result -- the score form, Go Live and End Game -- because
  // an RM 403s on all three. See the derivation in the page component.
  canFileResult: boolean;
  myOrders: AdOrder[];
  advertisersById: Record<string, string>;
  // ---- WHY THE PHASE IS REPORTED UPWARD ---------------------------------
  // The page measure lives on <main>, and only the LIVE phase has a rail to
  // make room for -- so the width is conditional and the condition is computed
  // HERE, from `result` (which this component owns, because the rep changes it
  // by filing a score or ending the game).
  //
  // The parent seeds the same value from `resultSeed`, so the first paint is
  // already the right width and this callback only carries TRANSITIONS: the
  // moment Go Live lands, and the moment End Game does. No flash, and no
  // duplicated source of truth -- the parent never derives the phase itself.
  onLiveChange: (live: boolean) => void;
}) {
  const eventId = assignment.event.id;

  // ---- Assignment status + notes. Held locally so the header pill and the
  // Generate source stay in sync after a save (the PATCH response has no event
  // join, so we only ever read back status/notes). ----
  const [assignmentStatus, setAssignmentStatus] = useState(assignment.status);
  const [savedNotes, setSavedNotes] = useState(assignment.notes ?? '');
  const [notesDraft, setNotesDraft] = useState(assignment.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notesDirty = notesDraft !== savedNotes;
  // sourceText is required (min 1) by the API -- nothing to generate from an
  // empty notes field, so gate the button on it.
  const canGenerate = notesDraft.trim().length > 0;

  // ---- Presenting sponsor for this game (or null). Loaded once on mount; a
  // failed lookup is swallowed so it never breaks the page. ----
  const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);
  const [loadingSponsor, setLoadingSponsor] = useState(true);
  const [showAttach, setShowAttach] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sponsorError, setSponsorError] = useState<string | null>(null);

  // A sponsorship whose ad order is one of the rep's own was attached by them,
  // so we offer Remove (the backend enforces the same ownership on DELETE).
  const attachedByMe =
    sponsorship != null && myOrders.some((o) => o.id === sponsorship.adOrderId);

  useEffect(() => {
    let cancelled = false;
    setLoadingSponsor(true);
    (async () => {
      try {
        const s = await getEventSponsorship(token, eventId);
        if (!cancelled) setSponsorship(s);
      } catch {
        /* a failed sponsor lookup shouldn't break the page -- leave it null */
      } finally {
        if (!cancelled) setLoadingSponsor(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  async function removeSponsor() {
    if (!sponsorship) return;
    if (
      !window.confirm(
        `Remove ${sponsorship.businessName} as this game's presenting sponsor?`,
      )
    ) {
      return;
    }
    setRemoving(true);
    setSponsorError(null);
    try {
      await deleteSponsorship(token, sponsorship.id);
      setSponsorship(null);
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'Failed to remove sponsor');
    } finally {
      setRemoving(false);
    }
  }

  // ---- Report Result: home/away scores + a video URL, PATCHed to the event.
  // Seeded from whatever is already on the event (resultSeed); `result` is the
  // last-known-good values we echo back, updated from the PATCH response so the
  // page reflects the save without a refetch. ----
  const [homeScoreDraft, setHomeScoreDraft] = useState(
    resultSeed?.homeScore != null ? String(resultSeed.homeScore) : '',
  );
  const [awayScoreDraft, setAwayScoreDraft] = useState(
    resultSeed?.awayScore != null ? String(resultSeed.awayScore) : '',
  );
  const [videoUrlDraft, setVideoUrlDraft] = useState(resultSeed?.videoUrl ?? '');
  const [result, setResult] = useState<ResultSeed | null>(resultSeed ?? null);
  const [resultSaving, setResultSaving] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  // Success line under the result form; its text varies by action (saved score,
  // went live, ended game), so it's a message rather than a bare flag.
  const [resultNotice, setResultNotice] = useState<string | null>(null);

  // Live-state transitions are their own PATCHes to the event (they change
  // status), independent of the score save. Go Live and End Game each own their
  // loading/error state so neither blocks the plain score save.
  const [liveSaving, setLiveSaving] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  // Set when Go Live is pressed with an empty video field: the stream URL must
  // be pasted BEFORE going live, so we prompt for it inline instead of PATCHing.
  const [needsUrl, setNeedsUrl] = useState(false);

  // The event's live status is tracked in `result` (seeded from the event and
  // refreshed from each PATCH response), so the page reflects go-live / end-game
  // in place; fall back to the status carried on the assignment.
  const currentStatus = result?.status ?? assignment.event.status;
  const isScheduled = currentStatus === 'scheduled';
  const isLive = currentStatus === 'live';
  const isFinal = currentStatus === 'final';
  const isPostponed = currentStatus === 'postponed';
  const isCanceled = currentStatus === 'canceled';
  // EVERY not-live, not-final shape renders the pre-game section set. The page
  // used to branch on isScheduled/isLive/isFinal only, so a postponed or
  // canceled game (both real event statuses -- see EventListItem) rendered the
  // header and NOTHING else: no result form, no notes, no article, no photos.
  // My Games happily linked to it, so a row led straight into a dead page.
  const isPreGame = !isLive && !isFinal;
  // Whether this game is the week's Correspondent's Call. Reported by the tile
  // itself once it has looked, so its chip can be conditional without the page
  // duplicating that fetch.
  const [hasCall, setHasCall] = useState(false);

  // Tell the page which measure to use. Effect rather than render-time so the
  // parent's setState never runs during this component's render.
  useEffect(() => {
    onLiveChange(isLive);
  }, [isLive, onLiveChange]);
  const resultBusy = resultSaving || liveSaving;

  // At least one field must be sent (empty body -> 400), so gate Save on that.
  const resultHasInput =
    homeScoreDraft.trim() !== '' ||
    awayScoreDraft.trim() !== '' ||
    videoUrlDraft.trim() !== '';

  // ---- AI article. Loaded once on mount so a rep can edit/publish an existing
  // draft without regenerating; a failed lookup is swallowed and the Generate
  // button stays hidden until we know whether an article exists. ----
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableArticle | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(true);

  // Once a draft exists it becomes editable: titleDraft/bodyDraft hold the
  // in-progress edits while `draft` stays the source of truth for id/status
  // (and the last-saved title/body we diff against). Saving and publishing are
  // independent actions, so each owns its own loading/error state.
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const draftDirty =
    draft !== null &&
    (titleDraft !== draft.title || bodyDraft !== (draft.body ?? ''));

  // A field_rep's submitted article is locked while it sits in the editors'
  // queue: no editing, no actions -- just a read-only render and a note that
  // it's in review. Staff (who publish directly) never hit this.
  const repReadOnly = !canPublishDirectly && draft?.status === 'submitted';

  // On mount, pull any content already attached to this game and adopt the first
  // (the backend lists this non-published view newest-created first) as the
  // editable draft, seeding the edit fields from it.
  useEffect(() => {
    let cancelled = false;
    setLoadingArticle(true);
    (async () => {
      try {
        const items = await getEventContent(token, eventId);
        if (cancelled) return;
        const existing = items[0];
        if (existing) {
          // The list projection omits reviewNote; fetch the full row so a
          // returned draft can show its "Editor's note". Fall back to the list
          // row if the by-id lookup fails.
          const full = await getContentItem(token, existing.id).catch(() => null);
          if (cancelled) return;
          const adopted = full ?? existing;
          setDraft(adopted);
          setTitleDraft(adopted.title);
          setBodyDraft(adopted.body ?? '');
        }
      } catch {
        /* a failed content lookup shouldn't break the page -- leave it empty */
      } finally {
        if (!cancelled) setLoadingArticle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  async function save(input: { status?: MyAssignment['status']; notes?: string }) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAssignment(token, assignment.id, input);
      setAssignmentStatus(updated.status);
      setSavedNotes(updated.notes ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Merge a PATCH /events/:id/result response back into the page: the echoed
  // score/video/status and the seeded drafts, plus the success line. Shared by
  // the score save, Go Live, and End Game so all three update in place.
  function applyResult(updated: EventResult, notice: string) {
    setResult({
      homeScore: updated.homeScore,
      awayScore: updated.awayScore,
      videoUrl: updated.videoUrl,
      status: updated.status,
    });
    setHomeScoreDraft(updated.homeScore != null ? String(updated.homeScore) : '');
    setAwayScoreDraft(updated.awayScore != null ? String(updated.awayScore) : '');
    setVideoUrlDraft(updated.videoUrl ?? '');
    setResultNotice(notice);
  }

  // Report/update the score. Build the body from only the filled-in fields so a
  // rep can save just a score, just a video link, or both -- and NEVER changes
  // status. Only reachable pre-game and post-game (the result body doesn't
  // render while live; the console owns the running score courtside).
  async function saveResult() {
    const body: UpdateEventResultInput = {};
    if (homeScoreDraft.trim() !== '') body.homeScore = Number(homeScoreDraft);
    if (awayScoreDraft.trim() !== '') body.awayScore = Number(awayScoreDraft);
    if (videoUrlDraft.trim() !== '') body.videoUrl = videoUrlDraft.trim();
    if (
      body.homeScore === undefined &&
      body.awayScore === undefined &&
      body.videoUrl === undefined
    ) {
      return;
    }
    setResultSaving(true);
    setResultError(null);
    setResultNotice(null);
    try {
      const updated = await updateEventResult(token, eventId, body);
      applyResult(updated, isLive ? 'Score updated.' : 'Result saved.');
    } catch (err) {
      // 403 (not your game) / 400 (bad body) surface as "<status> <message>".
      setResultError(err instanceof Error ? err.message : 'Failed to save result');
    } finally {
      setResultSaving(false);
    }
  }

  // ---- THE STREAM URL, SAVED ON ITS OWN --------------------------------
  // A SEPARATE SAVE FROM saveResult, and the separation is the point.
  //
  // saveResult sends every non-empty draft it holds -- scores included -- which
  // is right on the pre-game and final forms where the rep is looking at those
  // fields. Reached from the live Stream view it would be a hazard: homeScoreDraft
  // and awayScoreDraft are seeded from whatever the score was when the page
  // loaded, so saving a stream URL mid-game could PATCH a stale score over the
  // running one. The console owns the live score; nothing else may write it.
  //
  // The API takes a partial patch (events.service.ts reportResult builds it
  // field by field from what is defined), so a videoUrl-only body touches
  // nothing else. Status is untouched too: this is not Go Live.
  async function saveStreamUrl() {
    const url = videoUrlDraft.trim();
    if (url === '') return;
    setResultSaving(true);
    setResultError(null);
    setResultNotice(null);
    try {
      const updated = await updateEventResult(token, eventId, { videoUrl: url });
      applyResult(updated, 'Stream URL saved.');
    } catch (err) {
      setResultError(err instanceof Error ? err.message : 'Failed to save the stream URL');
    } finally {
      setResultSaving(false);
    }
  }

  // Take a scheduled game live. The stream URL must be pasted first, so with an
  // empty video field we prompt inline instead of PATCHing; with a URL present
  // we PATCH { status: 'live', videoUrl } and the page flips to its live state.
  async function goLive() {
    if (videoUrlDraft.trim() === '') {
      setNeedsUrl(true);
      return;
    }
    setNeedsUrl(false);
    setLiveSaving(true);
    setLiveError(null);
    setResultNotice(null);
    try {
      const updated = await updateEventResult(token, eventId, {
        status: 'live',
        videoUrl: videoUrlDraft.trim(),
      });
      applyResult(updated, 'You’re live.');
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Failed to go live');
    } finally {
      setLiveSaving(false);
    }
  }

  // End a live game: PATCH { status: 'final' } with the live scores handed up
  // from the console (the console owns the confirm + busy/error state). Throws
  // on failure so the console can surface it; applyResult flips the page to its
  // final shape in place.
  async function endGame(homeScore: number, awayScore: number) {
    const updated = await updateEventResult(token, eventId, {
      status: 'final',
      homeScore,
      awayScore,
    });
    applyResult(updated, 'Game ended — marked final.');
  }

  // Draft a recap from the current notes text. Uses whatever is in the notes
  // box right now (not just the last-saved value) as the source material.
  async function generate() {
    setGenerating(true);
    setGenError(null);
    setDraft(null);
    setEditError(null);
    setPublishError(null);
    try {
      const item = await generateArticle(token, {
        eventId,
        authorId,
        sourceText: notesDraft,
      });
      setDraft(item);
      setTitleDraft(item.title);
      setBodyDraft(item.body ?? '');
    } catch (err) {
      // The client formats AI failures (502/503/504) and bad ids (404) as
      // "<status> <message>".
      setGenError(err instanceof Error ? err.message : 'Failed to generate article');
    } finally {
      setGenerating(false);
    }
  }

  // Persist edited title/body via PATCH /content/:id. Merge the returned row
  // back into `draft` so the dirty check and status pill track the server.
  async function saveDraft() {
    if (!draft) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await updateContent(token, draft.id, {
        title: titleDraft,
        body: bodyDraft,
      });
      setDraft(updated);
      setTitleDraft(updated.title);
      setBodyDraft(updated.body ?? '');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  }

  // Author action: submit the draft for editorial review (draft -> submitted).
  // Reuses the publish button's loading/error slot (they're never shown at
  // once). Merges status + the cleared reviewNote back so the panel flips to its
  // read-only "awaiting review" state in place.
  async function submitForReview() {
    if (!draft) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const updated = await submitContent(token, draft.id);
      setDraft((d) =>
        d
          ? { ...d, status: updated.status, reviewNote: updated.reviewNote ?? null }
          : updated,
      );
    } catch (err) {
      setPublishError(
        err instanceof Error ? err.message : 'Failed to submit for review',
      );
    } finally {
      setPublishing(false);
    }
  }

  // Flip publish state via POST /content/:id/(un)publish. Only merge the
  // status/publishedAt back so any unsaved title/body edits stay put.
  async function togglePublish() {
    if (!draft) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const updated =
        draft.status === 'published'
          ? await unpublishContent(token, draft.id)
          : await publishContent(token, draft.id);
      setDraft((d) =>
        d ? { ...d, status: updated.status, publishedAt: updated.publishedAt } : updated,
      );
    } catch (err) {
      setPublishError(
        err instanceof Error ? err.message : 'Failed to update publish status',
      );
    } finally {
      setPublishing(false);
    }
  }

  // ---- Section bodies, extracted so each lifecycle shape (scheduled / live /
  // final) can place them in its own order and open-state without duplicating
  // markup. Every internal behavior is unchanged — this only lifts the body out
  // of its old fixed <section> wrapper so a collapsible Section (or the live
  // strip) can own the card chrome around it. ----

  // Result: score inputs + video URL + Save, plus Go Live pre-game. The live
  // running-score / End Game controls live in the console instead, so this body
  // only renders in the scheduled and final shapes (never while live).
  //
  // A REGIONAL MANAGER GETS A SENTENCE INSTEAD OF A FORM. They can hold an
  // assignment and so can reach this workspace, but PATCH /events/:id/result is
  // admin + field_rep, so every control below would 403 for them. Saying which
  // door is closed beats a form that fails on submit AND beats hiding the
  // section outright — a missing section reads as a bug, and the section is
  // still where the filed result is displayed.
  const resultBody = (
    <>
      {!canFileResult && (
        <p className="game-hint">
          Filing the result is the assigned correspondent&apos;s to do (or an
          admin&apos;s). The score shows here once it&apos;s in.
        </p>
      )}
      {canFileResult && (
      <div className="result-row">
        <div className="result-scores">
          <input
            type="number"
            min="0"
            inputMode="numeric"
            className="result-score-input"
            aria-label={`${teamLabel(assignment.event.homeInstitution, assignment.event.homeTeam) || 'Home'} score`}
            placeholder="Home"
            value={homeScoreDraft}
            disabled={resultBusy}
            onChange={(e) => {
              setHomeScoreDraft(e.target.value);
              setResultNotice(null);
            }}
          />
          <span className="result-dash" aria-hidden="true">
            –
          </span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            className="result-score-input"
            aria-label={`${teamLabel(assignment.event.awayInstitution, assignment.event.awayTeam) || 'Away'} score`}
            placeholder="Away"
            value={awayScoreDraft}
            disabled={resultBusy}
            onChange={(e) => {
              setAwayScoreDraft(e.target.value);
              setResultNotice(null);
            }}
          />
        </div>
        <input
          type="url"
          className="result-video-input"
          aria-label={isPreGame ? 'Stream URL' : 'Video URL'}
          placeholder={
            isPreGame
              ? 'Stream URL (https://…) — paste before going live'
              : 'Video URL (https://…)'
          }
          value={videoUrlDraft}
          disabled={resultBusy}
          onChange={(e) => {
            setVideoUrlDraft(e.target.value);
            setResultNotice(null);
            setNeedsUrl(false);
          }}
        />
        <button
          className="btn-inline"
          disabled={resultBusy || !resultHasInput}
          onClick={saveResult}
        >
          {resultSaving ? 'Saving…' : 'Save result'}
        </button>
        {/* A postponed game still gets Go Live -- postponed means "not tonight",
            and when it is played this is the button that starts it. A CANCELED
            game doesn't: it's never being played, and the result form stays only
            so a wrongly-canceled game isn't a dead end. */}
        {(isScheduled || isPostponed) && (
          <button className="btn-inline" disabled={resultBusy} onClick={goLive}>
            {liveSaving ? 'Going live…' : 'Go Live'}
          </button>
        )}
      </div>
      )}
      {/* The hints below belong to the CONTROLS, so they follow them behind the
          same gate. What survives for a manager is the filed score and any
          error the page is already showing. */}
      {canFileResult && (isPostponed || isCanceled) && (
        <p className="game-hint">
          This game is marked {eventStatusLabel(currentStatus).toLowerCase()}.
          You can still file a result or write it up
          {isPostponed ? ', and Go Live when it’s played.' : '.'}
        </p>
      )}
      {canFileResult && needsUrl && (
        <p className="game-hint">
          Paste the stream URL above first — it needs to be set before the game
          goes live.
        </p>
      )}
      {result && result.homeScore != null && result.awayScore != null && (
        <p className="result-current">
          {result.status === 'final' && <span className="pill">Final</span>}
          {result.status === 'live' && <LiveBadge />}
          <span className="result-current__score">
            {result.homeScore} – {result.awayScore}
          </span>
        </p>
      )}
      {resultNotice && !resultError && <div className="success">{resultNotice}</div>}
      {resultError && <div className="error">{resultError}</div>}
      {liveError && <div className="error">{liveError}</div>}
    </>
  );

  // Status & notes.
  const notesBody = (
    <>
      <div className="game-status ws-field">
        <label className="game-field-label">Assignment status</label>
        <select
          value={assignmentStatus}
          disabled={saving}
          onChange={(e) => save({ status: e.target.value as MyAssignment['status'] })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="ws-field">
        <label className="game-field-label">Notes</label>
        <div className="game-notes-row">
          <input
            value={notesDraft}
            placeholder="Add notes…"
            disabled={saving}
            onChange={(e) => setNotesDraft(e.target.value)}
          />
          <button
            className="btn-inline"
            disabled={saving || !notesDirty}
            onClick={() => save({ notes: notesDraft })}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="game-hint">
          Notes are the source material the AI recap is drafted from.
        </p>
      </div>
      {error && <div className="error">{error}</div>}
    </>
  );

  // AI article editor / editorial review states.
  const articleBody = loadingArticle ? (
    <p className="muted">Loading article…</p>
  ) : (
    <>
      {!draft && (
        <div className="ws-generate">
          <button
            className="btn-inline"
            disabled={generating || !canGenerate}
            onClick={generate}
          >
            {generating ? 'Generating…' : 'Generate article from notes'}
          </button>
          {!canGenerate && (
            <p className="game-hint">
              Add notes above first — the recap is drafted from them.
            </p>
          )}
        </div>
      )}

      {generating && (
        <p className="game-generating">
          Generating article… (this can take a few seconds)
        </p>
      )}
      {genError && <div className="error">{genError}</div>}

      {draft && (
        <div className="article-panel">
          <div className="article-panel__head">
            <span className="article-panel__label">Article</span>
            {draft.status === 'submitted' ? (
              <span className="pill pill--review">Submitted — awaiting review</span>
            ) : (
              <span className="pill">{draft.status}</span>
            )}
          </div>

          {/* Send-back feedback loop: an editor's note on a returned draft,
              shown only while draft (never stale on published). */}
          {draft.status === 'draft' && draft.reviewNote && (
            <div className="editor-note">
              <span className="editor-note__label">Editor&apos;s note</span>
              <p className="editor-note__body">{draft.reviewNote}</p>
            </div>
          )}

          {repReadOnly ? (
            // Locked while in the editors' queue: read-only render only.
            <div className="article-review-lock">
              <p className="game-hint" style={{ marginTop: 0 }}>
                This article is in review — editing is locked until an editor
                publishes it or sends it back.
              </p>
              <h3 className="article-review-lock__title">{draft.title}</h3>
              <div
                className="article-body"
                dangerouslySetInnerHTML={{ __html: draft.body ?? '' }}
              />
            </div>
          ) : (
            <>
              <label style={{ marginTop: 16 }}>Title</label>
              <input
                value={titleDraft}
                disabled={editSaving}
                onChange={(e) => setTitleDraft(e.target.value)}
              />

              <label style={{ marginTop: 16 }}>Body (HTML)</label>
              <textarea
                value={bodyDraft}
                disabled={editSaving}
                onChange={(e) => setBodyDraft(e.target.value)}
                rows={10}
                className="mono"
              />

              <div className="article-actions">
                <button
                  className="btn-inline"
                  disabled={editSaving || !draftDirty}
                  onClick={saveDraft}
                >
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>

                {canPublishDirectly ? (
                  // Staff publish/unpublish directly.
                  <button
                    className="btn-inline"
                    disabled={publishing}
                    onClick={togglePublish}
                  >
                    {publishing
                      ? draft.status === 'published'
                        ? 'Unpublishing…'
                        : 'Publishing…'
                      : draft.status === 'published'
                        ? 'Unpublish'
                        : 'Publish'}
                  </button>
                ) : (
                  // A field_rep submits a draft for review; on a published item
                  // they get no second action (Unpublish is staff-only).
                  draft.status === 'draft' && (
                    <button
                      className="btn-inline"
                      disabled={publishing}
                      onClick={submitForReview}
                    >
                      {publishing ? 'Submitting…' : 'Submit for review'}
                    </button>
                  )
                )}
              </div>

              {editError && <div className="error">{editError}</div>}
              {publishError && <div className="error">{publishError}</div>}
            </>
          )}
        </div>
      )}
    </>
  );

  // Presenting sponsor (rep's own view only). Null when the viewer can't sponsor
  // so callers can skip rendering the section entirely.
  const sponsorBody = canSponsor ? (
    <>
      {loadingSponsor ? (
        <p className="muted">Loading sponsor…</p>
      ) : sponsorship ? (
        <div className="ws-sponsor">
          <p className="game-sponsor-line" style={{ marginTop: 0 }}>
            Presented by{' '}
            <span className="game-sponsor-line__name">{sponsorship.businessName}</span>
          </p>
          {attachedByMe ? (
            <button
              type="button"
              className="link-btn"
              disabled={removing}
              onClick={removeSponsor}
            >
              {removing ? 'Removing…' : 'Remove sponsor'}
            </button>
          ) : (
            <p className="game-hint">This game already has a presenting sponsor.</p>
          )}
        </div>
      ) : (
        <div className="ws-sponsor">
          <p className="game-hint" style={{ marginTop: 0 }}>
            No presenting sponsor yet. Attach one of your own sales.
          </p>
          <button
            type="button"
            className="btn-inline btn-ghost"
            onClick={() => setShowAttach(true)}
          >
            Attach sponsor
          </button>
        </div>
      )}
      {sponsorError && <div className="error">{sponsorError}</div>}
    </>
  ) : null;

  // Photos. Kept mounted while collapsed (keepMounted / the live strip's hidden
  // panels) so an in-flight upload survives.
  const photosBody = (
    <PhotosSection token={token} eventId={eventId} myUserId={authorId} />
  );

  // The live "everything else" strip below the console: notes, article, sponsor
  // (rep only), photos — one open at a time.
  const stripSections: StripSection[] = [
    { id: 'notes', kicker: 'Assignment', title: 'Status & notes', body: notesBody },
    { id: 'article', kicker: 'Coverage', title: 'Article', body: articleBody },
    ...(canSponsor
      ? [
          {
            id: 'sponsor',
            kicker: 'Presenting sponsor',
            title: 'Sponsor',
            body: sponsorBody,
          },
        ]
      : []),
    { id: 'photos', kicker: 'Gallery', title: 'Photos', body: photosBody },
  ];

  // ---- THE HEADER, BUILT ONCE AND PLACED BY PHASE ------------------------
  // Live: it goes in the console's RAIL, above the feed -- "which game am I
  // running" is standing-read context by the same test that puts the feed
  // there, and putting it above the grid would push the console down the screen
  // when the console being first is the whole point of the live shape.
  // Otherwise: it is the page's first block, where it has always been.
  const headerBlock = (
      <header className="ws-header">
        <span className="game-kicker">{assignment.event.sport}</span>
        <h1 className="ws-title">{matchup(assignment) ?? assignment.event.sport}</h1>
        <div className="game-meta ws-meta">
          {assignment.event.venue && (
            <span className="game-meta__seg">{assignment.event.venue}</span>
          )}
          <span className="game-meta__seg">
            {formatWhen(assignment.event.scheduledAt)}
          </span>
        </div>
        {sponsorship && (
          <p className="game-sponsor-line">
            Presented by{' '}
            <span className="game-sponsor-line__name">{sponsorship.businessName}</span>
          </p>
        )}
        <div className="ws-pills">
          {isLive ? (
            <LiveBadge />
          ) : (
            <span className="pill">{eventStatusLabel(currentStatus)}</span>
          )}
          <span className="pill">{assignmentStatus}</span>
          <Link href={`/games/${eventId}`} className="ws-public-link">
            View public page →
          </Link>
        </div>
      </header>
  );

  // The Call, if this game is the week's. Directly under the header in every
  // lifecycle shape: the tile is only urgent post-game, but a correspondent
  // checking on their published card pre-game should not have to hunt for it
  // either. Self-hides on every other game. Live, it rides in `below`.
  const callTile = (
      <CallTile
        token={token}
        eventId={eventId}
        kickoff={assignment.event.scheduledAt}
      />

  );

  return (
    <>
      {/* ---- Live console: courtside top priority, only while the game is live ---- */}
      {isLive && (
        <LiveConsole
          token={token}
          eventId={eventId}
          sponsorship={sponsorship}
          initialHome={result?.homeScore ?? null}
          initialAway={result?.awayScore ?? null}
          homeLabel={teamLabel(assignment.event.homeInstitution, assignment.event.homeTeam) || 'Home'}
          awayLabel={teamLabel(assignment.event.awayInstitution, assignment.event.awayTeam) || 'Away'}
          canAskWinner={
            !!assignment.event.homeTeamId && !!assignment.event.awayTeamId
          }
          canEndGame={canFileResult}
          onEndGame={endGame}
          // ---- THE LABEL. One line, body scale, and that is the whole
          // brief: a correspondent knows which game they are at. This is
          // identification, not an announcement. ----
          label={
            <>
              <span className="cdash__matchup">
                {matchup(assignment) ?? assignment.event.sport}
              </span>
              {assignment.event.venue && (
                <span className="cdash__meta">{assignment.event.venue}</span>
              )}
              <span className="cdash__meta">{assignmentStatus}</span>
              {sponsorship && (
                <span className="cdash__meta">
                  Presented by {sponsorship.businessName}
                </span>
              )}
              <Link href={`/games/${eventId}`} className="cdash__link">
                Public page →
              </Link>
            </>
          }
          // ---- THE DRAWER'S CONTENTS, in the order the chips read. Every one
          // of these is either after-the-game work or occasional, which is the
          // test for being in here rather than on the screen. ----
          panels={[
            {
              // ---- FIRST IN THE DRAWER, AND THE ONLY ONE THAT IS NOT
              // "after the game" work. A correspondent pastes the stream URL
              // when they START STREAMING, which is routinely after the game
              // has gone live -- and if the stream drops and comes back on a
              // new URL, it changes mid-game. It used to exist only on the
              // pre-game Result card, which the dashboard replaces the moment
              // the game goes live, so the field became unreachable exactly
              // when it was most likely to be needed.
              //
              // It is NOT on the console itself: it is touched once or twice a
              // night, and the working area is reserved for the things touched
              // every minute. A view of its own is the right weight.
              id: 'stream',
              label: 'Stream URL',
              body: (
                <div className="stream-panel">
                  <label className="stream-panel__label" htmlFor="stream-url">
                    Stream URL
                  </label>
                  <input
                    id="stream-url"
                    type="url"
                    className="result-video-input"
                    placeholder="https://…"
                    value={videoUrlDraft}
                    disabled={resultBusy}
                    onChange={(e) => {
                      setVideoUrlDraft(e.target.value);
                      setResultNotice(null);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-inline"
                    disabled={resultBusy || videoUrlDraft.trim() === ''}
                    onClick={saveStreamUrl}
                  >
                    {resultSaving ? 'Saving…' : 'Save stream URL'}
                  </button>
                  {/* Saves the URL and NOTHING ELSE -- see saveStreamUrl for
                      why the score must not ride along. */}
                  <p className="muted stream-panel__note">
                    Saved on its own. This does not touch the live score.
                  </p>
                  {resultError && <div className="error">{resultError}</div>}
                  {resultNotice && (
                    <p className="stream-panel__ok">{resultNotice}</p>
                  )}
                </div>
              ),
            },
            {
              id: 'predictions',
              label: 'Predictions',
              body: (
                <ConsolePredictions
                  token={token}
                  eventId={eventId}
                  homeLabel={
                    teamLabel(assignment.event.homeInstitution, assignment.event.homeTeam) ||
                    'Home'
                  }
                  awayLabel={
                    teamLabel(assignment.event.awayInstitution, assignment.event.awayTeam) ||
                    'Away'
                  }
                  canAskWinner={
                    !!assignment.event.homeTeamId && !!assignment.event.awayTeamId
                  }
                />
              ),
            },
            {
              id: 'call',
              label: 'The Call',
              // NO CHIP UNTIL THE TILE SAYS THERE IS A CARD. The body mounts
              // either way -- that is what performs the lookup this flag is
              // waiting on -- so the chip appears a moment after load on the
              // one game a week that has a Call, and never on the others.
              chip: hasCall,
              body: (
                <CallTile
                  token={token}
                  eventId={eventId}
                  kickoff={assignment.event.scheduledAt}
                  onAvailable={setHasCall}
                />
              ),
            },
            ...stripSections.map((sec) => ({
              id: sec.id,
              label: sec.title,
              body: sec.body,
            })),
          ]}
        />
      )}

      {/* ---- EVERY OTHER PHASE keeps the shape it has always had: the header
           first, then the Call tile, then the phase's own sections in one
           column. There is no rail off-live -- nothing on a scheduled or
           finished game is a standing read while you act -- which is also why
           the page must not widen. See .ws-page--console. ---- */}
      {!isLive && (
        <>
          {headerBlock}
          {callTile}
        </>
      )}

      {/* ---- Header: matchup + meta on the left, status pills + public link ---- */}
      {/* ---- PRE-GAME (scheduled, postponed, canceled): filing the result is
           the job, and Go-Live starts it. Notes + Sponsor open for prep;
           Article + Photos collapsed (mostly post-game work). The kicker no
           longer says "Live &" -- the result form does NOT require going live
           (saveResult never touches status), and the old label taught the
           opposite to anyone skimming. ---- */}
      {isPreGame && (
        <>
          <Section key="sched-result" kicker="Result" title="Report the result">
            {resultBody}
          </Section>
          <Section key="sched-notes" kicker="Assignment" title="Status & notes">
            {notesBody}
          </Section>
          <Section
            key="sched-article"
            kicker="Coverage"
            title="Article"
            defaultOpen={false}
          >
            {articleBody}
          </Section>
          {canSponsor && (
            <Section
              key="sched-sponsor"
              kicker="Presenting sponsor"
              title="Sponsor"
            >
              {sponsorBody}
            </Section>
          )}
          <Section
            key="sched-photos"
            kicker="Gallery"
            title="Photos"
            defaultOpen={false}
            keepMounted
          >
            {photosBody}
          </Section>
        </>
      )}

      {/* ---- LIVE (courtside): the console IS the page. Its three regions --
           the emit surface, the rail, and everything else -- are laid out by
           LiveConsole itself, so nothing for the live phase is rendered here.
           The standalone Live & Result section does not render either: its live
           controls (running score via the console board + Sync, End Game) live
           in the console. ---- */}

      {/* ---- FINAL (post-game): writing the recap + uploading shots is the
           job, so Article + Photos open; Result summary compact; notes +
           sponsor collapsed. ---- */}
      {isFinal && (
        <>
          <Section key="final-result" kicker="Final" title="Result summary">
            {resultBody}
          </Section>
          {/* ---- THE BOX SCORE, AND IT SITS HERE FOR A REASON. Scout Book
               scores prospects from correspondent-filed stat lines, and until
               now no screen had ever called the filing endpoint — the pipeline
               shipped, the scorer was proven, and the surface was never built.
               It belongs in the workspace rather than a console because this is
               the moment the spec's in-flow prompt was aimed at: the game just
               ended, the rep is still in the gym, and they are already on this
               page. The missing-line nudge now deep-links here.

               FINAL ONLY. A line before the game is over is a guess, and the
               scorer treats a filed line as the record. ---- */}
          <Section
            key="final-stats"
            kicker="Box score"
            title="File stat lines"
            defaultOpen={false}
          >
            {token && (
              <StatLinesPanel
                token={token}
                eventId={eventId}
                homeLabel={teamLabel(assignment.event.homeInstitution, assignment.event.homeTeam) || 'Home'}
                awayLabel={teamLabel(assignment.event.awayInstitution, assignment.event.awayTeam) || 'Away'}
              />
            )}
          </Section>
          <Section key="final-article" kicker="Coverage" title="Article">
            {articleBody}
          </Section>
          <Section key="final-photos" kicker="Gallery" title="Photos" keepMounted>
            {photosBody}
          </Section>
          <Section
            key="final-notes"
            kicker="Assignment"
            title="Status & notes"
            defaultOpen={false}
          >
            {notesBody}
          </Section>
          {canSponsor && (
            <Section
              key="final-sponsor"
              kicker="Presenting sponsor"
              title="Sponsor"
              defaultOpen={false}
            >
              {sponsorBody}
            </Section>
          )}
        </>
      )}

      {showAttach && (
        <AttachSponsorForm
          token={token}
          eventId={eventId}
          orders={myOrders}
          advertisersById={advertisersById}
          onLinked={(s) => {
            setSponsorship(s);
            setShowAttach(false);
          }}
          onClose={() => setShowAttach(false)}
        />
      )}
    </>
  );
}

export default function GameWorkspacePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);
  // Gate an onboarding rep behind the training holding card (see below).
  const { ownRep } = useOwnRep(token, user?.id, allowed);

  const [assignment, setAssignment] = useState<MyAssignment | null>(null);
  const [resultSeed, setResultSeed] = useState<ResultSeed | undefined>(undefined);
  // Which measure <main> is using. See .ws-page--console: 1040px ONLY while a
  // game is live, because that is the only phase with a rail. Seeded below from
  // the same inputs the workspace derives its phase from, so the first paint is
  // right; the workspace's onLiveChange carries the Go-Live / End-Game
  // transitions after that.
  const [liveNow, setLiveNow] = useState(false);
  // The rep's own ad orders + an advertiserId -> businessName map, needed only by
  // the attach-sponsor modal (its picker options, and matching a sponsorship's
  // adOrderId to know the rep attached it). Best-effort: a failure leaves it empty.
  const [myOrders, setMyOrders] = useState<AdOrder[]>([]);
  const [advertisersById, setAdvertisersById] = useState<Record<string, string>>({});
  // The id isn't one of the caller's assignments -> branded access state.
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Only a field_rep can self-claim/sponsor; an admin viewing lacks a sponsor flow.
  const isFieldRep = (user?.roles ?? []).includes('field_rep');
  // Staff (admin/regional_manager) publish/unpublish articles directly; a
  // field_rep author submits for review instead (backend enforces the same).
  const canPublishDirectly = (user?.roles ?? []).some(
    (r) => r === 'admin' || r === 'regional_manager',
  );
  // WHO MAY FILE A RESULT — admin or field_rep, mirroring the backend's
  // @Roles('admin', 'field_rep') on PATCH /events/:id/result. NOT a regional
  // manager, and the omission there is deliberate: a finalized score is the one
  // value on this platform whose consumers disagree about what to do when it
  // moves (half re-derive, half refuse, nothing reconciles them), so the result
  // columns have exactly one door and it is kept narrow. See CLAUDE.md.
  //
  // MIRRORED HERE SO THE PAGE STOPS OFFERING WHAT THE API REFUSES. An RM can
  // legitimately open this workspace — they can hold an assignment, because
  // event_assignments.rep_id points at field_reps and an RM has a rep row — and
  // until now they got the full result form, the Go Live button and the End Game
  // button, all three of which PATCH that same route and all three of which
  // 403'd. Found by the PAGE_ACCESS audit, RESOLVER_TICKETS.md R1a.
  //
  // THIS IS THE INTERIM AND IT IS LABELLED AS ONE. Hiding the controls stops the
  // page lying, but it does not answer the question underneath: an RM-covered
  // game now has nobody who can file its result, and quietly degrades to the
  // covered-sweep auto-close. R3 is that question.
  const canFileResult = (user?.roles ?? []).some(
    (r) => r === 'admin' || r === 'field_rep',
  );

  // Load the caller's assignments and match this event id (the ownership guard),
  // plus the events lookup used to pre-fill the result form. A failed events
  // lookup must not break the page -> swallow it.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      try {
        const [assignments, events] = await Promise.all([
          getMyAssignments(token),
          getEvents(token).catch(() => []),
        ]);
        if (cancelled) return;
        const mine = assignments.find((a) => a.event.id === eventId);
        if (!mine) {
          setNotFound(true);
          return;
        }
        setAssignment(mine);
        const ev = events.find((e) => e.id === eventId);
        if (ev) {
          setResultSeed({
            homeScore: ev.homeScore,
            awayScore: ev.awayScore,
            videoUrl: ev.videoUrl,
            status: ev.status,
          });
        }
      } catch (err) {
        // "404 No rep profile for this user" etc. surface here.
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load game');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId, router, allowed]);

  // The rep's own ad orders + advertiser names, for the attach-sponsor picker.
  // Independent + best-effort: a failure just leaves the picker empty.
  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const [orders, advertisers] = await Promise.all([
          getMyAdOrders(token),
          getAdvertisers(token),
        ]);
        if (cancelled) return;
        setMyOrders(orders);
        setAdvertisersById(
          Object.fromEntries(advertisers.map((a) => [a.id, a.businessName])),
        );
      } catch {
        /* leave empty -- the attach picker just shows no orders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, allowed]);

  if (!token) return null;
  if (!allowed || notFound) return <AccessDenied />;
  // An onboarding rep sees the Academy holding card instead of the workspace.
  if (ownRep?.status === 'onboarding') return <TrainingGate />;

  return (
    <main className={`feed-home ws-page${liveNow ? ' ws-page--console' : ''}`}>
      <Link href="/my-games" className="game-back">
        ← Back to My Games
      </Link>

      {loading && <div className="card muted">Loading game…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && assignment && (
        <GameWorkspace
          assignment={assignment}
          resultSeed={resultSeed}
          onLiveChange={setLiveNow}
          token={token}
          authorId={user?.id ?? ''}
          canSponsor={isFieldRep}
          canPublishDirectly={canPublishDirectly}
          canFileResult={canFileResult}
          myOrders={myOrders}
          advertisersById={advertisersById}
        />
      )}
    </main>
  );
}
