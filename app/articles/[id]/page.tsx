'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav } from '../../nav';
import {
  getContentItem,
  getPublishedContent,
  ContentItem,
  FeedItem,
} from '../../api';

// Full date + time for the byline (mirrors the feed reader / game page).
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---- Standalone article reader (/articles/[id]). The bare content row
// (getContentItem) is authoritative for the body + the published gate; the
// published-feed projection, matched by id, supplies the author display name and
// the event join (sport + matchup) the bare row doesn't carry. Both are existing
// reads — no new API. A missing row, a non-published status, or a caller who
// can't see it all resolve to the same branded "not found" (viewers must never
// see drafts/submitted). ----
export default function ArticlePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();

  const [item, setItem] = useState<ContentItem | null>(null);
  // The published-feed row matched by id: carries author + event join. Best-effort
  // enrichment, so the page still renders (kicker/byline omitted) if it's absent.
  const [feedItem, setFeedItem] = useState<FeedItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Separates a legitimately-missing/unpublished article from a hard load error.
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      try {
        // A 404/403 on the article itself is a "not found" (null), not a page
        // error; the feed enrichment degrades silently to [].
        const [content, feed] = await Promise.all([
          getContentItem(token, id).catch(() => null),
          getPublishedContent(token).catch(() => [] as FeedItem[]),
        ]);
        if (cancelled) return;
        // Missing, or anything other than published -> treat as not found so a
        // viewer can never reach a draft/submitted story by guessing a URL.
        if (!content || content.status !== 'published') {
          setNotFound(true);
          return;
        }
        setItem(content);
        setFeedItem(feed.find((f) => f.id === content.id) ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load article');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, id, router]);

  // Kicker: "sport · matchup" when the event join resolved, else a plain
  // "Coverage" so the page keeps its anchor rather than going headless.
  const kicker = useMemo(() => {
    if (!feedItem) return 'Coverage';
    const matchup =
      feedItem.homeTeam && feedItem.awayTeam
        ? `${feedItem.homeTeam} vs ${feedItem.awayTeam}`
        : null;
    return [feedItem.eventSport, matchup].filter(Boolean).join(' · ') || 'Coverage';
  }, [feedItem]);

  // Byline: name the author when we resolved one, always signed Sharp Foxx.
  const byline = feedItem?.author
    ? `By ${feedItem.author} · Sharp Foxx`
    : 'By Sharp Foxx';

  if (!token) return null;

  return (
    <main className="feed-home article-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <Link href="/feed" className="game-back">
        ← Back to feed
      </Link>

      {loading && <div className="card muted">Loading article…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && notFound && (
        <div className="results-empty">
          <p className="results-empty__title">Article not found</p>
          <p className="results-empty__hint">
            This story may have been unpublished or removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && item && (
        <article className="article-full">
          <span className="story-kicker">{kicker}</span>
          <h1 className="story-title article-full__title">{item.title}</h1>
          <div className="story-meta">
            <span className="story-meta__seg">{byline}</span>
            <span className="story-meta__seg">
              {formatWhen(item.publishedAt ?? item.createdAt)}
            </span>
          </div>
          {item.body && (
            <div
              className="article-body"
              dangerouslySetInnerHTML={{ __html: item.body }}
            />
          )}
          {item.eventId && (
            <Link href={`/games/${item.eventId}`} className="article-about">
              About this game →
            </Link>
          )}
        </article>
      )}
    </main>
  );
}
