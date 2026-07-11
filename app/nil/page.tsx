'use client';

// The athlete's home (/nil): "My NIL". Two sections — My Assignments (deliverable
// cards the athlete works and submits proof for) and My Wallet (total net earned
// + the release ledger). Athletes are NOT reps: no My Games / My Sales. The proof
// upload reuses the game-photos presign -> PUT -> confirm chain, here with a real
// progress bar (XHR) and the nil_proof purpose.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getMyDeliverables,
  getMyWallet,
  presignNilProof,
  uploadToPresignedUrlWithProgress,
  confirmMedia,
  submitDeliverable,
  NilDeliverable,
  NilWallet,
} from '../api';

// Integer cents -> a USD string (12750 -> "$127.50"). Money stays in cents until
// this render boundary; never do math on the formatted string.
const usdCents = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

// Readable date for a timestamptz ISO string; '—' when absent, raw on a parse miss.
function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Client-side proof guards, mirrored on the backend: images, video/mp4, or pdf,
// <=50MB. We reject a bad file BEFORE presigning so the athlete gets an instant,
// clear message instead of a round-trip 400.
const PROOF_MAX_BYTES = 50 * 1024 * 1024;
const PROOF_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'application/pdf',
];

// A confirmed proof held locally on an assigned card, between confirm and submit.
type ConfirmedProof = { mediaId: string; publicUrl: string; fileName: string };

// The proof uploader on an assigned card: a file picker that runs the picked file
// through presign -> PUT (with a real progress bar) -> confirm, then hands the
// confirmed { mediaId, publicUrl } up so the card can enable Submit. A failed or
// invalid file surfaces inline with a Retry.
function ProofUploader({
  token,
  proof,
  onConfirmed,
  onClear,
  disabled,
}: {
  token: string;
  proof: ConfirmedProof | null;
  onConfirmed: (proof: ConfirmedProof) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function runUpload(file: File) {
    setPhase('uploading');
    setProgress(0);
    setError(null);
    try {
      const { uploadUrl, publicUrl, mediaId } = await presignNilProof(token, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await uploadToPresignedUrlWithProgress(uploadUrl, file, file.type, setProgress);
      await confirmMedia(token, mediaId);
      setPhase('idle');
      onConfirmed({ mediaId, publicUrl, fileName: file.name });
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    // Reset the input so re-picking the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!PROOF_TYPES.includes(file.type)) {
      setPhase('failed');
      setError('Use an image, an MP4 video, or a PDF.');
      return;
    }
    if (file.size > PROOF_MAX_BYTES) {
      setPhase('failed');
      setError('Too large — max 50MB.');
      return;
    }
    void runUpload(file);
  }

  // Confirmed: show the attached proof with a Replace/Remove affordance.
  if (proof) {
    return (
      <div className="nil-proof">
        <span className="nil-proof__label">Proof attached</span>
        <div className="nil-proof__attached">
          <a
            href={proof.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="nil-proof__link"
          >
            {proof.fileName}
          </a>
          {!disabled && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                onClear();
                setPhase('idle');
                setError(null);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="nil-proof">
      <span className="nil-proof__label">Proof</span>
      {phase === 'uploading' ? (
        <div className="nil-progress" aria-live="polite">
          <div className="nil-progress__track">
            <div
              className="nil-progress__bar"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="nil-progress__pct">{progress}%</span>
        </div>
      ) : (
        <>
          <label className="photos-pick nil-proof__pick">
            {phase === 'failed' ? 'Try another file' : 'Upload proof'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,application/pdf"
              className="photos-file-input"
              disabled={disabled}
              onChange={(e) => onPick(e.target.files)}
            />
          </label>
          <span className="game-hint nil-proof__hint">
            Image, MP4 video, or PDF · up to 50MB
          </span>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// One deliverable, rendered by status:
//  - assigned:  title/description/value, a proof uploader + optional note + Submit
//               (disabled until a proof is confirmed). A reviewNote (sent back)
//               shows as a gold editor's-note callout.
//  - submitted: a locked card with an "Awaiting review" pill + a proof link.
//  - approved:  a green-accent card showing the release math.
function DeliverableCard({
  deliverable,
  token,
  onUpdated,
}: {
  deliverable: NilDeliverable;
  token: string;
  onUpdated: (updated: NilDeliverable) => void;
}) {
  const [proof, setProof] = useState<ConfirmedProof | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!proof) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = note.trim();
      const updated = await submitDeliverable(token, deliverable.id, {
        proofMediaId: proof.mediaId,
        ...(trimmed ? { proofNote: trimmed } : {}),
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Approved: the payout card ----
  if (deliverable.status === 'approved' && deliverable.release) {
    const { grossCents, feeCents, netCents, releasedAt } = deliverable.release;
    return (
      <article className="card game nil-card nil-card--approved">
        <div className="nil-card__head">
          <div>
            <span className="game-kicker">Approved</span>
            <h3 className="nil-card__title">{deliverable.title}</h3>
          </div>
          <span className="pill nil-pill--approved">Approved</span>
        </div>
        {deliverable.description && (
          <p className="nil-card__desc">{deliverable.description}</p>
        )}
        <div className="nil-earned">
          <span className="nil-earned__label">You earned</span>
          <span className="nil-earned__value">{usdCents(netCents)}</span>
          <span className="nil-earned__sub">
            after a {usdCents(feeCents)} platform fee on {usdCents(grossCents)}
          </span>
        </div>
        <p className="game-hint" style={{ marginTop: 0 }}>
          Released {formatWhen(releasedAt)}
        </p>
      </article>
    );
  }

  // ---- Submitted: locked, awaiting review ----
  if (deliverable.status === 'submitted') {
    return (
      <article className="card game nil-card nil-card--locked">
        <div className="nil-card__head">
          <div>
            <span className="game-kicker">In review</span>
            <h3 className="nil-card__title">{deliverable.title}</h3>
          </div>
          <span className="pill pill--review">Awaiting review</span>
        </div>
        {deliverable.description && (
          <p className="nil-card__desc">{deliverable.description}</p>
        )}
        <div className="nil-card__value">{usdCents(deliverable.valueCents)}</div>
        <div className="nil-submitted-meta">
          {deliverable.proofPublicUrl && (
            <a
              href={deliverable.proofPublicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="nil-proof__link"
            >
              View submitted proof →
            </a>
          )}
          <span className="game-hint" style={{ margin: 0 }}>
            Submitted {formatWhen(deliverable.submittedAt)} — an editor will review
            it and release your funds.
          </span>
        </div>
        {deliverable.proofNote && (
          <p className="nil-card__desc" style={{ marginTop: 12 }}>
            <span className="muted">Your note: </span>
            {deliverable.proofNote}
          </p>
        )}
      </article>
    );
  }

  // ---- Assigned: work + submit ----
  return (
    <article className="card game nil-card">
      <div className="nil-card__head">
        <div>
          <span className="game-kicker">Assignment</span>
          <h3 className="nil-card__title">{deliverable.title}</h3>
        </div>
        <span className="pill">Assigned</span>
      </div>
      {deliverable.description && (
        <p className="nil-card__desc">{deliverable.description}</p>
      )}
      <div className="nil-card__value">{usdCents(deliverable.valueCents)}</div>

      {/* Send-back feedback: a staffer's note when they returned this deliverable. */}
      {deliverable.reviewNote && (
        <div className="editor-note">
          <span className="editor-note__label">Editor&apos;s note</span>
          <p className="editor-note__body">{deliverable.reviewNote}</p>
        </div>
      )}

      <ProofUploader
        token={token}
        proof={proof}
        onConfirmed={setProof}
        onClear={() => setProof(null)}
        disabled={submitting}
      />

      <div className="nil-note-field">
        <label htmlFor={`note-${deliverable.id}`}>Note (optional)</label>
        <textarea
          id={`note-${deliverable.id}`}
          value={note}
          rows={3}
          placeholder="Add context for the reviewer…"
          disabled={submitting}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="nil-card__actions">
        <button
          type="button"
          className="btn-inline"
          disabled={submitting || !proof}
          onClick={onSubmit}
        >
          {submitting ? 'Submitting…' : 'Submit for review'}
        </button>
        {!proof && (
          <span className="game-hint" style={{ margin: 0 }}>
            Attach a proof upload first.
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </article>
  );
}

// Status order for the assignments board: work first, then in-flight, then done.
const STATUS_ORDER: Record<NilDeliverable['status'], number> = {
  assigned: 0,
  submitted: 1,
  approved: 2,
};

export default function NilPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [deliverables, setDeliverables] = useState<NilDeliverable[] | null>(null);
  const [delivError, setDelivError] = useState<string | null>(null);
  const [delivLoading, setDelivLoading] = useState(true);

  const [wallet, setWallet] = useState<NilWallet | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  // No token in memory (e.g. after a refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const loadDeliverables = useCallback(async (t: string) => {
    setDelivLoading(true);
    setDelivError(null);
    try {
      setDeliverables(await getMyDeliverables(t));
    } catch (err) {
      setDelivError(
        err instanceof Error ? err.message : 'Failed to load assignments',
      );
    } finally {
      setDelivLoading(false);
    }
  }, []);

  const loadWallet = useCallback(async (t: string) => {
    setWalletLoading(true);
    setWalletError(null);
    try {
      setWallet(await getMyWallet(t));
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Failed to load wallet');
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && allowed) {
      loadDeliverables(token);
      loadWallet(token);
    }
  }, [token, allowed, loadDeliverables, loadWallet]);

  // Merge an updated deliverable back into the list in place (after a submit) and
  // refresh the wallet — an approval elsewhere could have landed a release, but a
  // submit at least keeps the board honest without a full reload.
  function applyUpdate(updated: NilDeliverable) {
    setDeliverables((prev) =>
      prev ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev,
    );
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const sorted = deliverables
    ? [...deliverables].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      )
    : null;

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
        <h1 className="masthead-title">My NIL</h1>
        <p className="masthead-standfirst">
          Your NIL deliverables and the money they earn. Submit proof for each
          assignment; once an editor approves it, your release lands in your
          wallet below.
        </p>
      </div>

      {/* ---- (a) My Assignments ---- */}
      <section className="card game">
        <span className="game-kicker">Deliverables</span>
        <h2>My Assignments</h2>
        {delivLoading && <p className="muted">Loading assignments…</p>}
        {delivError && <div className="error">{delivError}</div>}
        {!delivLoading && !delivError && sorted && sorted.length > 0 ? (
          <div className="nil-list">
            {sorted.map((d) => (
              <DeliverableCard
                key={d.id}
                deliverable={d}
                token={token}
                onUpdated={(updated) => {
                  applyUpdate(updated);
                  // A submit changes nothing in the wallet yet, but reloading it
                  // is cheap and keeps an approval that landed meanwhile visible.
                  loadWallet(token);
                }}
              />
            ))}
          </div>
        ) : (
          !delivLoading &&
          !delivError && (
            <div className="results-empty">
              <p className="results-empty__title">No assignments yet</p>
              <p className="results-empty__hint">
                When your school assigns you an NIL deliverable, it will show up
                here for you to complete and submit.
              </p>
            </div>
          )
        )}
      </section>

      {/* ---- (b) My Wallet ---- */}
      <section className="card game">
        <span className="game-kicker">Earnings</span>
        <h2>My Wallet</h2>
        {walletLoading && <p className="muted">Loading wallet…</p>}
        {walletError && <div className="error">{walletError}</div>}
        {!walletLoading && !walletError && wallet && (
          <>
            <div className="nil-wallet">
              <span className="nil-wallet__label">Total earned</span>
              <span className="nil-wallet__total">
                {usdCents(wallet.totalNetCents)}
              </span>
              {wallet.ledgerOnly && (
                <span className="nil-wallet__caption">
                  Ledger only — payouts processed separately.
                </span>
              )}
            </div>

            {wallet.releases.length > 0 ? (
              <table className="report-table nil-ledger">
                <thead>
                  <tr>
                    <th>Deliverable</th>
                    <th className="num">Gross</th>
                    <th className="num">Fee</th>
                    <th className="num">Net</th>
                    <th>Released</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.releases.map((r, i) => (
                    <tr key={r.id ?? r.deliverableId ?? i}>
                      <td>{r.title ?? 'NIL deliverable'}</td>
                      <td className="num">{usdCents(r.grossCents)}</td>
                      <td className="num">{usdCents(r.feeCents)}</td>
                      <td className="num total">{usdCents(r.netCents)}</td>
                      <td>{formatWhen(r.releasedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="results-empty">
                <p className="results-empty__title">No releases yet</p>
                <p className="results-empty__hint">
                  Submit an assignment and, once an editor approves it, the money
                  you earn will show up here.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
