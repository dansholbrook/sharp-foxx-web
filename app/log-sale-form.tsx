'use client';

// "Log a Sale" modal used by My Games (field_rep). It creates an ad order via
// POST /ad-orders (which also books the commission atomically, credited to the
// caller). Mirrors the Add Game modal: an advertiser dropdown with an inline
// "+ New advertiser…" creator (same pattern as new-team), an optional package
// dropdown that pre-fills the editable amount from its price, an amount, and an
// optional start date that -- with a package's durationDays -- computes endsOn.

import { useEffect, useState } from 'react';
import {
  getAdvertisers,
  createAdvertiser,
  getAdPackages,
  createAdOrder,
  Advertiser,
  AdPackage,
  CreateAdOrderInput,
} from './api';

// Sentinel option value that reveals the inline "new advertiser" input.
const NEW_ADVERTISER = '__new__';

const usd = (v: string | number) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Add whole days to a yyyy-mm-dd date string, staying in UTC so the result never
// drifts a day across the local timezone. Returns a yyyy-mm-dd string.
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Readable date for the computed end date preview (parsed as UTC to match how it
// was built, so it doesn't show the previous day in negative-offset zones).
function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

export function LogSaleForm({
  token,
  // The signed-in rep's commission rate (numeric string, e.g. "0.10"), best-effort
  // resolved by the parent. When present, the success message shows the commission
  // just earned; when null we fall back to a plain "Sale logged."
  commissionRate,
  onCreated,
  onClose,
}: {
  token: string;
  commissionRate: string | null;
  onCreated?: () => void;
  onClose: () => void;
}) {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [packages, setPackages] = useState<AdPackage[]>([]);
  const [loading, setLoading] = useState(true);

  const [advertiserId, setAdvertiserId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [amount, setAmount] = useState('');
  const [startsOn, setStartsOn] = useState(''); // date input value (yyyy-mm-dd)

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Inline "new advertiser" state (name only, same shape as add-game's new-team).
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [creatingAdvertiser, setCreatingAdvertiser] = useState(false);
  const [newAdvertiserError, setNewAdvertiserError] = useState<string | null>(null);

  // Load advertisers + packages once on mount. A failure surfaces in the form.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [advs, pkgs] = await Promise.all([
          getAdvertisers(token),
          getAdPackages(token),
        ]);
        if (cancelled) return;
        setAdvertisers(advs);
        setPackages(pkgs);
      } catch (err) {
        if (!cancelled) {
          setFormError(err instanceof Error ? err.message : 'Failed to load form data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectedPackage = packages.find((p) => p.id === packageId) ?? null;

  // The computed end date shown when a package with a duration is paired with a
  // start date; also sent as endsOn on submit.
  const computedEndsOn =
    selectedPackage && selectedPackage.durationDays > 0 && startsOn
      ? addDays(startsOn, selectedPackage.durationDays)
      : null;

  // Selecting the advertiser dropdown: the sentinel opens the inline creator;
  // any other value is a real selection.
  function onSelectAdvertiser(value: string) {
    setSuccess(null);
    if (value === NEW_ADVERTISER) {
      setAddingNew(true);
      setNewName('');
      setNewAdvertiserError(null);
      setAdvertiserId('');
      return;
    }
    setAdvertiserId(value);
  }

  // Selecting a package pre-fills the amount from its price. The amount stays
  // editable afterward (negotiated deals), so we only seed it here.
  function onSelectPackage(value: string) {
    setSuccess(null);
    setPackageId(value);
    const pkg = packages.find((p) => p.id === value);
    if (pkg) setAmount(pkg.price);
  }

  // Create an advertiser via POST /advertisers, add it to the dropdown, and
  // select it. A 409 (duplicate name) shows inline.
  async function submitNewAdvertiser() {
    if (!newName.trim()) return;
    setCreatingAdvertiser(true);
    setNewAdvertiserError(null);
    try {
      const adv = await createAdvertiser(token, { businessName: newName.trim() });
      setAdvertisers((prev) =>
        [...prev, adv].sort((a, b) => a.businessName.localeCompare(b.businessName)),
      );
      setAdvertiserId(adv.id);
      setAddingNew(false);
      setNewName('');
    } catch (err) {
      setNewAdvertiserError(
        err instanceof Error ? err.message : 'Failed to create advertiser',
      );
    } finally {
      setCreatingAdvertiser(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!advertiserId) {
      setFormError('Pick an advertiser.');
      return;
    }
    const amountNum = Number(amount);
    if (!amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      setFormError('Enter an amount greater than 0.');
      return;
    }

    const body: CreateAdOrderInput = {
      advertiserId,
      amount: amountNum,
      status: 'active',
    };
    if (packageId) body.packageId = packageId;
    if (startsOn) {
      body.startsOn = startsOn;
      if (computedEndsOn) body.endsOn = computedEndsOn;
    }

    setSubmitting(true);
    try {
      await createAdOrder(token, body);
      // Commission is booked server-side; echo it client-side when we know the
      // rep's rate, otherwise just confirm the sale.
      const rate = commissionRate != null ? Number(commissionRate) : NaN;
      const message =
        !Number.isNaN(rate) && rate > 0
          ? `Sale logged — you earned ${usd(amountNum * rate)} in commission.`
          : 'Sale logged.';
      setSuccess(message);
      onCreated?.();
      // Clear for a possible next entry (the confirmation stays visible).
      setAdvertiserId('');
      setPackageId('');
      setAmount('');
      setStartsOn('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to log sale');
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
        aria-label="Log a sale"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">New sale</span>
            <h2 style={{ margin: '2px 0 0' }}>Log a sale</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="rep-form">
          {/* ---- Advertiser ---- */}
          <div className="field">
            <label htmlFor="ls-advertiser">Advertiser</label>
            <select
              id="ls-advertiser"
              value={advertiserId}
              disabled={loading}
              onChange={(e) => onSelectAdvertiser(e.target.value)}
            >
              <option value="">
                {loading ? 'Loading advertisers…' : 'Choose an advertiser…'}
              </option>
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.businessName}
                </option>
              ))}
              {!loading && <option value={NEW_ADVERTISER}>+ New advertiser…</option>}
            </select>
          </div>

          {/* ---- Inline new-advertiser creator ---- */}
          {addingNew && (
            <div className="field field--wide new-team">
              <label>New advertiser</label>
              <div className="new-team-row">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Business name"
                  autoComplete="off"
                  aria-label="New advertiser name"
                />
                <button
                  type="button"
                  className="btn-inline"
                  disabled={creatingAdvertiser || !newName.trim()}
                  onClick={submitNewAdvertiser}
                >
                  {creatingAdvertiser ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setAddingNew(false);
                    setNewAdvertiserError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {newAdvertiserError && (
                <div className="error rep-form-msg">{newAdvertiserError}</div>
              )}
            </div>
          )}

          {/* ---- Package (optional) ---- */}
          <div className="field">
            <label htmlFor="ls-package">Package (optional)</label>
            <select
              id="ls-package"
              value={packageId}
              disabled={loading}
              onChange={(e) => onSelectPackage(e.target.value)}
            >
              <option value="">No package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {usd(p.price)}
                </option>
              ))}
            </select>
          </div>

          {/* ---- Amount ---- */}
          <div className="field">
            <label htmlFor="ls-amount">Amount (USD)</label>
            <input
              id="ls-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setSuccess(null);
              }}
              placeholder="0.00"
              autoComplete="off"
            />
          </div>

          {/* ---- Start date (optional) ---- */}
          <div className="field">
            <label htmlFor="ls-start">Start date (optional)</label>
            <input
              id="ls-start"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
            {computedEndsOn && (
              <span className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
                Ends {formatDate(computedEndsOn)} ({selectedPackage!.durationDays} days)
              </span>
            )}
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting || loading}>
              {submitting ? 'Logging…' : 'Log sale'}
            </button>
          </div>

          {formError && <div className="error rep-form-msg">{formError}</div>}
          {success && <div className="success rep-form-msg">{success}</div>}
        </form>
      </div>
    </div>
  );
}
