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
  MyAssignment,
  ContentItem,
  EventContentItem,
} from '../api';

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

// The API returns team UUIDs only (no name join), so show ids when present and
// an honest dash when either side is missing.
function teams(a: MyAssignment): string {
  const { homeTeamId, awayTeamId } = a.event;
  if (!homeTeamId && !awayTeamId) return '—';
  return `${homeTeamId ?? '—'} vs ${awayTeamId ?? '—'}`;
}

// One editable game row. Owns its own saving/error/notes-draft state so a save
// on one row never blocks or clobbers another. On success it hands the changed
// fields back up via onUpdated so the parent's row stays in sync (the PATCH
// response has no event join, so we only ever merge status/notes).
function GameRow({
  game,
  token,
  authorId,
  onUpdated,
}: {
  game: MyAssignment;
  token: string;
  authorId: string;
  onUpdated: (id: string, fields: { status?: MyAssignment['status']; notes?: string | null }) => void;
}) {
  const [notesDraft, setNotesDraft] = useState(game.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <>
      <tr>
        <td style={{ textTransform: 'capitalize' }}>{game.event.sport}</td>
        <td>{game.event.venue ?? '—'}</td>
        <td>{formatWhen(game.event.scheduledAt)}</td>
        <td className="mono">{teams(game)}</td>
        <td>
          <span className="pill">{game.event.status}</span>
        </td>
        <td>
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
        </td>
        <td>
          <span className="pill">{SOURCE_LABELS[game.source] ?? game.source}</span>
        </td>
        <td>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={notesDraft}
              placeholder="Add notes…"
              disabled={saving}
              onChange={(e) => setNotesDraft(e.target.value)}
            />
            <button
              style={{ marginTop: 0, padding: '8px 14px' }}
              disabled={saving || !notesDirty}
              onClick={() => save({ notes: notesDraft })}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {!loadingArticle && !draft && (
              <button
                style={{ marginTop: 0, padding: '8px 14px' }}
                disabled={generating || !canGenerate}
                onClick={generate}
              >
                {generating ? 'Generating…' : 'Generate article'}
              </button>
            )}
          </div>
          {error && (
            <div className="error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
        </td>
      </tr>
      {(generating || genError || draft) && (
        <tr>
          <td colSpan={8}>
            {generating && (
              <p className="muted">Generating article… (this can take a few seconds)</p>
            )}
            {genError && <div className="error">{genError}</div>}
            {draft && (
              <div className="card" style={{ marginTop: 0 }}>
                <span className="muted">
                  Article · <span className="pill">{draft.status}</span>
                </span>

                <label className="muted" style={{ display: 'block', marginTop: 12 }}>
                  Title
                </label>
                <input
                  value={titleDraft}
                  disabled={editSaving}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  style={{ width: '100%' }}
                />

                <label className="muted" style={{ display: 'block', marginTop: 12 }}>
                  Body (HTML)
                </label>
                <textarea
                  value={bodyDraft}
                  disabled={editSaving}
                  onChange={(e) => setBodyDraft(e.target.value)}
                  rows={10}
                  className="mono"
                  style={{ width: '100%' }}
                />

                <div
                  style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}
                >
                  <button
                    style={{ marginTop: 0, padding: '8px 14px' }}
                    disabled={editSaving || !draftDirty}
                    onClick={saveDraft}
                  >
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    style={{ marginTop: 0, padding: '8px 14px' }}
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

                {editError && (
                  <div className="error" style={{ marginTop: 8 }}>
                    {editError}
                  </div>
                )}
                {publishError && (
                  <div className="error" style={{ marginTop: 8 }}>
                    {publishError}
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function MyGamesPage() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  const [games, setGames] = useState<MyAssignment[] | null>(null);
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
        const data = await getMyAssignments(token);
        if (!cancelled) setGames(data);
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
    <main>
      <div className="header-row">
        <div>
          <h1>My games</h1>
          <span className="muted">
            Signed in as <span className="mono">{user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <div className="nav-links">
          <Link href="/dashboard" className="link-btn">
            ← Reports
          </Link>
          <button className="link-btn" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      <section className="card">
        <h2>Assigned games</h2>
        {loading && <p className="muted">Loading games…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && games && games.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Sport</th>
                <th>Venue</th>
                <th>Scheduled</th>
                <th>Teams</th>
                <th>Event</th>
                <th>Assignment</th>
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <GameRow
                  key={g.id}
                  game={g}
                  token={token}
                  authorId={user?.id ?? ''}
                  onUpdated={onRowUpdated}
                />
              ))}
            </tbody>
          </table>
        ) : (
          !loading && !error && <p className="muted">No games assigned yet.</p>
        )}
      </section>
    </main>
  );
}
