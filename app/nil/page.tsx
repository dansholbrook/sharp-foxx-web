'use client';

// The athlete's home (/nil): "My NIL". Two sections — My Assignments (deliverable
// cards the athlete works and submits proof for) and My Wallet (total net earned
// + the release ledger). Athletes are NOT reps: no My Games / My Sales. The proof
// upload reuses the game-photos presign -> PUT -> confirm chain, here with a real
// progress bar (XHR) and the nil_proof purpose.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import {
  getMyDeliverables,
  getMyWallet,
  getMyAthleteId,
  presignNilProof,
  uploadToPresignedUrlWithProgress,
  confirmMedia,
  submitDeliverable,
  setDeliverablePublicity,
  etDateTime,
  NilDeliverable,
  NilWallet,
  NilWalletRelease,
} from '../api';

// Integer cents -> a USD string (12750 -> "$127.50"). Money stays in cents until
// this render boundary; never do math on the formatted string.
const usdCents = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

// Readable ET date for a timestamptz ISO string; '—' when absent, raw on a
// parse miss.
function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return etDateTime(iso) || iso;
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

// An assigned deliverable — the athlete's working area (this is the ONLY status
// rendered as a card now; submitted items live in the "In review" table and
// approved ones in the wallet). Title/description/value, a proof uploader +
// optional note + Submit (disabled until a proof is confirmed). A reviewNote
// (sent back) shows as a gold editor's-note callout.
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
  const [showOnProfile, setShowOnProfile] = useState(false);
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
        showOnProfile,
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
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

      {/* B+ publicity opt-in: carried on submit, applied once the deliverable is
          approved (the reel only shows approved + opted-in items). */}
      <label className="nil-publicity-check">
        <input
          type="checkbox"
          checked={showOnProfile}
          disabled={submitting}
          onChange={(e) => setShowOnProfile(e.target.checked)}
        />
        <span>Show this on my public profile once approved</span>
      </label>

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

// The publicity toggle shown in the wallet release slide-over for an approved
// deliverable: flips show_on_profile with an optimistic update (the parent's
// applyUpdate reflects it instantly), reverting + surfacing an error if the PATCH
// fails. "Shown on profile ✓" when public, "Hidden" otherwise.
function PublicityToggle({
  token,
  deliverable,
  onUpdated,
}: {
  token: string;
  deliverable: NilDeliverable;
  onUpdated: (updated: NilDeliverable) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = deliverable.showOnProfile;

  async function toggle() {
    const next = !shown;
    setSaving(true);
    setError(null);
    // Optimistic: reflect the new state immediately, revert on failure.
    onUpdated({ ...deliverable, showOnProfile: next });
    try {
      const updated = await setDeliverablePublicity(token, deliverable.id, next);
      onUpdated(updated);
    } catch (err) {
      onUpdated({ ...deliverable, showOnProfile: shown });
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="nil-publicity">
      <div className="nil-publicity__text">
        <span className="nil-publicity__label">Public profile</span>
        <span className="muted nil-publicity__hint">
          {shown
            ? 'Fans can see this deliverable on your profile reel.'
            : 'Hidden from your public profile.'}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        className={
          shown ? 'nil-toggle nil-toggle--on' : 'nil-toggle'
        }
        disabled={saving}
        onClick={toggle}
      >
        {shown ? 'Shown on profile ✓' : 'Hidden'}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// The wallet release table columns: gross/fee/net right-aligned money, released
// date last. Defined at module level since it never closes over page state.
const RELEASE_COLUMNS: Column<NilWalletRelease>[] = [
  { key: 'title', header: 'Deliverable', cell: (r) => r.title ?? 'NIL deliverable' },
  { key: 'gross', header: 'Gross', align: 'right', cell: (r) => usdCents(r.grossCents) },
  { key: 'fee', header: 'Fee', align: 'right', cell: (r) => usdCents(r.feeCents) },
  { key: 'net', header: 'Net', align: 'right', cell: (r) => usdCents(r.netCents) },
  { key: 'released', header: 'Released', cell: (r) => formatWhen(r.releasedAt) },
];

// The "In review" table columns: title, value (right-aligned), submitted date.
const SUBMITTED_COLUMNS: Column<NilDeliverable>[] = [
  { key: 'title', header: 'Title', cell: (d) => d.title },
  { key: 'value', header: 'Value', align: 'right', cell: (d) => usdCents(d.valueCents) },
  { key: 'submitted', header: 'Submitted', cell: (d) => formatWhen(d.submittedAt) },
];

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

  // The caller's own athlete id, so they can jump to their public profile. Best-
  // effort; a failure just hides the link.
  const [myAthleteId, setMyAthleteId] = useState<string | null>(null);

  // No token in memory (e.g. after a refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  // Resolve the athlete's own id once, for the "View my public profile" link.
  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    getMyAthleteId(token)
      .then((r) => {
        if (!cancelled) setMyAthleteId(r.athleteId);
      })
      .catch(() => {
        /* no athlete row / failure — leave the profile link hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [token, allowed]);

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

  // Split the board by actionability. Assigned (incl. sent-back) are the working
  // cards; submitted go to the compact "In review" table; approved are NOT shown
  // as cards — they live only in the wallet release table below.
  const assigned = deliverables?.filter((d) => d.status === 'assigned') ?? [];
  const submitted = deliverables?.filter((d) => d.status === 'submitted') ?? [];
  const hasAssignments = assigned.length > 0 || submitted.length > 0;
  // A wallet release only carries the money + title; the full deliverable (with
  // description, proof, notes) is joined in by id for the release slide-over.
  const deliverablesById = new Map(
    (deliverables ?? []).map((d) => [d.id, d] as const),
  );

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
          The money your NIL deliverables have earned, and the assignments still
          on your plate. Submit proof for each one; once an editor approves it,
          the release lands in your wallet.
        </p>
        {myAthleteId && (
          <Link href={`/athletes/${myAthleteId}`} className="nil-profile-link">
            View my public profile →
          </Link>
        )}
      </div>

      {/* ---- (a) My Wallet — the money first ---- */}
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
              <QueueTable
                columns={RELEASE_COLUMNS}
                rows={wallet.releases}
                rowKey={(r) => r.id ?? r.deliverableId ?? r.releasedAt}
                ariaLabel="Your release history"
                renderDetail={(r, close) => {
                  // Enrich the release with its full deliverable (description,
                  // proof, notes) when we can join it by id.
                  const d = r.deliverableId
                    ? deliverablesById.get(r.deliverableId)
                    : undefined;
                  return (
                    <SlideOver
                      onClose={close}
                      kicker="Release"
                      title={r.title ?? d?.title ?? 'NIL deliverable'}
                      label="Release detail"
                      footer={
                        <span className="muted">
                          Released {formatWhen(r.releasedAt)}
                        </span>
                      }
                    >
                      {d?.description && (
                        <p className="applicant-pitch">{d.description}</p>
                      )}

                      <div className="nil-mathrow">
                        <div className="nil-mathrow__cell">
                          <span className="nil-mathrow__label">Gross</span>
                          <span className="nil-mathrow__value">
                            {usdCents(r.grossCents)}
                          </span>
                        </div>
                        <div className="nil-mathrow__cell">
                          <span className="nil-mathrow__label">Platform fee</span>
                          <span className="nil-mathrow__value">
                            −{usdCents(r.feeCents)}
                          </span>
                        </div>
                        <div className="nil-mathrow__cell nil-mathrow__cell--net">
                          <span className="nil-mathrow__label">Net to you</span>
                          <span className="nil-mathrow__value">
                            {usdCents(r.netCents)}
                          </span>
                        </div>
                      </div>

                      <div className="review-facts">
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Released</span>
                          {formatWhen(r.releasedAt)}
                        </span>
                        {d?.submittedAt && (
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Submitted</span>
                            {formatWhen(d.submittedAt)}
                          </span>
                        )}
                        {d && (
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Assigned</span>
                            {formatWhen(d.createdAt)}
                          </span>
                        )}
                      </div>

                      {d?.proofPublicUrl && (
                        <a
                          href={d.proofPublicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="nil-proof__link"
                        >
                          View submitted proof →
                        </a>
                      )}
                      {d?.proofNote && (
                        <p className="nil-card__desc" style={{ marginTop: 12 }}>
                          <span className="muted">Your note: </span>
                          {d.proofNote}
                        </p>
                      )}

                      {/* Publicity control for the approved deliverable behind
                          this release. Only shown when we can join the full
                          deliverable (it carries show_on_profile). */}
                      {d && (
                        <PublicityToggle
                          token={token}
                          deliverable={d}
                          onUpdated={applyUpdate}
                        />
                      )}
                    </SlideOver>
                  );
                }}
              />
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

      {/* ---- (b) My Assignments — by actionability ---- */}
      <section className="card game">
        <span className="game-kicker">Deliverables</span>
        <h2>My Assignments</h2>
        {delivLoading && <p className="muted">Loading assignments…</p>}
        {delivError && <div className="error">{delivError}</div>}
        {!delivLoading && !delivError && deliverables && (
          <>
            {/* Needs your attention: assigned + sent-back working cards. */}
            {assigned.length > 0 && (
              <div className="nil-group">
                <span className="game-kicker nil-group__label">
                  Needs your attention
                </span>
                <div className="nil-list">
                  {assigned.map((d) => (
                    <DeliverableCard
                      key={d.id}
                      deliverable={d}
                      token={token}
                      onUpdated={(updated) => {
                        applyUpdate(updated);
                        // A submit changes nothing in the wallet yet, but
                        // reloading it is cheap and keeps an approval that
                        // landed meanwhile visible.
                        loadWallet(token);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* In review: submitted, read-only compact rows. */}
            {submitted.length > 0 && (
              <div className="nil-group">
                <span className="game-kicker nil-group__label">In review</span>
                <QueueTable
                  columns={SUBMITTED_COLUMNS}
                  rows={submitted}
                  rowKey={(d) => d.id}
                  ariaLabel="Deliverables in review"
                  renderDetail={(d, close) => (
                    <SlideOver
                      onClose={close}
                      kicker="In review"
                      title={d.title}
                      label="Submitted deliverable"
                      footer={
                        <span className="muted">
                          Submitted {formatWhen(d.submittedAt)} — awaiting an
                          editor&apos;s review.
                        </span>
                      }
                    >
                      <div className="review-facts">
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Value</span>
                          {usdCents(d.valueCents)}
                        </span>
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Submitted</span>
                          {formatWhen(d.submittedAt)}
                        </span>
                      </div>

                      {d.description && (
                        <p className="applicant-pitch">{d.description}</p>
                      )}

                      {d.proofPublicUrl ? (
                        <a
                          href={d.proofPublicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="nil-proof__link"
                        >
                          View submitted proof →
                        </a>
                      ) : (
                        <span className="muted">No proof attached</span>
                      )}
                      {d.proofNote && (
                        <p className="nil-card__desc" style={{ marginTop: 12 }}>
                          <span className="muted">Your note: </span>
                          {d.proofNote}
                        </p>
                      )}
                    </SlideOver>
                  )}
                />
              </div>
            )}

            {!hasAssignments && (
              <div className="results-empty">
                <p className="results-empty__title">No assignments yet</p>
                <p className="results-empty__hint">
                  When your school assigns you an NIL deliverable, it will show up
                  here for you to complete and submit.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
