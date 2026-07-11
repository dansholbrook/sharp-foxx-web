'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import {
  getReviewQueue,
  publishContent,
  returnContent,
  ReviewQueueItem,
} from '../api';

// Full date + time — used for the "submitted" column/line.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Date-only — used for the game's scheduled date in the meta line.
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// The matchup as "Away @ Home", or null when either side is missing a name.
function matchup(item: ReviewQueueItem): string | null {
  if (!item.homeTeam || !item.awayTeam) return null;
  return `${item.awayTeam} @ ${item.homeTeam}`;
}

// The slide-over for one review item: the matchup context, the rendered article
// body, and the two editorial actions. 'view' shows Approve & publish / Send
// back; 'sendback' swaps the body for an inline note textarea (no second modal).
// Both actions remove the item from the queue on success (via onDecided).
function ReviewDetail({
  item,
  token,
  onDecided,
  close,
}: {
  item: ReviewQueueItem;
  token: string;
  onDecided: () => void;
  close: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'sendback'>('view');
  const [note, setNote] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPublish() {
    if (!window.confirm(`Approve and publish “${item.title}”?`)) return;
    setPublishing(true);
    setError(null);
    try {
      await publishContent(token, item.id);
      onDecided();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  }

  async function onSendBack(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Send only a non-empty note; an empty box returns the draft with no note.
      const trimmed = note.trim();
      await returnContent(token, item.id, trimmed ? { note: trimmed } : {});
      onDecided();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send back');
    } finally {
      setSubmitting(false);
    }
  }

  const body =
    mode === 'sendback' ? (
      <form id="sendback-form" onSubmit={onSendBack} className="rep-form">
        <div className="field field--wide">
          <label htmlFor="review-note">Note to the author (optional)</label>
          <textarea
            id="review-note"
            value={note}
            rows={5}
            placeholder="What needs another pass before this can go live?"
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="muted sponsor-field-hint">
            Returns the article to the author as a draft. They&apos;ll see this
            note as an editor&apos;s note above the editor.
          </span>
        </div>
        {error && <div className="error rep-form-msg">{error}</div>}
      </form>
    ) : (
      <>
        <div className="review-facts">
          <span className="applicant-fact">
            <span className="applicant-fact__label">Author</span>
            {item.author ?? 'Unknown'}
          </span>
          {matchup(item) && (
            <span className="applicant-fact">
              <span className="applicant-fact__label">Matchup</span>
              {matchup(item)}
            </span>
          )}
          {item.eventSport && (
            <span className="applicant-fact">
              <span className="applicant-fact__label">Sport</span>
              {item.eventSport}
            </span>
          )}
          <span className="applicant-fact">
            <span className="applicant-fact__label">Submitted</span>
            {formatWhen(item.createdAt)}
          </span>
          {item.eventScheduledAt && (
            <span className="applicant-fact">
              <span className="applicant-fact__label">Game date</span>
              {formatDate(item.eventScheduledAt)}
            </span>
          )}
        </div>

        <div
          className="article-body review-body"
          dangerouslySetInnerHTML={{ __html: item.body ?? '' }}
        />

        {error && <div className="error rep-form-msg">{error}</div>}
      </>
    );

  const footer =
    mode === 'sendback' ? (
      <>
        <button type="submit" form="sendback-form" disabled={submitting}>
          {submitting ? 'Sending back…' : 'Send back to draft'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={submitting}
          onClick={() => {
            setError(null);
            setMode('view');
          }}
        >
          Back
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          className="btn-inline"
          disabled={publishing}
          onClick={onPublish}
        >
          {publishing ? 'Publishing…' : 'Approve & publish'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={publishing}
          onClick={() => {
            setError(null);
            setMode('sendback');
          }}
        >
          Send back
        </button>
      </>
    );

  return (
    <SlideOver
      onClose={close}
      kicker={mode === 'sendback' ? 'Send back' : item.eventSport ?? 'Feature'}
      title={item.title}
      footer={footer}
      label="Article review"
    >
      {body}
    </SlideOver>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [items, setItems] = useState<ReviewQueueItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getReviewQueue(t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip the fetch for a role that can't use this page -- it would only 403.
    if (token && allowed) load(token);
  }, [token, allowed, load]);

  // Drop a decided item from the list in place (publish or send-back both remove
  // it from the queue).
  function removeItem(id: string) {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
  }

  const columns: Column<ReviewQueueItem>[] = [
    { key: 'title', header: 'Title', cell: (i) => i.title },
    { key: 'author', header: 'Author', cell: (i) => i.author ?? 'Unknown' },
    { key: 'matchup', header: 'Matchup', cell: (i) => matchup(i) ?? '—' },
    { key: 'sport', header: 'Sport', cell: (i) => i.eventSport ?? '—' },
    { key: 'submitted', header: 'Submitted', cell: (i) => formatWhen(i.createdAt) },
  ];

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
        <span className="masthead-kicker">Editorial</span>
        <h1 className="masthead-title">Review</h1>
        <p className="masthead-standfirst">
          Articles your correspondents have submitted for review. Approve to
          publish them to the feed, or send one back to its author with a note.
        </p>
      </div>

      {loading && <div className="card muted">Loading review queue…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && items && items.length > 0 ? (
        <QueueTable
          columns={columns}
          rows={items}
          rowKey={(i) => i.id}
          ariaLabel="Articles awaiting review"
          renderDetail={(i, close) => (
            <ReviewDetail
              item={i}
              token={token}
              onDecided={() => removeItem(i.id)}
              close={close}
            />
          )}
        />
      ) : (
        !loading &&
        !error && (
          <div className="results-empty">
            <p className="results-empty__title">No articles waiting for review</p>
            <p className="results-empty__hint">
              When a correspondent submits a draft for review, it lands here for
              you to publish or send back.
            </p>
          </div>
        )
      )}
    </main>
  );
}
