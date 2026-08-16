'use client';

// /national-admin — the National Board's management surface: open a house
// question, then lock / resolve / void it. admin + regional_manager only.
//
// This is the courtside console's pattern WITHOUT the courtside: same open form,
// same status pills, same confirm-before-you-pay-out discipline (see
// my-games/[eventId]'s PredictionConsole). What's different is what a national
// question is:
//   • No event. So `winner` has no team names to take, and the labels become the
//     staff member's job — 2-6 of them, the only caller-labelled question v1 has.
//   • `context` is REQUIRED: it's the only thing telling a fan what the question
//     is even about ("NBA Finals 2026").
//   • `resolvesBy` is the promise that staked points come back by a date. The
//     backend keeps it optional; this page pushes hard for it and flags the ones
//     that blow it, because a national question can sit open for MONTHS and
//     silently-held points are how fans stop trusting the board.
//
// POINTS ONLY — "points", "picks", "stake"; never "bet", "wager", "odds".

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  createPrediction,
  getNationalPredictions,
  isNationalOverdue,
  lockPrediction,
  resolvePrediction,
  voidPrediction,
  points,
  etWallClockToIso,
  NationalPrediction,
  PredictionKind,
} from '../api';

// The three kinds, in the order a staff member reaches for them. `winner` leads:
// a multi-way field is what the National Board is FOR ("who wins the Finals?").
const KINDS: Array<{ value: PredictionKind; label: string; hint: string }> = [
  { value: 'winner', label: 'Winner', hint: 'A field of 2–6. You name the options.' },
  { value: 'yes_no', label: 'Yes / No', hint: 'The board labels these Yes and No.' },
  { value: 'over_under', label: 'Over / Under', hint: 'Needs a line. The board labels these Over <line> / Under <line>.' },
];

// Matches MAX_NATIONAL_OPTIONS on the backend: 6 is the widest field that reads
// as a list a fan will actually read rather than a scroll they'll skip.
const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;

// The starting grant, and the backend's hard cap on a stake: a question staked
// above what a new fan HAS is unplayable by every new fan — each pick would 409
// "Insufficient points" with nothing on screen explaining why.
const MAX_STAKE = 1000;

// A national `winner`'s keys are the caller's, and they're what resolution
// matches against forever — so they're derived from the label rather than typed
// by hand: a staff member should be naming teams, not inventing slugs. Collisions
// are resolved by index, since the backend requires unique keys.
function keyForLabel(label: string, index: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || `opt-${index + 1}`;
}

function uniqueKeys(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.map((label, i) => {
    let key = keyForLabel(label, i);
    if (seen.has(key)) key = `${key.slice(0, 36)}-${i + 1}`;
    seen.add(key);
    return key;
  });
}

function statusPill(p: NationalPrediction): { cls: string; text: string } {
  switch (p.status) {
    case 'open':
      return { cls: 'open', text: 'Open' };
    case 'locked':
      return { cls: 'locked', text: 'Locked' };
    case 'resolved':
      return { cls: 'resolved', text: 'Resolved' };
    case 'voided':
      return { cls: 'voided', text: 'Voided' };
  }
}

function formatDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---- Open a question -------------------------------------------------------

function OpenForm({
  token,
  onOpened,
}: {
  token: string;
  onOpened: () => Promise<void>;
}) {
  const [kind, setKind] = useState<PredictionKind>('winner');
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [line, setLine] = useState('');
  const [stake, setStake] = useState('');
  const [locksAt, setLocksAt] = useState('');
  const [resolvesBy, setResolvesBy] = useState('');
  // Only meaningful for `winner`. Starts at the minimum field of two.
  const [labels, setLabels] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lineNum = Number(line);
  const lineValid = line.trim() !== '' && Number.isFinite(lineNum);
  const stakeNum = Number(stake);
  const stakeValid =
    stake.trim() === '' ||
    (Number.isInteger(stakeNum) && stakeNum > 0 && stakeNum <= MAX_STAKE);
  const filledLabels = labels.map((l) => l.trim()).filter(Boolean);
  const labelsValid = kind !== 'winner' || filledLabels.length >= MIN_OPTIONS;

  const canOpen =
    question.trim().length > 0 &&
    context.trim().length > 0 &&
    labelsValid &&
    stakeValid &&
    (kind !== 'over_under' || lineValid) &&
    !busy;

  function setLabelAt(i: number, value: string) {
    setLabels((prev) => prev.map((l, j) => (j === i ? value : l)));
  }

  async function open() {
    if (!canOpen) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // A national `winner` is the ONE question whose keys AND labels come from
      // the caller — there's no event to take team names from. Every other kind
      // keeps the server's closed key set and server-owned labels, so we send
      // keys only and let the backend write "Yes"/"Over 12.5"/… itself.
      const options =
        kind === 'winner'
          ? uniqueKeys(filledLabels).map((key, i) => ({ key, label: filledLabels[i] }))
          : kind === 'yes_no'
            ? [{ key: 'yes' }, { key: 'no' }]
            : [{ key: 'over' }, { key: 'under' }];

      await createPrediction(token, {
        scope: 'national',
        question: question.trim(),
        context: context.trim(),
        kind,
        options,
        ...(kind === 'over_under' ? { line: lineNum } : {}),
        ...(stake.trim() !== '' ? { stake: stakeNum } : {}),
        // datetime-local gives a wall clock with no zone, and the field says
        // that clock is EASTERN — so it crosses to an instant through ET rather
        // than through whatever offset the admin's laptop happens to be on. A
        // lock time is the one field on this form fans lose points to.
        ...(locksAt ? { locksAt: etWallClockToIso(locksAt) ?? undefined } : {}),
        // Already a DATE ('2026-07-15') from <input type="date"> — exactly what
        // the backend wants. Deliberately NOT run through Date: that would make
        // an instant out of a promise and could shift the day across a zone.
        ...(resolvesBy ? { resolvesBy } : {}),
      });
      setQuestion('');
      setContext('');
      setLine('');
      setStake('');
      setLocksAt('');
      setResolvesBy('');
      setLabels(['', '']);
      // create returns the RAW row (no distribution, no myPick), so the board is
      // re-read rather than spliced — same rule as the courtside console.
      await onOpened();
      setNotice('Question is open on the National Board — fans can pick now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open question');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="natboard-admin__form card">
      <h2 className="natboard-admin__form-title">Open a national question</h2>

      <div className="natboard-admin__kinds">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            className={`console-chip${kind === k.value ? ' console-chip--on' : ''}`}
            disabled={busy}
            onClick={() => setKind(k.value)}
          >
            {k.label}
          </button>
        ))}
        <span className="natboard-admin__hint">
          {KINDS.find((k) => k.value === kind)?.hint}
        </span>
      </div>

      <label className="natboard-admin__field">
        <span className="natboard-admin__label">Question</span>
        <input
          value={question}
          placeholder="Who wins the NBA Finals?"
          maxLength={200}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>

      <label className="natboard-admin__field">
        <span className="natboard-admin__label">
          Context <span className="natboard-admin__req">required</span>
        </span>
        <input
          value={context}
          placeholder="NBA Finals 2026"
          maxLength={120}
          disabled={busy}
          onChange={(e) => setContext(e.target.value)}
        />
        <span className="natboard-admin__help">
          What this is about. It&apos;s the only label a fan gets — a national
          question has no game to caption it.
        </span>
      </label>

      {/* ---- The winner field: 2-6 caller-named options ---- */}
      {kind === 'winner' && (
        <div className="natboard-admin__field">
          <span className="natboard-admin__label">Options</span>
          <div className="natboard-admin__opts">
            {labels.map((label, i) => (
              <div key={i} className="natboard-admin__opt">
                <input
                  value={label}
                  placeholder={`Option ${i + 1}`}
                  maxLength={80}
                  disabled={busy}
                  aria-label={`Option ${i + 1}`}
                  onChange={(e) => setLabelAt(i, e.target.value)}
                />
                {/* Never below the minimum field of two. */}
                {labels.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    className="btn-inline btn-ghost"
                    disabled={busy}
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() =>
                      setLabels((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {labels.length < MAX_OPTIONS && (
            <button
              type="button"
              className="btn-inline btn-ghost natboard-admin__add"
              disabled={busy}
              onClick={() => setLabels((prev) => [...prev, ''])}
            >
              + Add option
            </button>
          )}
          <span className="natboard-admin__help">
            {MIN_OPTIONS}–{MAX_OPTIONS} options. These labels are what fans see and
            what you&apos;ll resolve against — name them the way a fan would say
            them. Blank options are dropped.
          </span>
        </div>
      )}

      {kind === 'over_under' && (
        <label className="natboard-admin__field">
          <span className="natboard-admin__label">Line</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={line}
            placeholder="12.5"
            disabled={busy}
            onChange={(e) => setLine(e.target.value)}
          />
        </label>
      )}

      <div className="natboard-admin__row">
        <label className="natboard-admin__field">
          <span className="natboard-admin__label">Stake</span>
          <input
            type="number"
            step="1"
            min="1"
            max={MAX_STAKE}
            value={stake}
            placeholder="100"
            disabled={busy}
            onChange={(e) => setStake(e.target.value)}
          />
          <span className="natboard-admin__help">
            Points per pick. Blank uses the default. Max {points(MAX_STAKE)} — a
            stake above the starting grant is unplayable for a new fan.
          </span>
        </label>

        <label className="natboard-admin__field">
          <span className="natboard-admin__label">Locks at</span>
          <input
            type="datetime-local"
            value={locksAt}
            disabled={busy}
            onChange={(e) => setLocksAt(e.target.value)}
          />
          <span className="natboard-admin__help">
            Optional. Eastern Time. Picks close automatically at this time.
          </span>
        </label>

        <label className="natboard-admin__field">
          <span className="natboard-admin__label">Resolves by</span>
          <input
            type="date"
            value={resolvesBy}
            disabled={busy}
            onChange={(e) => setResolvesBy(e.target.value)}
          />
          <span className="natboard-admin__help">
            Optional, but say it. It&apos;s the only thing telling a fan when
            their staked points come back.
          </span>
        </label>
      </div>

      {/* The nudge, not a block: the backend keeps resolvesBy optional, so this
          stays advice rather than a gate. A question with no date is legitimate
          (it settles this week); one that goes quiet for months is how fans stop
          trusting the board. */}
      {!resolvesBy && (
        <p className="natboard-admin__warn">
          No resolve-by date. Fans staking points on this won&apos;t know when
          they settle.
        </p>
      )}

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <button
        type="button"
        className="btn-inline natboard-admin__open"
        disabled={!canOpen}
        onClick={() => void open()}
      >
        {busy ? 'Working…' : 'Open question'}
      </button>
    </section>
  );
}

// ---- The board: status + actions on every national question ----------------

function AdminRow({
  token,
  p,
  onChanged,
}: {
  token: string;
  p: NationalPrediction;
  onChanged: (notice: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolve expands in place into its own options — same one-surface pattern as
  // the courtside console, no dialog before the confirm.
  const [resolving, setResolving] = useState(false);

  const pill = statusPill(p);
  const live = p.status === 'open' || p.status === 'locked';
  const overdue = isNationalOverdue(p);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const notice = await fn();
      setResolving(false);
      await onChanged(notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  // Pays out irreversibly, so it confirms — naming the winner and what's riding
  // on it, which is the thing worth catching before it's too late to catch.
  function resolve(winningKey: string) {
    const label = p.options.find((o) => o.key === winningKey)?.label ?? winningKey;
    if (
      !window.confirm(
        `Resolve "${p.question}" with ${label} as the winner?\n\nThis pays out ${
          p.totalPicks
        } pick${p.totalPicks === 1 ? '' : 's'} irreversibly and cannot be undone.`,
      )
    ) {
      return;
    }
    void run(async () => {
      const res = await resolvePrediction(token, p.id, winningKey);
      return `Resolved — ${res.tally.winners} of ${res.tally.picks} picks won, ${points(
        res.tally.pointsPaid,
      )} points paid out.`;
    });
  }

  function voidIt() {
    if (
      !window.confirm(
        `Void "${p.question}"?\n\nEvery stake is refunded and nobody wins or loses. It drops off the National Board.`,
      )
    ) {
      return;
    }
    void run(async () => {
      const res = await voidPrediction(token, p.id);
      return `Voided — ${points(res.tally.pointsRefunded)} points refunded to ${
        res.tally.refunded
      } pick${res.tally.refunded === 1 ? '' : 's'}.`;
    });
  }

  return (
    <li className="natboard-admin__item">
      <div className="natboard-admin__item-head">
        <span className="natboard-admin__q">{p.question}</span>
        <span className={`pill predict-pill predict-pill--${pill.cls}`}>
          {pill.text}
        </span>
        {/* The promise, broken: still takeable (or holding points) past the date
            the house named. Staff-only — a fan sees the same fact worded for
            them on the feed band. */}
        {overdue && (
          <span className="pill natboard-admin__overdue">Resolution overdue</span>
        )}
      </div>

      <div className="natboard-admin__meta">
        {p.context && <span className="natboard-admin__meta-ctx">{p.context}</span>}
        <span>
          {p.totalPicks === 1 ? '1 pick' : `${points(p.totalPicks)} picks`} ·{' '}
          {points(p.stake)} points each
        </span>
        {p.resolvesBy && <span>Resolves by {formatDate(p.resolvesBy)}</span>}
        {p.openedByName && <span>Opened by {p.openedByName}</span>}
      </div>

      {p.status === 'resolved' && (
        <p className="natboard-admin__won">
          Winner:{' '}
          <strong>
            {p.options.find((o) => o.key === p.winningKey)?.label ?? p.winningKey}
          </strong>
        </p>
      )}

      {error && <div className="error">{error}</div>}

      {/* Settled questions carry no actions — there is nothing left to do to
          them, and resolve/void both 409 on anything not open or locked. */}
      {live &&
        (resolving ? (
          <div className="predict-console__resolve">
            <span className="predict-console__resolve-label">Who won?</span>
            {p.options.map((o) => (
              <button
                key={o.key}
                type="button"
                className="btn-inline predict-console__winner"
                disabled={busy}
                onClick={() => resolve(o.key)}
              >
                {o.label}
              </button>
            ))}
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => setResolving(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="predict-console__actions">
            {p.status === 'open' && (
              <button
                type="button"
                className="btn-inline btn-ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await lockPrediction(token, p.id);
                    return 'Picks locked.';
                  })
                }
              >
                Lock
              </button>
            )}
            <button
              type="button"
              className="btn-inline btn-ghost"
              disabled={busy}
              onClick={() => setResolving(true)}
            >
              Resolve
            </button>
            <button
              type="button"
              className="btn-inline btn-ghost predict-console__void"
              disabled={busy}
              onClick={voidIt}
            >
              Void
            </button>
          </div>
        ))}
    </li>
  );
}

export default function NationalAdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [rows, setRows] = useState<NationalPrediction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setRows(await getNationalPredictions(token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the board');
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    void load();
  }, [token, router, allowed, load]);

  const onChanged = useCallback(
    async (msg: string) => {
      await load();
      setNotice(msg);
    },
    [load],
  );

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const liveRows = (rows ?? []).filter(
    (p) => p.status === 'open' || p.status === 'locked',
  );
  const settledRows = (rows ?? []).filter((p) => p.status === 'resolved');
  const overdueCount = (rows ?? []).filter(isNationalOverdue).length;

  return (
    <main className="feed-home">
      <div className="masthead masthead-head">
        <div>
          <span className="masthead-kicker">Predictions</span>
          <h1 className="masthead-title">National predictions</h1>
          <p className="masthead-standfirst">
            House questions about the wider sport, tied to no game we cover. They
            show up on every fan&apos;s feed. Points only — no money, ever.
          </p>
        </div>
        <div className="masthead-actions">
          <Link href="/feed" className="link-btn">
            See the board →
          </Link>
        </div>
      </div>

      {/* The one number worth surfacing at the top: questions past the date the
          house promised. Everything else on this page is per-row. */}
      {overdueCount > 0 && (
        <div className="natboard-admin__alert">
          {overdueCount === 1
            ? '1 question is past its resolve-by date'
            : `${overdueCount} questions are past their resolve-by date`}{' '}
          — fans are holding staked points on {overdueCount === 1 ? 'it' : 'them'}.
        </div>
      )}

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <OpenForm token={token} onOpened={load} />

      <section className="natboard-admin__board">
        <h2 className="game-articles__head">Live questions</h2>
        {liveRows.length > 0 ? (
          <ul className="natboard-admin__list">
            {liveRows.map((p) => (
              <AdminRow key={p.id} token={token} p={p} onChanged={onChanged} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            Nothing open. Ask the country something.
          </p>
        )}
      </section>

      {settledRows.length > 0 && (
        <section className="natboard-admin__board">
          <h2 className="game-articles__head">Recently resolved</h2>
          {/* Voided questions are absent BY DESIGN, not by omission: the backend
              excludes them from this read so a question staff pulled isn't
              advertised to fans. Fans who picked one keep seeing it on /picks as
              'refunded'. A voided question simply leaves this page. */}
          <ul className="natboard-admin__list">
            {settledRows.map((p) => (
              <AdminRow key={p.id} token={token} p={p} onChanged={onChanged} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
