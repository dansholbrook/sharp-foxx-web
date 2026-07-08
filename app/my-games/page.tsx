'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import {
  getMyAssignments,
  updateAssignment,
  generateArticle,
  MyAssignment,
  ContentItem,
} from '../api';

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
  const [draft, setDraft] = useState<ContentItem | null>(null);

  const notesDirty = notesDraft !== (game.notes ?? '');
  // sourceText is required (min 1) by the API -- nothing to generate from an
  // empty notes field, so gate the button on it.
  const canGenerate = notesDraft.trim().length > 0;

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
    try {
      const item = await generateArticle(token, {
        eventId: game.event.id,
        authorId,
        sourceText: notesDraft,
      });
      setDraft(item);
    } catch (err) {
      // The client formats AI failures (502/503/504) and bad ids (404) as
      // "<status> <message>".
      setGenError(err instanceof Error ? err.message : 'Failed to generate article');
    } finally {
      setGenerating(false);
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
            <button
              style={{ marginTop: 0, padding: '8px 14px' }}
              disabled={generating || !canGenerate}
              onClick={generate}
            >
              {generating ? 'Generating…' : 'Generate article'}
            </button>
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
                  Generated draft · <span className="pill">{draft.status}</span>
                </span>
                <h3 style={{ marginTop: 8 }}>{draft.title}</h3>
                {/* body is trusted HTML from our own /content/generate endpoint. */}
                <div dangerouslySetInnerHTML={{ __html: draft.body ?? '' }} />
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
