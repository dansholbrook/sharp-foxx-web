'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { useOwnRep, TrainingGate } from '../../training-gate';
import {
  getMyAssignments,
  updateAssignment,
  generateArticle,
  getEventContent,
  updateContent,
  publishContent,
  unpublishContent,
  getEvents,
  updateEventResult,
  getMyAdOrders,
  getAdvertisers,
  getEventSponsorship,
  createSponsorship,
  deleteSponsorship,
  getLiveEvents,
  createLiveEvent,
  deleteLiveEvent,
  MyAssignment,
  ContentItem,
  EventContentItem,
  UpdateEventResultInput,
  EventResult,
  AdOrder,
  Sponsorship,
  LiveEvent,
  LiveEventType,
} from '../../api';

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

// Format the timestamptz string the API returns; fall back to the raw value if
// it somehow doesn't parse.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

// The matchup as readable team names ("Home vs Away"), or null when either side
// is missing a name -- in which case the header falls back to the sport headline.
function matchup(a: MyAssignment): string | null {
  const { homeTeam, awayTeam } = a.event;
  if (!homeTeam || !awayTeam) return null;
  return `${homeTeam} vs ${awayTeam}`;
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

// Time-of-day only ("7:04 PM"), for the emitted-events feed + sponsor "aired at".
function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

// The COURTSIDE console — shown at the top of the workspace only while a game is
// live. Phone-first, big tap targets: a score pad (+1/+2/+3 per team, optimistic
// then reconciled from the emit response), period chips, big-play input + preset
// buttons, a timeout button, the gold sponsor-spot button, and a reverse-chron
// feed of tonight's emitted events with a confirm-first retract. Score updates
// also sync the events scoreboard server-side, so fans see them via the poller.
function LiveConsole({
  token,
  eventId,
  sponsorship,
  initialHome,
  initialAway,
  homeLabel,
  awayLabel,
}: {
  token: string;
  eventId: string;
  sponsorship: Sponsorship | null;
  initialHome: number | null;
  initialAway: number | null;
  homeLabel: string;
  awayLabel: string;
}) {
  const [home, setHome] = useState(initialHome ?? 0);
  const [away, setAway] = useState(initialAway ?? 0);
  // The Sync inputs are the PRIMARY control: editable drafts of each score,
  // kept in step with the reconciled totals (history load, +N bumps, and the
  // post-sync echo all flow through home/away) so the fields always show the
  // live number until the rep types a new one.
  const [homeDraft, setHomeDraft] = useState(String(initialHome ?? 0));
  const [awayDraft, setAwayDraft] = useState(String(initialAway ?? 0));
  const [feed, setFeed] = useState<LiveEvent[]>([]); // newest-first for display
  const [bigPlay, setBigPlay] = useState('');
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHomeDraft(String(home));
    setAwayDraft(String(away));
  }, [home, away]);

  // The rep has typed a score that differs from what's on the board -> Sync is
  // meaningful (and enabled).
  const scoreDirty = homeDraft !== String(home) || awayDraft !== String(away);

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
      setHome(prevHome);
      setAway(prevAway);
      setError(err instanceof Error ? err.message : 'Failed to update score');
    } finally {
      setEmitting(false);
    }
  }

  // PRIMARY: sync both scores at once from the editable inputs (the "glance at
  // the gym board and match it" flow). Clamp to non-negative integers; bail on
  // a non-numeric draft (type=number makes that unlikely, but be safe).
  function syncScore() {
    const nextHome = Math.max(0, Math.trunc(Number(homeDraft)));
    const nextAway = Math.max(0, Math.trunc(Number(awayDraft)));
    if (!Number.isFinite(nextHome) || !Number.isFinite(nextAway)) return;
    void commitScore(nextHome, nextAway);
  }

  // SECONDARY: tap +1/+2/+3 for one team — a one-tap optimistic bump through the
  // same commit/reconcile path.
  function bumpScore(team: 'home' | 'away', points: number) {
    const nextHome = team === 'home' ? home + points : home;
    const nextAway = team === 'away' ? away + points : away;
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

  // Tonight's sponsor spots (newest-first), for the "aired at … · run N tonight".
  const sponsorSpots = feed.filter((e) => e.type === 'sponsor_spot');
  const lastSpot = sponsorSpots[0];

  return (
    <section className="card game ws-section console-card">
      <div className="console-head">
        <LiveBadge />
        <span className="game-kicker">Live console · courtside</span>
      </div>

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
          value={awayDraft}
          disabled={emitting}
          onChange={(e) => setAwayDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <button
        type="button"
        className="console-sync"
        disabled={emitting || !scoreDirty}
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

      {error && <div className="error">{error}</div>}

      {/* (f) Emitted feed with retract */}
      <div className="console-feed">
        <span className="console-label">Tonight&apos;s feed</span>
        {feed.length === 0 ? (
          <p className="muted console-feed__empty">
            No events yet — tap a control above to go on the air.
          </p>
        ) : (
          <ul className="console-feed__list">
            {feed.map((ev) => (
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
        )}
      </div>
    </section>
  );
}

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
  myOrders,
  advertisersById,
}: {
  assignment: MyAssignment;
  resultSeed?: ResultSeed;
  token: string;
  authorId: string;
  canSponsor: boolean;
  myOrders: AdOrder[];
  advertisersById: Record<string, string>;
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
  const [endSaving, setEndSaving] = useState(false);
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
  const resultBusy = resultSaving || endSaving || liveSaving;

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
          setDraft(existing);
          setTitleDraft(existing.title);
          setBodyDraft(existing.body ?? '');
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
  // status (when live this is the "Update Score" running-score save).
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

  // End a live game: PATCH { status: 'final' } together with whatever scores are
  // in the inputs, after a confirm. Reuses the result error line for failures.
  async function endGame() {
    if (
      !window.confirm(
        'End this game and mark it final? The score in the inputs will be published as the final result.',
      )
    ) {
      return;
    }
    const body: UpdateEventResultInput = { status: 'final' };
    if (homeScoreDraft.trim() !== '') body.homeScore = Number(homeScoreDraft);
    if (awayScoreDraft.trim() !== '') body.awayScore = Number(awayScoreDraft);
    setEndSaving(true);
    setResultError(null);
    setResultNotice(null);
    try {
      const updated = await updateEventResult(token, eventId, body);
      applyResult(updated, 'Game ended — marked final.');
    } catch (err) {
      setResultError(err instanceof Error ? err.message : 'Failed to end game');
    } finally {
      setEndSaving(false);
    }
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
          homeLabel={assignment.event.homeTeam ?? 'Home'}
          awayLabel={assignment.event.awayTeam ?? 'Away'}
        />
      )}

      {/* ---- Header: matchup + meta on the left, status pills + public link ---- */}
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
            <span className="pill">{isFinal ? 'Final' : currentStatus}</span>
          )}
          <span className="pill">{assignmentStatus}</span>
          <Link href={`/games/${eventId}`} className="ws-public-link">
            View public page →
          </Link>
        </div>
      </header>

      {/* ---- (a) Live & Result ---- */}
      <section className="card game ws-section">
        <span className="game-kicker">
          {isLive ? 'Live now' : isFinal ? 'Final' : 'Live & result'}
        </span>
        <h2 className="ws-section__title">
          {isLive ? 'Live score' : 'Report result'}
        </h2>
        <div className="result-row">
          <div className="result-scores">
            <input
              type="number"
              min="0"
              inputMode="numeric"
              className="result-score-input"
              aria-label={`${assignment.event.homeTeam ?? 'Home'} score`}
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
              aria-label={`${assignment.event.awayTeam ?? 'Away'} score`}
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
            aria-label={isScheduled ? 'Stream URL' : 'Video URL'}
            placeholder={
              isScheduled
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
            {resultSaving ? 'Saving…' : isLive ? 'Update Score' : 'Save result'}
          </button>
          {isScheduled && (
            <button className="btn-inline" disabled={resultBusy} onClick={goLive}>
              {liveSaving ? 'Going live…' : 'Go Live'}
            </button>
          )}
          {isLive && (
            <button
              className="btn-inline btn-ghost"
              disabled={resultBusy}
              onClick={endGame}
            >
              {endSaving ? 'Ending…' : 'End Game (Final)'}
            </button>
          )}
        </div>
        {needsUrl && (
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
      </section>

      {/* ---- (b) Assignment ---- */}
      <section className="card game ws-section">
        <span className="game-kicker">Assignment</span>
        <h2 className="ws-section__title">Status & notes</h2>

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
      </section>

      {/* ---- (c) Article ---- */}
      <section className="card game ws-section">
        <span className="game-kicker">Coverage</span>
        <h2 className="ws-section__title">Article</h2>

        {loadingArticle ? (
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
                  <span className="pill">{draft.status}</span>
                </div>

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
                </div>

                {editError && <div className="error">{editError}</div>}
                {publishError && <div className="error">{publishError}</div>}
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- (d) Sponsor (rep's own view only) ---- */}
      {canSponsor && (
        <section className="card game ws-section">
          <span className="game-kicker">Presenting sponsor</span>
          <h2 className="ws-section__title">Sponsor</h2>

          {loadingSponsor ? (
            <p className="muted">Loading sponsor…</p>
          ) : sponsorship ? (
            <div className="ws-sponsor">
              <p className="game-sponsor-line" style={{ marginTop: 0 }}>
                Presented by{' '}
                <span className="game-sponsor-line__name">
                  {sponsorship.businessName}
                </span>
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
                <p className="game-hint">
                  This game already has a presenting sponsor.
                </p>
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
        </section>
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
    <main className="feed-home ws-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <Link href="/my-games" className="game-back">
        ← Back to My Games
      </Link>

      {loading && <div className="card muted">Loading game…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && assignment && (
        <GameWorkspace
          assignment={assignment}
          resultSeed={resultSeed}
          token={token}
          authorId={user?.id ?? ''}
          canSponsor={isFieldRep}
          myOrders={myOrders}
          advertisersById={advertisersById}
        />
      )}
    </main>
  );
}
