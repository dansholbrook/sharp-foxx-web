'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
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
  MyAssignment,
  ContentItem,
  EventContentItem,
  UpdateEventResultInput,
} from '../api';

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
}: {
  game: MyAssignment;
  token: string;
  authorId: string;
  resultSeed?: ResultSeed;
  onUpdated: (id: string, fields: { status?: MyAssignment['status']; notes?: string | null }) => void;
}) {
  const [notesDraft, setNotesDraft] = useState(game.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [resultSaved, setResultSaved] = useState(false);

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

  // Report the game result. Build the body from only the filled-in fields so a
  // rep can save just a score, just a video link, or both. Merge the returned
  // event row back into `result`/the drafts so the card reflects the save.
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
    setResultSaved(false);
    try {
      const updated = await updateEventResult(token, game.event.id, body);
      setResult({
        homeScore: updated.homeScore,
        awayScore: updated.awayScore,
        videoUrl: updated.videoUrl,
        status: updated.status,
      });
      setHomeScoreDraft(updated.homeScore != null ? String(updated.homeScore) : '');
      setAwayScoreDraft(updated.awayScore != null ? String(updated.awayScore) : '');
      setVideoUrlDraft(updated.videoUrl ?? '');
      setResultSaved(true);
    } catch (err) {
      // 403 (not your game) / 400 (bad body) surface as "<status> <message>".
      setResultError(err instanceof Error ? err.message : 'Failed to save result');
    } finally {
      setResultSaving(false);
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
        </div>
        <div className="game-pills">
          <span className="pill">{game.event.status}</span>
          <span className="pill">{SOURCE_LABELS[game.source] ?? game.source}</span>
        </div>
      </div>

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

        {/* ---- Report result: scores + replay link, PATCHed to the event ---- */}
        <div className="game-result">
          <label className="game-field-label">Report result</label>
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
                disabled={resultSaving}
                onChange={(e) => {
                  setHomeScoreDraft(e.target.value);
                  setResultSaved(false);
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
                disabled={resultSaving}
                onChange={(e) => {
                  setAwayScoreDraft(e.target.value);
                  setResultSaved(false);
                }}
              />
            </div>
            <input
              type="url"
              className="result-video-input"
              aria-label="Video URL"
              placeholder="Video URL (https://…)"
              value={videoUrlDraft}
              disabled={resultSaving}
              onChange={(e) => {
                setVideoUrlDraft(e.target.value);
                setResultSaved(false);
              }}
            />
            <button
              className="btn-inline"
              disabled={resultSaving || !resultHasInput}
              onClick={saveResult}
            >
              {resultSaving ? 'Saving…' : 'Save result'}
            </button>
          </div>
          {result && result.homeScore != null && result.awayScore != null && (
            <p className="result-current">
              {result.status === 'final' && <span className="pill">Final</span>}
              <span className="result-current__score">
                {result.homeScore} – {result.awayScore}
              </span>
            </p>
          )}
          {resultSaved && !resultError && (
            <div className="success">Result saved.</div>
          )}
          {resultError && <div className="error">{resultError}</div>}
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
  const { token, user, logout } = useAuth();

  const [games, setGames] = useState<MyAssignment[] | null>(null);
  // eventId -> current scores/replay link, used to pre-fill each row's Report
  // Result form. Loaded from GET /events since /assignments/mine omits them.
  const [resultsByEvent, setResultsByEvent] = useState<Record<string, ResultSeed>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Assignments are the page; the events lookup is only for pre-filling the
        // result form, so a failure there must not break the page -> swallow it.
        const [data, events] = await Promise.all([
          getMyAssignments(token),
          getEvents(token).catch(() => []),
        ]);
        if (cancelled) return;
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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load games');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

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

  function onLogout() {
    logout();
    router.replace('/');
  }

  if (!token) return null;

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
        <div className="nav-links">
          <Link href="/feed" className="link-btn">
            Feed
          </Link>
          <Link href="/dashboard" className="link-btn">
            ← Reports
          </Link>
          <button className="link-btn" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      <div className="masthead">
        <span className="masthead-kicker">Your assignments</span>
        <h1 className="masthead-title">My Games</h1>
        <p className="masthead-standfirst">
          Games assigned to you or self-claimed. Add notes, advance the
          assignment status, and draft or publish a recap for each.
        </p>
      </div>

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
    </main>
  );
}
