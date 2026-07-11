'use client';

// The staff NIL review queue (/nil-review): submitted deliverables awaiting a
// decision. Cloned from the editorial /review pattern — a card per submission
// with the athlete's name, the value, and the proof; Approve (a confirm modal
// that RESTATES the money) or Send back (a note modal). Same gate as GET
// /nil/review-queue (admin + regional_manager).

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getNilReviewQueue,
  getNilPool,
  approveDeliverable,
  returnDeliverable,
  NilReviewItem,
  NilRelease,
} from '../api';

// Integer cents -> a USD string (12750 -> "$127.50").
const usdCents = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

// Fallback platform fee rate for the approve PREVIEW when the deliverable's pool
// fee rate isn't available (no institutionId, or the pool lookup failed). The
// real math always comes back in the approve response, so this only tunes the
// preview; 0.15 is the platform's standard rate.
const DEFAULT_FEE_RATE = 0.15;

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Approve modal: restates the money before releasing funds. gross = the
// deliverable's value; fee = value × the pool's rate; net = gross − fee. This is
// a PREVIEW (the exact amounts are stamped server-side and returned on approve);
// a 409 "Insufficient pool funds" is surfaced inline so staff can top up first.
function ApproveModal({
  item,
  token,
  feeRate,
  onApproved,
  onClose,
}: {
  item: NilReviewItem;
  token: string;
  feeRate: number;
  onApproved: (release: NilRelease) => void;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = item.valueCents;
  const fee = Math.round(gross * feeRate);
  const net = gross - fee;
  const who = item.athleteName ?? 'the athlete';

  async function onConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const { release } = await approveDeliverable(token, item.id);
      onApproved(release);
    } catch (err) {
      // 409 "Insufficient pool funds" (and any other failure) -> inline.
      setError(err instanceof Error ? err.message : 'Failed to approve');
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
        aria-label="Approve deliverable"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">Approve &amp; release</span>
            <h2 style={{ margin: '2px 0 0' }}>{item.title}</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="nil-restate">
          Release <strong>{usdCents(gross)}</strong> — {usdCents(fee)} platform
          fee, <strong>{usdCents(net)}</strong> to {who}?
        </p>

        <div className="nil-mathrow">
          <div className="nil-mathrow__cell">
            <span className="nil-mathrow__label">Gross</span>
            <span className="nil-mathrow__value">{usdCents(gross)}</span>
          </div>
          <div className="nil-mathrow__cell">
            <span className="nil-mathrow__label">Platform fee</span>
            <span className="nil-mathrow__value">−{usdCents(fee)}</span>
          </div>
          <div className="nil-mathrow__cell nil-mathrow__cell--net">
            <span className="nil-mathrow__label">Net to athlete</span>
            <span className="nil-mathrow__value">{usdCents(net)}</span>
          </div>
        </div>

        <p className="game-hint">
          Fee is computed at the pool&apos;s rate; the exact amounts are confirmed
          on approval and paid from the school&apos;s pool.
        </p>

        <div className="rep-form-actions">
          <button type="button" disabled={submitting} onClick={onConfirm}>
            {submitting ? 'Releasing…' : 'Approve & release funds'}
          </button>
        </div>

        {error && <div className="error rep-form-msg">{error}</div>}
      </div>
    </div>
  );
}

// Send-back modal: an optional note, then POST /nil/deliverables/:id/return. On
// success the parent drops the card from the queue.
function SendBackModal({
  item,
  token,
  onReturned,
  onClose,
}: {
  item: NilReviewItem;
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
      const trimmed = note.trim();
      await returnDeliverable(token, item.id, trimmed ? { note: trimmed } : {});
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
        aria-label="Send deliverable back"
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
            <label htmlFor="nil-return-note">Note to the athlete (optional)</label>
            <textarea
              id="nil-return-note"
              value={note}
              rows={5}
              placeholder="What needs another pass before this can be approved?"
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="muted sponsor-field-hint">
              Returns the deliverable to the athlete as an assignment. They&apos;ll
              see this note as an editor&apos;s note on their card.
            </span>
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Sending back…' : 'Send back to athlete'}
            </button>
          </div>

          {error && <div className="error rep-form-msg">{error}</div>}
        </form>
      </div>
    </div>
  );
}

// One review card: athlete name + title, the value, a proof link (opens in a new
// tab) + the athlete's note, and the two actions. Both actions remove the card on
// success (via onDecided); an approval also bubbles the release up for the banner.
function ReviewCard({
  item,
  token,
  feeRate,
  onApproved,
  onReturned,
}: {
  item: NilReviewItem;
  token: string;
  feeRate: number;
  onApproved: (release: NilRelease) => void;
  onReturned: () => void;
}) {
  const [showApprove, setShowApprove] = useState(false);
  const [showSendBack, setShowSendBack] = useState(false);

  return (
    <article className="card game nil-review-card">
      <div className="applicant-head">
        <div>
          <span className="game-kicker">NIL deliverable</span>
          <h2 className="applicant-name">{item.title}</h2>
          <span className="applicant-meta muted">
            {item.athleteName ?? 'Unknown athlete'}
          </span>
        </div>
        <span className="pill pill--review">Submitted</span>
      </div>

      <div className="review-facts">
        <span className="applicant-fact">
          <span className="applicant-fact__label">Athlete</span>
          {item.athleteName ?? 'Unknown'}
        </span>
        <span className="applicant-fact">
          <span className="applicant-fact__label">Value</span>
          {usdCents(item.valueCents)}
        </span>
        <span className="applicant-fact">
          <span className="applicant-fact__label">Submitted</span>
          {formatWhen(item.submittedAt)}
        </span>
      </div>

      {item.description && <p className="applicant-pitch">{item.description}</p>}

      <div className="nil-review-proof">
        {item.proofPublicUrl ? (
          <a
            href={item.proofPublicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="nil-proof__link"
          >
            View proof →
          </a>
        ) : (
          <span className="muted">No proof attached</span>
        )}
        {item.proofNote && (
          <p className="nil-card__desc" style={{ margin: '8px 0 0' }}>
            <span className="muted">Athlete&apos;s note: </span>
            {item.proofNote}
          </p>
        )}
      </div>

      <div className="applicant-actions">
        <button
          type="button"
          className="btn-inline"
          onClick={() => setShowApprove(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowSendBack(true)}
        >
          Send back
        </button>
      </div>

      {showApprove && (
        <ApproveModal
          item={item}
          token={token}
          feeRate={feeRate}
          onApproved={(release) => {
            setShowApprove(false);
            onApproved(release);
          }}
          onClose={() => setShowApprove(false)}
        />
      )}
      {showSendBack && (
        <SendBackModal
          item={item}
          token={token}
          onReturned={() => {
            setShowSendBack(false);
            onReturned();
          }}
          onClose={() => setShowSendBack(false)}
        />
      )}
    </article>
  );
}

export default function NilReviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [items, setItems] = useState<NilReviewItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // institutionId -> pool platform fee rate, for the approve preview. Best-effort;
  // a missing entry falls back to DEFAULT_FEE_RATE.
  const [feeRates, setFeeRates] = useState<Record<string, number>>({});
  // A brief banner after an approval, restating the real released net.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const queue = await getNilReviewQueue(t);
      setItems(queue);
      // Load each distinct school's pool once for its fee rate (best-effort).
      const ids = Array.from(
        new Set(
          queue
            .map((q) => q.institutionId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const pools = await Promise.all(
        ids.map((id) =>
          getNilPool(t, id)
            .then((p) => [id, p.platformFeeRate] as const)
            .catch(() => null),
        ),
      );
      const map: Record<string, number> = {};
      for (const entry of pools) if (entry) map[entry[0]] = entry[1];
      setFeeRates(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && allowed) load(token);
  }, [token, allowed, load]);

  function removeItem(id: string) {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
  }

  function feeRateFor(item: NilReviewItem): number {
    const id = item.institutionId;
    return (id && feeRates[id]) || DEFAULT_FEE_RATE;
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
        <span className="masthead-kicker">Name · Image · Likeness</span>
        <h1 className="masthead-title">NIL Review</h1>
        <p className="masthead-standfirst">
          Deliverables athletes have submitted for review. Check the proof, then
          approve to release funds from the school&apos;s pool, or send one back
          with a note.
        </p>
      </div>

      {notice && <div className="success">{notice}</div>}
      {loading && <div className="card muted">Loading review queue…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && items && items.length > 0 ? (
        <div className="applicant-list">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              token={token}
              feeRate={feeRateFor(item)}
              onApproved={(release) => {
                setNotice(
                  `Released ${usdCents(release.netCents)} to ${
                    item.athleteName ?? 'the athlete'
                  } (${usdCents(release.feeCents)} platform fee).`,
                );
                removeItem(item.id);
              }}
              onReturned={() => {
                setNotice(null);
                removeItem(item.id);
              }}
            />
          ))}
        </div>
      ) : (
        !loading &&
        !error && (
          <div className="results-empty">
            <p className="results-empty__title">No deliverables waiting for review</p>
            <p className="results-empty__hint">
              When an athlete submits an NIL deliverable, it lands here for you to
              approve or send back.
            </p>
          </div>
        )
      )}
    </main>
  );
}
