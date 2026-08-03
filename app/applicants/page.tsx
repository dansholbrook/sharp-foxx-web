'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import {
  getApplications,
  getFieldReps,
  approveApplication,
  rejectApplication,
  etDateTime,
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

function formatWhen(iso: string): string {
  return (
    etDateTime(iso, { year: 'numeric', month: 'short', day: 'numeric' }) || iso
  );
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

// The full application, shown in the slide-over body: pitch prominent, then the
// facts and (when present) the resume link.
function ApplicationBody({ application }: { application: Application }) {
  return (
    <>
      <p className="applicant-pitch">{application.pitch}</p>

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
          <span className="applicant-fact__label">Location</span>
          {application.city}, {application.state}
        </span>
        <span className="applicant-fact">
          <span className="applicant-fact__label">HD smartphone</span>
          {application.hasSmartphone ? 'Yes' : 'No'}
        </span>
        <span className="applicant-fact">
          <span className="applicant-fact__label">Applied</span>
          {formatWhen(application.createdAt)}
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
    </>
  );
}

// The slide-over for one application. A submitted application walks through
// three modes in place: 'view' (details + Approve/Reject) -> 'approve' (rate +
// manager form) -> 'done' (the created sign-in credentials). Approved/rejected
// applications just show the reviewed date (and the sign-in id, if approved).
function ApplicantDetail({
  application,
  managers,
  token,
  onChanged,
  close,
}: {
  application: Application;
  managers: FieldRep[];
  token: string;
  onChanged: () => void;
  close: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'approve' | 'done'>('view');
  const [rate, setRate] = useState('0.10');
  const [managerId, setManagerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one-time sign-in credentials returned on approval (set in 'done' mode).
  const [credentials, setCredentials] = useState<{
    userId: string;
    tempPassword: string;
  } | null>(null);

  const ratePct = Number.isNaN(Number(rate))
    ? null
    : `${(Number(rate) * 100).toFixed(0)}%`;

  async function onApprove(e: React.FormEvent) {
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
      setMode('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onReject() {
    if (!window.confirm(`Reject ${application.fullName}'s application?`)) return;
    setRejecting(true);
    setError(null);
    try {
      await rejectApplication(token, application.id);
      onChanged();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject.');
    } finally {
      setRejecting(false);
    }
  }

  // ---- Body per mode ----
  let body: React.ReactNode;
  if (mode === 'done' && credentials) {
    body = (
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
          Share these sign-in credentials with the applicant — the password is
          shown only once.
        </p>
      </div>
    );
  } else if (mode === 'approve') {
    body = (
      <form id="approve-form" onSubmit={onApprove} className="rep-form">
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
        {error && <div className="error rep-form-msg">{error}</div>}
      </form>
    );
  } else {
    // 'view'
    body = (
      <>
        <ApplicationBody application={application} />

        {application.status === 'approved' && (
          <div className="applicant-review">
            <span className="muted">
              Approved
              {application.reviewedAt ? ` · ${formatWhen(application.reviewedAt)}` : ''}
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
              Rejected
              {application.reviewedAt ? ` · ${formatWhen(application.reviewedAt)}` : ''}
            </span>
          </div>
        )}

        {error && <div className="error rep-form-msg">{error}</div>}
      </>
    );
  }

  // ---- Footer per mode ----
  let footer: React.ReactNode;
  if (mode === 'done') {
    footer = (
      <button
        type="button"
        onClick={() => {
          onChanged();
          close();
        }}
      >
        Done
      </button>
    );
  } else if (mode === 'approve') {
    footer = (
      <>
        <button type="submit" form="approve-form" disabled={submitting}>
          {submitting ? 'Approving…' : 'Approve applicant'}
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
  } else if (application.status === 'submitted') {
    footer = (
      <>
        <button
          type="button"
          className="btn-inline"
          onClick={() => {
            setError(null);
            setMode('approve');
          }}
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
      </>
    );
  }

  return (
    <SlideOver
      onClose={close}
      kicker={mode === 'approve' ? 'Approve' : TRACK_LABEL[application.track]}
      title={application.fullName}
      footer={footer}
      label="Application detail"
    >
      {body}
    </SlideOver>
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

  // Regional managers for the approve form's dropdown. Best-effort: a failure
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

  const columns: Column<Application>[] = [
    { key: 'name', header: 'Name', cell: (a) => a.fullName },
    {
      key: 'track',
      header: 'Track',
      cell: (a) => (
        <span className={`pill track-pill track-pill--${a.track}`}>
          {TRACK_LABEL[a.track]}
        </span>
      ),
    },
    { key: 'loc', header: 'City / State', cell: (a) => `${a.city}, ${a.state}` },
    { key: 'applied', header: 'Applied', cell: (a) => formatWhen(a.createdAt) },
    {
      key: 'phone',
      header: 'Smartphone',
      cell: (a) => (a.hasSmartphone ? '✓' : '—'),
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
        <QueueTable
          columns={columns}
          rows={apps}
          rowKey={(a) => a.id}
          resetKey={status}
          ariaLabel="Applications"
          renderDetail={(a, close) => (
            <ApplicantDetail
              application={a}
              managers={managers}
              token={token}
              onChanged={() => load(token, status)}
              close={close}
            />
          )}
        />
      ) : (
        !loading &&
        !error && (
          <div className="results-empty">
            <p className="results-empty__title">No {status} applications</p>
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
