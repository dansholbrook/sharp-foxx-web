'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getReviewQueue,
  publishContent,
  returnContent,
  ReviewQueueItem,
} from '../api';

// Full date + time — used in each card's "submitted" line.
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

// Send-back modal: an optional note textarea, then POST /content/:id/return.
// On success the parent drops the card from the list.
function SendBackModal({
  item,
  token,
  onReturned,
  onClose,
}: {
  item: ReviewQueueItem;
  token: string;
  onReturned: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Send only a non-empty note; an empty box returns the draft with no note.
      const trimmed = note.trim();
      await returnContent(token, item.id, trimmed ? { note: trimmed } : {});
      onReturned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send back');
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
        aria-label="Send article back"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">Send back</span>
            <h2 style={{ margin: '2px 0 0' }}>{item.title}</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="rep-form">
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

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Sending back…' : 'Send back to draft'}
            </button>
          </div>

          {error && <div className="error rep-form-msg">{error}</div>}
        </form>
      </div>
    </div>
  );
}

// One review card: title + author, matchup/sport/date meta, submitted time, an
// expandable HTML body preview, and the two editorial actions. Both actions
// remove the card from the queue on success (via onDecided).
function ReviewCard({
  item,
  token,
  onDecided,
}: {
  item: ReviewQueueItem;
  token: string;
  onDecided: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showSendBack, setShowSendBack] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = [item.author, item.eventSport, matchup(item)].filter(Boolean);

  async function onPublish() {
    if (!window.confirm(`Approve and publish “${item.title}”?`)) return;
    setPublishing(true);
    setError(null);
    try {
      await publishContent(token, item.id);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <article className="card game review-card">
      <div className="applicant-head">
        <div>
          <span className="game-kicker">{item.eventSport ?? 'Feature'}</span>
          <h2 className="applicant-name">{item.title}</h2>
          <span className="applicant-meta muted">
            {meta.length > 0 ? meta.join(' · ') : 'Unassigned'}
          </span>
        </div>
        <span className="pill pill--review">Submitted</span>
      </div>

      <div className="review-facts">
        <span className="applicant-fact">
          <span className="applicant-fact__label">Author</span>
          {item.author ?? 'Unknown'}
        </span>
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

      {expanded ? (
        <div
          className="article-body review-body"
          dangerouslySetInnerHTML={{ __html: item.body ?? '' }}
        />
      ) : (
        <p className="muted review-collapsed">Preview hidden.</p>
      )}
      <button
        type="button"
        className="link-btn applicant-more"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Hide preview' : 'Read preview'}
      </button>

      <div className="applicant-actions">
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
          onClick={() => setShowSendBack(true)}
        >
          Send back
        </button>
      </div>

      {error && <div className="error rep-form-msg">{error}</div>}

      {showSendBack && (
        <SendBackModal
          item={item}
          token={token}
          onReturned={() => {
            setShowSendBack(false);
            onDecided();
          }}
          onClose={() => setShowSendBack(false)}
        />
      )}
    </article>
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
        <div className="applicant-list">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              token={token}
              onDecided={() => removeItem(item.id)}
            />
          ))}
        </div>
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
