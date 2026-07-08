'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { getPublishedContent, FeedItem } from '../api';

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

// One published article. Owns its own expanded state so opening one card never
// touches another. The body is a trusted HTML string authored through our own
// content pipeline, so we render it via dangerouslySetInnerHTML on expand.
function ArticleCard({ item }: { item: FeedItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <h2 style={{ marginBottom: 6 }}>{item.title}</h2>
        {item.eventSport && (
          <span className="pill">{item.eventSport}</span>
        )}
      </div>

      <span className="muted">
        {item.author} · {formatWhen(item.publishedAt)}
      </span>

      <div>
        <button
          className="link-btn"
          style={{ marginTop: 12 }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide article' : 'Read article'}
        </button>
      </div>

      {expanded && (
        <div
          style={{ marginTop: 14 }}
          dangerouslySetInnerHTML={{ __html: item.body }}
        />
      )}
    </section>
  );
}

export default function FeedPage() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  const [items, setItems] = useState<FeedItem[] | null>(null);
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
        const data = await getPublishedContent(token);
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load feed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  function onLogout() {
    logout();
    router.replace('/');
  }

  if (!token) return null;

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Feed</h1>
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

      {loading && <div className="card muted">Loading feed…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && items && items.length > 0 &&
        items.map((item) => <ArticleCard key={item.id} item={item} />)}

      {!loading && !error && items && items.length === 0 && (
        <div className="card muted">No published articles yet</div>
      )}
    </main>
  );
}
