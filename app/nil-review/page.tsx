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
import { AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import {
  getNilReviewQueue,
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
  onApproved,
  onReturned,
  close,
}: {
  item: NilReviewItem;
  token: string;
  onApproved: (release: NilRelease) => void;
  onReturned: () => void;
  close: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'confirm' | 'sendback'>('view');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = item.valueCents;
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
        {/* ---- ONE NUMBER, BECAUSE THERE IS ONLY ONE NUMBER NOW.
            This was a three-cell split -- gross, platform fee, net to athlete --
            previewing the 15% that came off the release. Sharp Foxx takes no
            part of the athlete's money, so gross IS net and a "fee: $0" row
            would be a permanent reminder of a deduction that no longer happens.
            See approveDeliverable in the API for why it went. ---- */}
        <p className="nil-restate">
          Release <strong>{usdCents(gross)}</strong> to {who}?
        </p>

        <div className="nil-mathrow">
          <div className="nil-mathrow__cell nil-mathrow__cell--net">
            <span className="nil-mathrow__label">To the athlete</span>
            <span className="nil-mathrow__value">{usdCents(gross)}</span>
          </div>
        </div>

        <p className="game-hint">
          Paid in full from the school&apos;s pool — Sharp Foxx takes no fee on
          an athlete&apos;s money. The exact amount is confirmed on approval.
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
      // A per-school pool fetch used to run here, purely to preview each pool's
      // platform fee rate. There is no fee to preview: an approval releases the
      // full value to the athlete. One request per school per queue load, gone.
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
      {/* ---- Same treatment as /nil, and here the standfirst goes ENTIRELY --
          both halves failed the test.

          "Deliverables athletes have submitted for review" described the table
          beneath it. Furniture.

          "Approve to release funds from the school's pool, or send one back
          with a note" looks like rules and is not: the approve modal already
          says "on approval and paid from the school's pool" and itemises
          Platform fee and Net to athlete, AT THE MOMENT OF APPROVING. A rule
          restated where it matters does not also need stating where it does
          not. That is the difference from /nil, where the flow sentence had no
          second home. ---- */}
      <div className="page-head">
        <h1 className="row-title page-head__title">NIL Review</h1>
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
              onApproved={(release) => {
                setNotice(
                  `Released ${usdCents(release.netCents)} to ${
                    athleteNameOf(i) ?? 'the athlete'
                  } in full.`,
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
