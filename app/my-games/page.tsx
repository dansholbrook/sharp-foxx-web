'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { AddGameForm } from '../add-game-form';
import { LogSaleForm } from '../log-sale-form';
import { canAccess } from '../roles';
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
  getFieldReps,
  getEventSponsorship,
  createSponsorship,
  deleteSponsorship,
  getMyEarnings,
  MyAssignment,
  ContentItem,
  EventContentItem,
  UpdateEventResultInput,
  EventResult,
  AdOrder,
  Sponsorship,
  MyEarningsReport,
} from '../api';

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Human badge label for a commission's source_type (Ad Sale / NIL /
// Subscription / Retail). Falls back to the raw value for any future source.
const SOURCE_LABELS_COMMISSION: Record<
  MyEarningsReport['commissions'][number]['sourceType'],
  string
> = {
  ad_order: 'Ad Sale',
  nil_contribution: 'NIL',
  subscription: 'Subscription',
  retail_order: 'Retail',
};

// A 4dp rate string (e.g. "0.1500") as a compact percent ("15%"). Trims trailing
// zeros so 0.1500 -> "15%" and 0.1250 -> "12.5%".
function ratePct(rate: string): string {
  const n = Number(rate) * 100;
  if (Number.isNaN(n)) return '—';
  return `${Number(n.toFixed(2))}%`;
}

// Readable earned/paid timestamp (timestamptz ISO); '—' when absent.
function formatEarned(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

// Readable date for an ad order's date-only fields (yyyy-mm-dd), parsed as UTC so
// it never drifts a day in negative-offset timezones. '—' when absent.
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

// The scores/replay link already on an event, used to pre-fill the Report Result
// form. /assignments/mine doesn't carry these, so the page loads them separately
// via GET /events and seeds each row by event id (see the events map below).
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

// Human labels for the assignment source. 'assigned' means a manager put the
// rep on this game; 'self_claimed' means the rep grabbed it themselves.
const SOURCE_LABELS: Record<MyAssignment['source'], string> = {
  assigned: 'Assigned',
  self_claimed: 'Self-claimed',
};

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
// is missing a name -- in which case the card falls back to the sport headline
// and shows no matchup line at all (no raw UUIDs).
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
// it hands the new Sponsorship back up so the card updates without a refetch.
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
      // the rep can pick a different game or back out.
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

// One editable game row. Owns its own saving/error/notes-draft state so a save
// on one row never blocks or clobbers another. On success it hands the changed
// fields back up via onUpdated so the parent's row stays in sync (the PATCH
// response has no event join, so we only ever merge status/notes).
function GameRow({
  game,
  token,
  authorId,
  resultSeed,
  onUpdated,
  // Sponsor management is the rep's own view only (canSponsor). myOrders are the
  // rep's own ad orders -- both the attach picker's options and how we tell a
  // sponsorship the rep attached (its adOrderId is one of theirs) so we can offer
  // Remove. advertisersById labels those orders. All best-effort from the parent.
  canSponsor,
  myOrders,
  advertisersById,
}: {
  game: MyAssignment;
  token: string;
  authorId: string;
  resultSeed?: ResultSeed;
  onUpdated: (id: string, fields: { status?: MyAssignment['status']; notes?: string | null }) => void;
  canSponsor: boolean;
  myOrders: AdOrder[];
  advertisersById: Record<string, string>;
}) {
  const [notesDraft, setNotesDraft] = useState(game.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Presenting sponsor for this game (or null). Loaded once on mount; a
  // failed lookup is swallowed so it never breaks the row. showAttach drives the
  // attach modal; removing/sponsorError own the Remove action's state.
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
        const s = await getEventSponsorship(token, game.event.id);
        if (!cancelled) setSponsorship(s);
      } catch {
        /* a failed sponsor lookup shouldn't break the row -- leave it null */
      } finally {
        if (!cancelled) setLoadingSponsor(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, game.event.id]);

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
  // last-known-good values we echo back in the card, updated from the PATCH
  // response so the card reflects the save without a refetch. Independent of the
  // notes/assignment save above -- owns its own saving/error/confirmation state.
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
  // refreshed from each PATCH response), so the card reflects go-live / end-game
  // in place; fall back to the status carried on the assignment.
  const currentStatus = result?.status ?? game.event.status;
  const isScheduled = currentStatus === 'scheduled';
  const isLive = currentStatus === 'live';
  const resultBusy = resultSaving || endSaving || liveSaving;

  // At least one field must be sent (empty body -> 400), so gate Save on that.
  const resultHasInput =
    homeScoreDraft.trim() !== '' ||
    awayScoreDraft.trim() !== '' ||
    videoUrlDraft.trim() !== '';

  // AI recap generation is per-row and independent of the notes save above, so
  // it owns its own loading/error/result state. The AI call takes a few seconds.
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableArticle | null>(null);

  // Any article already attached to this game, loaded once on mount so a rep can
  // edit/publish an existing draft without regenerating. A failed lookup is
  // swallowed -- it must not break the game row -- and the Generate button stays
  // hidden until we know whether an article exists.
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

  const notesDirty = notesDraft !== (game.notes ?? '');
  // sourceText is required (min 1) by the API -- nothing to generate from an
  // empty notes field, so gate the button on it.
  const canGenerate = notesDraft.trim().length > 0;

  // On mount, pull any content already attached to this game and adopt the first
  // (the backend lists this non-published view newest-created first) as the
  // editable draft, seeding the edit fields from it.
  useEffect(() => {
    let cancelled = false;
    setLoadingArticle(true);
    (async () => {
      try {
        const items = await getEventContent(token, game.event.id);
        if (cancelled) return;
        const existing = items[0];
        if (existing) {
          setDraft(existing);
          setTitleDraft(existing.title);
          setBodyDraft(existing.body ?? '');
        }
      } catch {
        /* a failed content lookup shouldn't break the row -- leave it empty */
      } finally {
        if (!cancelled) setLoadingArticle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, game.event.id]);

  async function save(input: { status?: MyAssignment['status']; notes?: string }) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAssignment(token, game.id, input);
      onUpdated(game.id, { status: updated.status, notes: updated.notes });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Merge a PATCH /events/:id/result response back into the card: the echoed
  // score/video/status and the seeded drafts, plus the success line. Shared by
  // the score save, Go Live, and End Game so all three update the card in place.
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
    // Nothing filled in -- the backend would 400; the button is already disabled
    // in this state, but guard anyway.
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
      const updated = await updateEventResult(token, game.event.id, body);
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
  // we PATCH { status: 'live', videoUrl } and the card flips to its live state.
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
      const updated = await updateEventResult(token, game.event.id, {
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
      const updated = await updateEventResult(token, game.event.id, body);
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
        eventId: game.event.id,
        authorId,
        sourceText: notesDraft,
      });
      setDraft(item);
      // Seed the editable fields from the freshly generated draft.
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
    <article className="card game">
      {/* ---- Header: matchup headline (sport fallback) + meta on the left, pills on the right ---- */}
      <div className="game-head">
        <div>
          <span className="game-kicker">{game.event.sport}</span>
          <h3 className="game-title">{matchup(game) ?? game.event.sport}</h3>
          <div className="game-meta">
            {game.event.venue && (
              <span className="game-meta__seg">{game.event.venue}</span>
            )}
            <span className="game-meta__seg">{formatWhen(game.event.scheduledAt)}</span>
          </div>
          {sponsorship && (
            <p className="game-sponsor-line">
              Presented by{' '}
              <span className="game-sponsor-line__name">
                {sponsorship.businessName}
              </span>
            </p>
          )}
        </div>
        <div className="game-pills">
          {isLive ? (
            <LiveBadge />
          ) : (
            <span className="pill">{currentStatus}</span>
          )}
          <span className="pill">{SOURCE_LABELS[game.source] ?? game.source}</span>
        </div>
      </div>

      {/* ---- Sponsor actions (rep's own view): attach when unsponsored, remove
          a sponsorship the rep attached. Hidden until the lookup resolves. ---- */}
      {canSponsor && !loadingSponsor && (
        <div className="game-sponsor-actions">
          {!sponsorship ? (
            <button
              type="button"
              className="btn-inline btn-ghost"
              onClick={() => setShowAttach(true)}
            >
              Attach sponsor
            </button>
          ) : (
            attachedByMe && (
              <button
                type="button"
                className="link-btn"
                disabled={removing}
                onClick={removeSponsor}
              >
                {removing ? 'Removing…' : 'Remove sponsor'}
              </button>
            )
          )}
          {sponsorError && <div className="error">{sponsorError}</div>}
        </div>
      )}

      {showAttach && (
        <AttachSponsorForm
          token={token}
          eventId={game.event.id}
          orders={myOrders}
          advertisersById={advertisersById}
          onLinked={(s) => {
            setSponsorship(s);
            setShowAttach(false);
          }}
          onClose={() => setShowAttach(false)}
        />
      )}

      {/* ---- Controls: notes, status, generate, article panel ---- */}
      <div className="game-controls">
        <div>
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
            {!loadingArticle && !draft && (
              <button
                className="btn-inline"
                disabled={generating || !canGenerate}
                onClick={generate}
              >
                {generating ? 'Generating…' : 'Generate article'}
              </button>
            )}
          </div>
          {error && <div className="error">{error}</div>}
        </div>

        <div className="game-status">
          <label className="game-field-label">Assignment status</label>
          <select
            value={game.status}
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

        {/* ---- Result / live score: scores + stream/replay link, PATCHed to the
            event. Same fields throughout; the buttons change with status --
            Go Live (scheduled), Update Score + End Game (live). ---- */}
        <div className="game-result">
          <label className="game-field-label">
            {isLive ? 'Live score' : 'Report result'}
          </label>
          <div className="result-row">
            <div className="result-scores">
              <input
                type="number"
                min="0"
                inputMode="numeric"
                className="result-score-input"
                aria-label={`${game.event.homeTeam ?? 'Home'} score`}
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
                aria-label={`${game.event.awayTeam ?? 'Away'} score`}
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
              {resultSaving
                ? 'Saving…'
                : isLive
                  ? 'Update Score'
                  : 'Save result'}
            </button>
            {isScheduled && (
              <button
                className="btn-inline"
                disabled={resultBusy}
                onClick={goLive}
              >
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
              Paste the stream URL above first — it needs to be set before the
              game goes live.
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
          {resultNotice && !resultError && (
            <div className="success">{resultNotice}</div>
          )}
          {resultError && <div className="error">{resultError}</div>}
          {liveError && <div className="error">{liveError}</div>}
        </div>

        {(generating || genError || draft) && (
          <div>
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
          </div>
        )}
      </div>
    </article>
  );
}

export default function MyGamesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [games, setGames] = useState<MyAssignment[] | null>(null);
  // eventId -> current scores/replay link, used to pre-fill each row's Report
  // Result form. Loaded from GET /events since /assignments/mine omits them.
  const [resultsByEvent, setResultsByEvent] = useState<Record<string, ResultSeed>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showLogSale, setShowLogSale] = useState(false);

  // My Sales: the rep's own ad orders, plus an advertiserId -> businessName map
  // (ad orders carry only the id) and the rep's commission rate for the Log a
  // Sale confirmation. All best-effort -- a failure here must not break the page.
  const [sales, setSales] = useState<AdOrder[] | null>(null);
  const [advertisersById, setAdvertisersById] = useState<Record<string, string>>({});
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const [commissionRate, setCommissionRate] = useState<string | null>(null);

  // My Earnings: the caller's own commission totals + ledger (reps AND managers
  // have a rep profile). Best-effort and independent of the games/sales loads.
  // A caller with no rep profile (e.g. a bare admin) 403s -- we hide the whole
  // section on that rather than showing an error.
  const [earnings, setEarnings] = useState<MyEarningsReport | null>(null);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [earningsHidden, setEarningsHidden] = useState(false);

  // Whether the signed-in user is actually a field_rep -- only then does adding
  // a game self-claim it (an admin viewing this page just creates the event).
  const isFieldRep = (user?.roles ?? []).includes('field_rep');

  // Load (or reload) the assignments plus the events lookup used to pre-fill each
  // row's Report Result form. Reused on mount and after adding + claiming a game.
  const loadGames = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      // Assignments are the page; the events lookup is only for pre-filling the
      // result form, so a failure there must not break the page -> swallow it.
      const [data, events] = await Promise.all([
        getMyAssignments(t),
        getEvents(t).catch(() => []),
      ]);
      setGames(data);
      setResultsByEvent(
        Object.fromEntries(
          events.map((e) => [
            e.id,
            {
              homeScore: e.homeScore,
              awayScore: e.awayScore,
              videoUrl: e.videoUrl,
              status: e.status,
            },
          ]),
        ),
      );
    } catch (err) {
      // The client turns failures into "<status> <message>", e.g. a user with
      // no rep profile gets "404 No rep profile for this user".
      setError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load (or reload) the My Sales section: the rep's own ad orders plus the
  // advertiser-name map used to render them. Reused on mount and after logging a
  // sale. Its own error state so a sales failure never touches the games list.
  const loadSales = useCallback(async (t: string) => {
    setSalesLoading(true);
    setSalesError(null);
    try {
      const [orders, advertisers] = await Promise.all([
        getMyAdOrders(t),
        getAdvertisers(t),
      ]);
      setSales(orders);
      setAdvertisersById(
        Object.fromEntries(advertisers.map((a) => [a.id, a.businessName])),
      );
    } catch (err) {
      setSalesError(err instanceof Error ? err.message : 'Failed to load sales');
    } finally {
      setSalesLoading(false);
    }
  }, []);

  // Load (or reload) the My Earnings section: the caller's own commission totals
  // and ledger. Its own error state so an earnings failure never touches the
  // games or sales lists; a 403 (no rep profile) hides the section entirely.
  const loadEarnings = useCallback(async (t: string) => {
    setEarningsLoading(true);
    setEarningsError(null);
    try {
      const data = await getMyEarnings(t);
      setEarnings(data);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Failed to load earnings';
      // No rep profile -> nothing to show; hide the section rather than error.
      if (m.startsWith('403')) setEarningsHidden(true);
      else setEarningsError(m);
    } finally {
      setEarningsLoading(false);
    }
  }, []);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    loadGames(token);
    loadSales(token);
    loadEarnings(token);
    // Resolve the rep's own commission rate for the Log a Sale confirmation.
    // Best-effort: a plain rep may not be able to list field-reps, in which case
    // the confirmation just falls back to "Sale logged."
    const uid = user?.id;
    if (uid) {
      getFieldReps(token)
        .then((reps) => {
          const mine = reps.find((r) => r.userId === uid);
          if (mine) setCommissionRate(mine.commissionRate);
        })
        .catch(() => {});
    }
  }, [token, router, allowed, loadGames, loadSales, loadEarnings, user?.id]);

  // Merge a saved row's changed fields back into state so the UI reflects the
  // server without a full refetch.
  function onRowUpdated(
    id: string,
    fields: { status?: MyAssignment['status']; notes?: string | null },
  ) {
    setGames((prev) =>
      prev
        ? prev.map((g) => (g.id === id ? { ...g, ...fields } : g))
        : prev,
    );
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home">
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

      <div className="masthead">
        <div className="masthead-head">
          <div>
            <span className="masthead-kicker">Your assignments</span>
            <h1 className="masthead-title">My Games</h1>
            <p className="masthead-standfirst">
              Games assigned to you or self-claimed. Add notes, advance the
              assignment status, and draft or publish a recap for each.
            </p>
          </div>
          <div className="masthead-actions">
            <button
              type="button"
              className="btn-inline"
              onClick={() => setShowLogSale(true)}
            >
              Log a Sale
            </button>
            <button
              type="button"
              className="btn-inline"
              onClick={() => setShowAdd(true)}
            >
              + Add Game
            </button>
          </div>
        </div>
      </div>

      {showAdd && (
        <AddGameForm
          token={token}
          selfClaim={isFieldRep}
          onCreated={() => loadGames(token)}
          onClose={() => setShowAdd(false)}
        />
      )}

      {showLogSale && (
        <LogSaleForm
          token={token}
          commissionRate={commissionRate}
          onCreated={() => {
            // A logged sale creates its commission atomically, so refresh both.
            loadSales(token);
            loadEarnings(token);
          }}
          onClose={() => setShowLogSale(false)}
        />
      )}

      {loading && <div className="card muted">Loading games…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && games && games.length > 0 ? (
        <div className="games-list">
          {games.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              token={token}
              authorId={user?.id ?? ''}
              resultSeed={resultsByEvent[g.event.id]}
              onUpdated={onRowUpdated}
              canSponsor={isFieldRep}
              myOrders={sales ?? []}
              advertisersById={advertisersById}
            />
          ))}
        </div>
      ) : (
        !loading && !error && (
          <div className="results-empty">
            <p className="results-empty__title">No games assigned yet</p>
            <p className="results-empty__hint">
              When a manager assigns you a game — or you claim one — it will
              show up here.
            </p>
          </div>
        )
      )}

      {/* ---- My Sales ---- */}
      <section className="card game">
        <span className="game-kicker">Advertising</span>
        <h2>My Sales</h2>
        {salesLoading && <p className="muted">Loading sales…</p>}
        {salesError && <div className="error">{salesError}</div>}
        {!salesLoading && !salesError && sales && sales.length > 0 ? (
          <table className="report-table rep-table">
            <thead>
              <tr>
                <th>Advertiser</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Dates</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>{advertisersById[s.advertiserId] ?? 'Advertiser'}</td>
                  <td>{usd(s.amount)}</td>
                  <td>
                    <span className="pill">{s.status}</span>
                  </td>
                  <td>
                    {s.startsOn || s.endsOn ? (
                      `${formatDate(s.startsOn)} – ${formatDate(s.endsOn)}`
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !salesLoading &&
          !salesError && (
            <div className="results-empty">
              <p className="results-empty__title">No sales logged yet</p>
              <p className="results-empty__hint">
                Use “Log a Sale” above to record an advertiser deal — it will show
                up here with the commission you earned.
              </p>
            </div>
          )
        )}
      </section>

      {/* ---- My Earnings ---- */}
      {!earningsHidden && (
        <section className="card game">
          <span className="game-kicker">Commissions</span>
          <h2>My Earnings</h2>
          {earningsLoading && <p className="muted">Loading earnings…</p>}
          {earningsError && <div className="error">{earningsError}</div>}
          {!earningsLoading && !earningsError && earnings && (
            <>
              <div className="rep-stats earnings-stats">
                <div className="rep-stat">
                  <span className="rep-stat__label">Pending</span>
                  <span className="rep-stat__value">{usd(earnings.totals.pending)}</span>
                </div>
                <div className="rep-stat">
                  <span className="rep-stat__label">Approved</span>
                  <span className="rep-stat__value">{usd(earnings.totals.approved)}</span>
                </div>
                <div className="rep-stat">
                  <span className="rep-stat__label">Paid</span>
                  <span className="rep-stat__value">{usd(earnings.totals.paid)}</span>
                </div>
                <div className="rep-stat">
                  <span className="rep-stat__label">Lifetime</span>
                  <span className="rep-stat__value">{usd(earnings.totals.lifetime)}</span>
                </div>
              </div>

              {earnings.commissions.length > 0 ? (
                <table className="report-table rep-table earnings-ledger">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Base × rate</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                      <th>Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earnings.commissions.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span className="pill">
                            {SOURCE_LABELS_COMMISSION[c.sourceType] ?? c.sourceType}
                          </span>
                        </td>
                        <td className="mono earnings-calc">
                          {usd(c.baseAmount)} × {ratePct(c.rate)}
                        </td>
                        <td className="num total">{usd(c.amount)}</td>
                        <td>
                          <span className="pill">{c.status}</span>
                        </td>
                        <td>{formatEarned(c.earnedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="results-empty">
                  <p className="results-empty__title">No commissions yet</p>
                  <p className="results-empty__hint">
                    Log a sale or land an NIL, subscription, or retail deal — the
                    commission you earn will show up here.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
