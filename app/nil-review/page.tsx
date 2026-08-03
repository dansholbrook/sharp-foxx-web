'use client';

// The staff NIL review queue (/nil-review): submitted deliverables awaiting a
// decision. A branded table (row per submission: athlete, deliverable, value,
// submitted) whose rows open a right-side slide-over. Approve restates the money
// INSIDE the panel (a fee-math confirm step) before releasing funds; Send back
// takes an inline note. Same gate as GET /nil/review-queue (admin +
// regional_manager).

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import {
  getNilReviewQueue,
  getNilPool,
  approveDeliverable,
  returnDeliverable,
  etDateTime,
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
  return etDateTime(iso) || iso;
}

// Compose the athlete's display name from the review-queue's first/last fields;
// null when both are missing (callers fall back to "Unknown"/"the athlete").
function athleteNameOf(item: NilReviewItem): string | null {
  const name = [item.athleteFirstName, item.athleteLastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || null;
}

// The slide-over for one deliverable. 'view' shows the description, value, and
// proof, with Approve / Send back. 'confirm' restates the money (gross / −fee /
// net) before releasing; a 409 "Insufficient pool funds" surfaces inline.
// 'sendback' swaps in an inline note textarea. Both decisions remove the item on
// success; an approval also bubbles the release up for the banner.
function NilReviewDetail({
  item,
  token,
  feeRate,
  onApproved,
  onReturned,
  close,
}: {
  item: NilReviewItem;
  token: string;
  feeRate: number;
  onApproved: (release: NilRelease) => void;
  onReturned: () => void;
  close: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'confirm' | 'sendback'>('view');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = item.valueCents;
  const fee = Math.round(gross * feeRate);
  const net = gross - fee;
  const who = athleteNameOf(item) ?? 'the athlete';

  async function onApprove() {
    setSubmitting(true);
    setError(null);
    try {
      const { release } = await approveDeliverable(token, item.id);
      onApproved(release);
      close();
    } catch (err) {
      // 409 "Insufficient pool funds" (and any other failure) -> inline.
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSendBack(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await returnDeliverable(token, item.id, trimmed ? { note: trimmed } : {});
      onReturned();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send back');
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Body per mode ----
  let body: React.ReactNode;
  if (mode === 'confirm') {
    body = (
      <>
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

        {error && <div className="error rep-form-msg">{error}</div>}
      </>
    );
  } else if (mode === 'sendback') {
    body = (
      <form id="nil-sendback-form" onSubmit={onSendBack} className="rep-form">
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
        {error && <div className="error rep-form-msg">{error}</div>}
      </form>
    );
  } else {
    // 'view'
    body = (
      <>
        <div className="review-facts">
          <span className="applicant-fact">
            <span className="applicant-fact__label">Athlete</span>
            <Link
              href={`/athletes/${item.athleteId}`}
              className="review-athlete-link"
            >
              {athleteNameOf(item) ?? 'Unknown'} →
            </Link>
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
      </>
    );
  }

  // ---- Footer per mode ----
  let footer: React.ReactNode;
  if (mode === 'confirm') {
    footer = (
      <>
        <button type="button" disabled={submitting} onClick={onApprove}>
          {submitting ? 'Releasing…' : 'Approve & release funds'}
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
    );
  } else if (mode === 'sendback') {
    footer = (
      <>
        <button type="submit" form="nil-sendback-form" disabled={submitting}>
          {submitting ? 'Sending back…' : 'Send back to athlete'}
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
    );
  } else {
    footer = (
      <>
        <button
          type="button"
          className="btn-inline"
          onClick={() => {
            setError(null);
            setMode('confirm');
          }}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setError(null);
            setMode('sendback');
          }}
        >
          Send back
        </button>
      </>
    );
  }

  return (
    <SlideOver
      onClose={close}
      kicker={
        mode === 'confirm'
          ? 'Approve & release'
          : mode === 'sendback'
            ? 'Send back'
            : 'NIL deliverable'
      }
      title={item.title}
      footer={footer}
      label="NIL deliverable review"
    >
      {body}
    </SlideOver>
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

  const columns: Column<NilReviewItem>[] = [
    {
      key: 'athlete',
      header: 'Athlete',
      cell: (i) => athleteNameOf(i) ?? 'Unknown',
    },
    { key: 'title', header: 'Deliverable', cell: (i) => i.title },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      cell: (i) => usdCents(i.valueCents),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      cell: (i) => formatWhen(i.submittedAt),
    },
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
        <QueueTable
          columns={columns}
          rows={items}
          rowKey={(i) => i.id}
          ariaLabel="Deliverables awaiting review"
          renderDetail={(i, close) => (
            <NilReviewDetail
              item={i}
              token={token}
              feeRate={feeRateFor(i)}
              onApproved={(release) => {
                setNotice(
                  `Released ${usdCents(release.netCents)} to ${
                    athleteNameOf(i) ?? 'the athlete'
                  } (${usdCents(release.feeCents)} platform fee).`,
                );
                removeItem(i.id);
              }}
              onReturned={() => {
                setNotice(null);
                removeItem(i.id);
              }}
              close={close}
            />
          )}
        />
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
