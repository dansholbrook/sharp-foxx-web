'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getApplications,
  getFieldReps,
  approveApplication,
  rejectApplication,
  Application,
  FieldRep,
} from '../api';

const TRACK_LABEL: Record<Application['track'], string> = {
  field_rep: 'Correspondent',
  regional_manager: 'Regional Manager',
};

const STATUS_TABS: Array<{ value: Application['status']; label: string }> = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

// Long pitches collapse to this many characters behind a "Read more" toggle.
const PITCH_CLAMP = 240;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

// Copy-to-clipboard affordance for the new sign-in id staff share with the
// applicant (dev-login era -- the id IS the credential).
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked -- the id is still visible to select manually */
    }
  }
  return (
    <button type="button" className="link-btn copy-id-btn" onClick={copy}>
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

// Approve modal: commission rate (default 0.10, shown as a %) + an optional
// manager dropdown (regional managers only; default "Assign to me" omits
// managerId so the approving manager auto-becomes the rep's manager). On success
// it surfaces the returned userId prominently with a copy button before closing.
function ApproveModal({
  application,
  managers,
  token,
  onApproved,
  onClose,
}: {
  application: Application;
  managers: FieldRep[];
  token: string;
  onApproved: () => void;
  onClose: () => void;
}) {
  const [rate, setRate] = useState('0.10');
  const [managerId, setManagerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one-time sign-in credentials returned on approval (null until approved).
  const [credentials, setCredentials] = useState<{
    userId: string;
    tempPassword: string;
  } | null>(null);

  const ratePct = Number.isNaN(Number(rate))
    ? null
    : `${(Number(rate) * 100).toFixed(0)}%`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(rate);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      setError('Commission rate must be a number between 0 and 1.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await approveApplication(token, application.id, {
        commissionRate: parsed,
        managerId: managerId || undefined,
      });
      setCredentials({ userId: result.userId, tempPassword: result.tempPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={credentials ? undefined : onClose}>
      <div
        className="modal-card card"
        role="dialog"
        aria-modal="true"
        aria-label="Approve application"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">Approve</span>
            <h2 style={{ margin: '2px 0 0' }}>{application.fullName}</h2>
          </div>
          {!credentials && (
            <button type="button" className="link-btn modal-close" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        {credentials ? (
          // ---- Success: the sign-in credentials, ready to hand off once. ----
          <div className="approve-done">
            <p className="approve-done__lead">
              Account created for <strong>{application.fullName}</strong>.
            </p>
            <div className="approve-creds">
              <div className="approve-id">
                <span className="approve-id__label">User ID</span>
                <div className="approve-id__row">
                  <code className="approve-id__value mono">{credentials.userId}</code>
                  <CopyId value={credentials.userId} />
                </div>
              </div>
              <div className="approve-id">
                <span className="approve-id__label">Temporary password</span>
                <div className="approve-id__row">
                  <code className="approve-id__value mono">
                    {credentials.tempPassword}
                  </code>
                  <CopyId value={credentials.tempPassword} />
                </div>
              </div>
            </div>
            <p className="muted approve-done__note">
              Share these sign-in credentials with the applicant — the password
              is shown only once.
            </p>
            <div className="rep-form-actions">
              <button type="button" onClick={onApproved}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="rep-form">
            <div className="field">
              <label htmlFor="rate">Commission rate</label>
              <input
                id="rate"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
              />
              <span className="muted sponsor-field-hint">
                {ratePct ? `${ratePct} of each sale` : 'Enter a value between 0 and 1'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="manager">Manager</label>
              <select
                id="manager"
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
              >
                <option value="">Assign to me</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ?? m.email ?? m.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="rep-form-actions">
              <button type="submit" disabled={submitting}>
                {submitting ? 'Approving…' : 'Approve applicant'}
              </button>
            </div>
            {error && <div className="error rep-form-msg">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

// One application card. Submitted cards carry Approve/Reject actions (Approve
// opens the modal; Reject confirms then POSTs). Approved cards show the reviewed
// date and the created sign-in id; rejected show the reviewed date.
function ApplicantCard({
  application,
  managers,
  token,
  onChanged,
}: {
  application: Application;
  managers: FieldRep[];
  token: string;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLong = application.pitch.length > PITCH_CLAMP;
  const pitchText =
    isLong && !expanded
      ? `${application.pitch.slice(0, PITCH_CLAMP).trimEnd()}…`
      : application.pitch;

  async function onReject() {
    if (!window.confirm(`Reject ${application.fullName}'s application?`)) return;
    setRejecting(true);
    setError(null);
    try {
      await rejectApplication(token, application.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject.');
    } finally {
      setRejecting(false);
    }
  }

  return (
    <article className="card game applicant-card">
      <div className="applicant-head">
        <div>
          <h2 className="applicant-name">{application.fullName}</h2>
          <span className="applicant-meta muted">
            {application.city}, {application.state} · {formatWhen(application.createdAt)}
          </span>
        </div>
        <span className={`pill track-pill track-pill--${application.track}`}>
          {TRACK_LABEL[application.track]}
        </span>
      </div>

      <div className="applicant-facts">
        <span className="applicant-fact">
          <span className="applicant-fact__label">Email</span>
          <span className="mono">{application.email}</span>
        </span>
        {application.phone && (
          <span className="applicant-fact">
            <span className="applicant-fact__label">Phone</span>
            {application.phone}
          </span>
        )}
        <span className="applicant-fact">
          <span className="applicant-fact__label">HD smartphone</span>
          {application.hasSmartphone ? 'Yes' : 'No'}
        </span>
        {application.resumeUrl && (
          <span className="applicant-fact">
            <span className="applicant-fact__label">Resume</span>
            <a
              href={application.resumeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="apply-signin-link"
            >
              View link ↗
            </a>
          </span>
        )}
      </div>

      <p className="applicant-pitch">{pitchText}</p>
      {isLong && (
        <button
          type="button"
          className="link-btn applicant-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      {application.status === 'submitted' && (
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
            onClick={onReject}
            disabled={rejecting}
          >
            {rejecting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      )}

      {application.status === 'approved' && (
        <div className="applicant-review">
          <span className="muted">
            Approved{application.reviewedAt ? ` · ${formatWhen(application.reviewedAt)}` : ''}
          </span>
          {application.createdUserId && (
            <div className="approve-id approve-id--inline">
              <span className="approve-id__label">Sign-in ID</span>
              <div className="approve-id__row">
                <code className="approve-id__value mono">
                  {application.createdUserId}
                </code>
                <CopyId value={application.createdUserId} />
              </div>
            </div>
          )}
        </div>
      )}

      {application.status === 'rejected' && (
        <div className="applicant-review">
          <span className="muted">
            Rejected{application.reviewedAt ? ` · ${formatWhen(application.reviewedAt)}` : ''}
          </span>
        </div>
      )}

      {error && <div className="error rep-form-msg">{error}</div>}

      {showApprove && (
        <ApproveModal
          application={application}
          managers={managers}
          token={token}
          onApproved={() => {
            setShowApprove(false);
            onChanged();
          }}
          onClose={() => setShowApprove(false)}
        />
      )}
    </article>
  );
}

export default function ApplicantsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [status, setStatus] = useState<Application['status']>('submitted');
  const [apps, setApps] = useState<Application[] | null>(null);
  const [managers, setManagers] = useState<FieldRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const load = useCallback(
    async (t: string, s: Application['status']) => {
      setLoading(true);
      setError(null);
      try {
        setApps(await getApplications(t, s));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load applications');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Skip the fetch for a role that can't use this page -- it would only 403.
    if (token && allowed) load(token, status);
  }, [token, allowed, status, load]);

  // Regional managers for the approve modal's dropdown. Best-effort: a failure
  // just leaves the dropdown at "Assign to me".
  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const reps = await getFieldReps(token);
        if (!cancelled) {
          setManagers(reps.filter((r) => r.kind === 'regional_manager'));
        }
      } catch {
        /* leave managers empty -- "Assign to me" still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, allowed]);

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
        <span className="masthead-kicker">Review queue</span>
        <h1 className="masthead-title">Applicants</h1>
        <p className="masthead-standfirst">
          Review who&apos;s applied to the network. Approve to stand up their
          account, or reject — the queue defaults to new submissions.
        </p>
      </div>

      <div className="applicant-chips">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`chip${status === tab.value ? ' chip--on' : ''}`}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <div className="card muted">Loading applications…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && apps && apps.length > 0 ? (
        <div className="applicant-list">
          {apps.map((app) => (
            <ApplicantCard
              key={app.id}
              application={app}
              managers={managers}
              token={token}
              onChanged={() => load(token, status)}
            />
          ))}
        </div>
      ) : (
        !loading &&
        !error && (
          <div className="results-empty">
            <p className="results-empty__title">
              No {status} applications
            </p>
            <p className="results-empty__hint">
              {status === 'submitted'
                ? 'New applications from the public apply page will show up here.'
                : `Applications you ${status === 'approved' ? 'approve' : 'reject'} will appear here.`}
            </p>
          </div>
        )
      )}
    </main>
  );
}
