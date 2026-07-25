'use client';

// ============================================================================
// /economy — THE ENGAGEMENT ECONOMY CONSOLE.
//
// Two dials, one page:
//   1. ACTIONS    — what each passive action pays and how often it may pay.
//                   UPDATE-ONLY by design: the action SET is code-defined (every
//                   one needs a hook that can fire it), so there is no create and
//                   no delete here. `enabled: false` is the delete equivalent.
//   2. PROMOTIONS — scheduled multiplier windows. Full CRUD, with one asymmetry
//                   that comes straight from the backend: a promotion may only be
//                   DELETED while it is still in the future. Once it has started
//                   it's part of the record (ledger notes say "(2x: Super Bowl
//                   Weekend)") and can only be disabled — so this page doesn't
//                   even offer Delete on those rather than letting an admin walk
//                   into a 409.
//
// ROLE SPLIT, mirroring economy.controller.ts: reads are admin + regional_manager,
// every WRITE is admin-only. An RM gets this page READ-ONLY — inputs disabled, no
// create form, no row buttons — because a point value is a platform-wide promise
// and a multiplier window is a platform-wide cost. Rendering the controls and
// letting them 403 would be worse than not rendering them.
//
// A staff tool, so the layout leans desktop (a wide actions table), but it holds
// together at 390px — see the .economy-* block in globals.css.
//
// POINTS ONLY: everything priced here is a closed-loop score. Nothing on this
// page is money and nothing formats through usd().
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getEngagementActions,
  updateEngagementAction,
  getPromotions,
  createPointPromotion,
  updatePointPromotion,
  deletePointPromotion,
  promotionWindowState,
  formatMultiplier,
  ledgerActionLabel,
  ACTION_POINTS_MAX,
  ACTION_DAILY_CAP_MAX,
  PROMOTION_MULTIPLIER_MIN,
  PROMOTION_MULTIPLIER_MAX,
  EngagementAction,
  UpdateEngagementActionInput,
  PointPromotion,
} from '../api';

// ---------------------------------------------------------------------------
// Time formatting. <input type="datetime-local"> speaks LOCAL WALL-CLOCK with no
// zone; the API speaks ISO instants. These two functions are the only crossing
// points, and they go through Date so the browser's offset is applied once,
// deliberately, rather than being smeared across the page.
// ---------------------------------------------------------------------------
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// SECTION 1: ACTIONS
//
// Each row edits IN PLACE against a local draft and saves on its own. Per-row
// rather than one page-wide Save because these are independent decisions — an
// admin retuning check-in shouldn't have to think about what else is dirty — and
// because the backend's PATCH is per-action anyway.
// ---------------------------------------------------------------------------

// The editable fields, held as STRINGS while typing. Numbers-as-state would make
// a half-typed "" or "-" unrepresentable and fight the admin's keyboard; parsing
// happens once, at save.
interface ActionDraft {
  label: string;
  description: string;
  points: string;
  dailyCap: string;
  enabled: boolean;
}

function draftOf(a: EngagementAction): ActionDraft {
  return {
    label: a.label,
    description: a.description ?? '',
    points: String(a.points),
    dailyCap: String(a.dailyCap),
    enabled: a.enabled,
  };
}

// Client-side echo of the DB CHECK constraints. The DB is the real guarantee and
// the API's zod turns a violation into a readable 400 — this is the third copy,
// and it earns its place by catching the mistake before the round-trip, next to
// the field that made it.
function validateDraft(d: ActionDraft): string | null {
  if (d.label.trim() === '') return 'Label is required';
  if (d.label.trim().length > 80) return 'Label is at most 80 characters';
  if (d.description.trim().length > 280) return 'Description is at most 280 characters';
  const p = Number(d.points);
  if (!Number.isInteger(p) || p < 0 || p > ACTION_POINTS_MAX) {
    return `Points must be a whole number from 0 to ${ACTION_POINTS_MAX}`;
  }
  const c = Number(d.dailyCap);
  if (!Number.isInteger(c) || c < 0 || c > ACTION_DAILY_CAP_MAX) {
    return `Daily cap must be a whole number from 0 to ${ACTION_DAILY_CAP_MAX}`;
  }
  return null;
}

// Only what actually CHANGED. An empty PATCH is a 400 on purpose (it would stamp
// updated_by/updated_at for a non-event), and sending unchanged fields would
// claim an edit that didn't happen in the audit trail.
function diffOf(
  row: EngagementAction,
  d: ActionDraft,
): UpdateEngagementActionInput | null {
  const patch: UpdateEngagementActionInput = {};
  const label = d.label.trim();
  const description = d.description.trim();
  const nextPoints = Number(d.points);
  const nextCap = Number(d.dailyCap);

  if (label !== row.label) patch.label = label;
  // '' clears the description, which the API models as an explicit null (and
  // distinguishes from "leave it alone"). Only send it if it really moved.
  if (description !== (row.description ?? '')) {
    patch.description = description === '' ? null : description;
  }
  if (nextPoints !== row.points) patch.points = nextPoints;
  if (nextCap !== row.dailyCap) patch.dailyCap = nextCap;
  if (d.enabled !== row.enabled) patch.enabled = d.enabled;

  return Object.keys(patch).length > 0 ? patch : null;
}

function ActionRow({
  token,
  row,
  canWrite,
  onSaved,
}: {
  token: string;
  row: EngagementAction;
  canWrite: boolean;
  onSaved: (next: EngagementAction) => void;
}) {
  const [draft, setDraft] = useState<ActionDraft>(() => draftOf(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reads "Saved" for a beat after a successful write — the row doesn't move on
  // save (it's already showing the new values), so without this there is no
  // feedback at all that the network actually happened.
  const [saved, setSaved] = useState(false);

  // Re-baseline when the server row changes underneath (a section-wide reload).
  // Keyed on the row's identity + audit stamp rather than a deep compare.
  useEffect(() => {
    setDraft(draftOf(row));
  }, [row]);

  const patch = diffOf(row, draft);
  const dirty = patch !== null;
  const invalid = validateDraft(draft);

  async function save() {
    if (!patch) return;
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateEngagementAction(token, row.id, patch);
      onSaved(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const locked = !canWrite || busy;

  return (
    <div
      className={`economy-arow${draft.enabled ? '' : ' economy-arow--off'}`}
    >
      <div className="economy-arow__id">
        {/* The action_type is the CONTRACT — it's what the hook posts and what
            the ledger records — so it leads the row and is never editable. */}
        <code className="economy-arow__type">{row.actionType}</code>
        {row.updatedAt && (
          <span className="economy-arow__audit">
            tuned {formatWhen(row.updatedAt)}
          </span>
        )}
      </div>

      <div className="economy-arow__copy">
        <label className="economy-field">
          <span className="economy-field__label">Label</span>
          <input
            type="text"
            value={draft.label}
            maxLength={80}
            disabled={locked}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </label>
        <label className="economy-field">
          <span className="economy-field__label">Description</span>
          <input
            type="text"
            value={draft.description}
            maxLength={280}
            disabled={locked}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </label>
      </div>

      <div className="economy-arow__nums">
        <label className="economy-field economy-field--num">
          <span className="economy-field__label">Points</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={ACTION_POINTS_MAX}
            step={1}
            value={draft.points}
            disabled={locked}
            onChange={(e) => setDraft((d) => ({ ...d, points: e.target.value }))}
          />
        </label>
        <label className="economy-field economy-field--num">
          <span className="economy-field__label">Daily cap</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={ACTION_DAILY_CAP_MAX}
            step={1}
            value={draft.dailyCap}
            disabled={locked}
            onChange={(e) => setDraft((d) => ({ ...d, dailyCap: e.target.value }))}
          />
          {/* 0 is a legal value with a meaning nobody guesses. Say it. */}
          <span className="economy-field__help">0 = uncapped</span>
        </label>
        <label className="economy-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={locked}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
          />
          <span>Enabled</span>
        </label>
      </div>

      <div className="economy-arow__save">
        {canWrite && (
          <button
            type="button"
            className="economy-savebtn"
            disabled={!dirty || busy || invalid !== null}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
        {saved && <span className="economy-saved">Saved</span>}
        {/* The live validation message shows as soon as a field is out of range,
            whether or not Save has been pressed — the button is disabled by then
            anyway, so without this the admin sees a dead button and no reason. */}
        {invalid && dirty && <span className="economy-rowerr">{invalid}</span>}
        {error && <span className="economy-rowerr">{error}</span>}
      </div>
    </div>
  );
}

function ActionsSection({
  token,
  canWrite,
  actions,
  setActions,
  loading,
  error,
}: {
  token: string;
  canWrite: boolean;
  actions: EngagementAction[] | null;
  setActions: (next: EngagementAction[]) => void;
  loading: boolean;
  error: string | null;
}) {
  const onSaved = useCallback(
    (next: EngagementAction) => {
      if (!actions) return;
      setActions(actions.map((a) => (a.id === next.id ? next : a)));
    },
    [actions, setActions],
  );

  return (
    <section className="economy-section">
      <div className="economy-section__head">
        <h2>Actions</h2>
        <p className="economy-section__note">
          What each engagement action pays and how many times a day it may pay.
          The action list itself ships with the code — every one needs a hook that
          can fire it — so actions are tuned here, never added or removed. Turn one
          off with Enabled; the row and its ledger history survive.
        </p>
      </div>

      {loading && <div className="card muted">Loading actions…</div>}
      {error && <div className="error">{error}</div>}

      {actions && actions.length > 0 && (
        <div className="economy-atable">
          {actions.map((a) => (
            <ActionRow
              key={a.id}
              token={token}
              row={a}
              canWrite={canWrite}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}

      {actions && actions.length === 0 && (
        <div className="results-empty">
          <p className="results-empty__title">No actions configured</p>
          <p className="results-empty__hint">
            The engagement_actions table is empty — it&apos;s seeded by migration,
            so this means the economy migration hasn&apos;t run.
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SECTION 2: PROMOTIONS
// ---------------------------------------------------------------------------

// The form's own state, shared by create and edit. Same strings-while-typing
// rule as the action draft.
interface PromoDraft {
  name: string;
  multiplier: string;
  startsAt: string;
  endsAt: string;
  // Empty = ALL engagement earns (the API's null). Non-empty = the targeted set.
  appliesTo: string[];
  enabled: boolean;
}

const EMPTY_PROMO: PromoDraft = {
  name: '',
  multiplier: '2',
  startsAt: '',
  endsAt: '',
  appliesTo: [],
  enabled: true,
};

function promoDraftOf(p: PointPromotion): PromoDraft {
  return {
    name: p.name,
    multiplier: formatMultiplier(p.multiplier),
    startsAt: toLocalInput(p.startsAt),
    endsAt: toLocalInput(p.endsAt),
    appliesTo: p.appliesTo ?? [],
    enabled: p.enabled,
  };
}

function validatePromo(d: PromoDraft): string | null {
  if (d.name.trim() === '') return 'Name is required';
  if (d.name.trim().length > 120) return 'Name is at most 120 characters';
  const m = Number(d.multiplier);
  if (!Number.isFinite(m) || m < PROMOTION_MULTIPLIER_MIN || m > PROMOTION_MULTIPLIER_MAX) {
    return `Multiplier must be between ${PROMOTION_MULTIPLIER_MIN} and ${PROMOTION_MULTIPLIER_MAX}`;
  }
  if (!d.startsAt) return 'Start time is required';
  if (!d.endsAt) return 'End time is required';
  if (new Date(d.endsAt).getTime() <= new Date(d.startsAt).getTime()) {
    return 'End must be after start';
  }
  return null;
}

// The create/edit form. `initial` present = editing (the submit label and the
// call site change); absent = the create form.
function PromotionForm({
  actions,
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  actions: EngagementAction[];
  initial?: PromoDraft;
  busy: boolean;
  submitLabel: string;
  onSubmit: (d: PromoDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<PromoDraft>(initial ?? EMPTY_PROMO);
  const [touched, setTouched] = useState(false);
  const problem = validatePromo(draft);

  function toggleAction(actionType: string) {
    setDraft((d) => ({
      ...d,
      appliesTo: d.appliesTo.includes(actionType)
        ? d.appliesTo.filter((t) => t !== actionType)
        : [...d.appliesTo, actionType],
    }));
  }

  return (
    <form
      className="economy-pform"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (problem) return;
        onSubmit(draft);
      }}
    >
      <div className="economy-pform__grid">
        <label className="economy-field economy-field--wide">
          <span className="economy-field__label">Name</span>
          <input
            type="text"
            value={draft.name}
            maxLength={120}
            disabled={busy}
            placeholder="Weekend Double Points"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <span className="economy-field__help">
            Fans see this — it&apos;s the banner headline and the ledger note.
          </span>
        </label>

        <label className="economy-field economy-field--num">
          <span className="economy-field__label">Multiplier</span>
          <input
            type="number"
            inputMode="decimal"
            min={PROMOTION_MULTIPLIER_MIN}
            max={PROMOTION_MULTIPLIER_MAX}
            step={0.5}
            value={draft.multiplier}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, multiplier: e.target.value }))}
          />
          <span className="economy-field__help">1–5, in half steps</span>
        </label>

        <label className="economy-field">
          <span className="economy-field__label">Starts</span>
          <input
            type="datetime-local"
            value={draft.startsAt}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
          />
        </label>

        <label className="economy-field">
          <span className="economy-field__label">Ends</span>
          <input
            type="datetime-local"
            value={draft.endsAt}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
          />
        </label>
      </div>

      <fieldset className="economy-applies">
        <legend className="economy-field__label">Applies to</legend>
        <p className="economy-field__help">
          Leave every box unchecked for a platform-wide promotion — that&apos;s the
          usual case, and it boosts every engagement earn.
        </p>
        <div className="economy-applies__chips">
          {actions.map((a) => {
            const on = draft.appliesTo.includes(a.actionType);
            return (
              <label
                key={a.actionType}
                className={`economy-chip${on ? ' economy-chip--on' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={() => toggleAction(a.actionType)}
                />
                <span>{a.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="economy-toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />
        <span>Enabled</span>
      </label>

      {touched && problem && <div className="error">{problem}</div>}

      <div className="economy-pform__actions">
        <button type="submit" className="economy-submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PromotionRow({
  token,
  promo,
  actions,
  canWrite,
  onChanged,
  onDeleted,
}: {
  token: string;
  promo: PointPromotion;
  actions: EngagementAction[];
  canWrite: boolean;
  onChanged: (next: PointPromotion) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = promotionWindowState(promo);
  // DELETE is only offered on a promotion that has NEVER RUN. The backend 409s
  // anything else (its ledger notes reference the name), so showing the button
  // would be an invitation to an error. Disable is the answer for the rest.
  const deletable = state === 'upcoming';

  // Label the targeting the way the fan-facing banner does: null/empty is the
  // platform-wide case, not "nothing".
  const appliesLabel = useMemo(() => {
    if (!promo.appliesTo || promo.appliesTo.length === 0) return 'All engagement earns';
    const byType = new Map(actions.map((a) => [a.actionType, a.label]));
    return promo.appliesTo.map((t) => byType.get(t) ?? ledgerActionLabel(t)).join(' · ');
  }, [promo.appliesTo, actions]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function submitEdit(d: PromoDraft) {
    void run(async () => {
      const next = await updatePointPromotion(token, promo.id, {
        name: d.name.trim(),
        multiplier: Number(d.multiplier),
        startsAt: new Date(d.startsAt).toISOString(),
        endsAt: new Date(d.endsAt).toISOString(),
        // Empty selection WIDENS back to all engagement earns (explicit null),
        // which is the same thing the create form's empty state means.
        appliesTo: d.appliesTo.length > 0 ? d.appliesTo : null,
        enabled: d.enabled,
      });
      onChanged(next);
      setEditing(false);
    });
  }

  return (
    <li className={`economy-prow${promo.enabled ? '' : ' economy-prow--off'}`}>
      <div className="economy-prow__main">
        <div className="economy-prow__top">
          <span className={`economy-pchip economy-pchip--${state}`}>{state}</span>
          {/* A disabled promotion INSIDE its window still lists as active — the
              chip is about the window, this is about the switch, and an admin
              asking "why isn't the 2x running?" needs to see both. */}
          {!promo.enabled && (
            <span className="economy-pchip economy-pchip--off">disabled</span>
          )}
          <span className="economy-prow__mult">
            {formatMultiplier(promo.multiplier)}x
          </span>
          <span className="economy-prow__name">{promo.name}</span>
        </div>
        <div className="economy-prow__meta">
          <span>
            {formatWhen(promo.startsAt)} → {formatWhen(promo.endsAt)}
          </span>
          <span className="economy-prow__applies">{appliesLabel}</span>
        </div>
      </div>

      {canWrite && !editing && (
        <div className="economy-prow__actions">
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await updatePointPromotion(token, promo.id, {
                  enabled: !promo.enabled,
                });
                onChanged(next);
              })
            }
          >
            {promo.enabled ? 'Disable' : 'Enable'}
          </button>
          {deletable && (
            <button
              type="button"
              className="link-btn economy-danger"
              disabled={busy}
              onClick={() => {
                // Same confirm idiom as the other destructive staff actions
                // (/applicants reject, /national-admin void). Cheap insurance on
                // a click that throws away someone's scheduling work — and the
                // ONLY guard, since a never-started promotion has no ledger
                // history for the backend to refuse on.
                if (!window.confirm(`Delete the promotion “${promo.name}”?`)) return;
                void run(async () => {
                  await deletePointPromotion(token, promo.id);
                  onDeleted(promo.id);
                });
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {error && <div className="error economy-prow__err">{error}</div>}

      {editing && (
        <PromotionForm
          actions={actions}
          initial={promoDraftOf(promo)}
          busy={busy}
          submitLabel="Save changes"
          onSubmit={submitEdit}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
        />
      )}
    </li>
  );
}

function PromotionsSection({
  token,
  canWrite,
  actions,
}: {
  token: string;
  canWrite: boolean;
  actions: EngagementAction[];
}) {
  const [promos, setPromos] = useState<PointPromotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // scope=all in ONE read: the row chips derive upcoming/active/past
      // client-side from the window, so three scoped requests would buy the same
      // list three times and then have to be stitched back together in order.
      const page = await getPromotions(token, 'all');
      setPromos(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load promotions');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function submitCreate(d: PromoDraft) {
    setCreateBusy(true);
    setCreateError(null);
    createPointPromotion(token, {
      name: d.name.trim(),
      multiplier: Number(d.multiplier),
      startsAt: new Date(d.startsAt).toISOString(),
      endsAt: new Date(d.endsAt).toISOString(),
      appliesTo: d.appliesTo.length > 0 ? d.appliesTo : null,
      enabled: d.enabled,
    })
      .then(() => {
        setCreating(false);
        // Reload rather than prepending: the list is ordered by startsAt DESC,
        // and a promotion scheduled for last Tuesday doesn't belong at the top.
        return load();
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : 'Could not create promotion');
      })
      .finally(() => setCreateBusy(false));
  }

  return (
    <section className="economy-section">
      <div className="economy-section__head">
        <h2>Promotions</h2>
        <p className="economy-section__note">
          Scheduled multiplier windows over engagement earns. Overlaps are fine —
          a fan gets the single highest multiplier that covers their earn, never a
          stack. Contest costs and payouts are never multiplied.
        </p>
      </div>

      {canWrite && !creating && (
        <button
          type="button"
          className="economy-newbtn"
          onClick={() => {
            setCreating(true);
            setCreateError(null);
          }}
        >
          + New promotion
        </button>
      )}

      {creating && (
        <div className="economy-createbox">
          <h3 className="economy-createbox__title">New promotion</h3>
          {createError && <div className="error">{createError}</div>}
          <PromotionForm
            actions={actions}
            busy={createBusy}
            submitLabel="Create promotion"
            onSubmit={submitCreate}
            onCancel={() => {
              setCreating(false);
              setCreateError(null);
            }}
          />
        </div>
      )}

      {loading && <div className="card muted">Loading promotions…</div>}
      {error && <div className="error">{error}</div>}

      {promos && promos.length > 0 && (
        <ul className="economy-plist">
          {promos.map((p) => (
            <PromotionRow
              key={p.id}
              token={token}
              promo={p}
              actions={actions}
              canWrite={canWrite}
              onChanged={(next) =>
                setPromos((prev) =>
                  (prev ?? []).map((row) => (row.id === next.id ? next : row)),
                )
              }
              onDeleted={(id) =>
                setPromos((prev) => (prev ?? []).filter((row) => row.id !== id))
              }
            />
          ))}
        </ul>
      )}

      {promos && promos.length === 0 && !loading && (
        <div className="results-empty">
          <p className="results-empty__title">No promotions scheduled</p>
          <p className="results-empty__hint">
            Engagement actions are paying their base values. Schedule a window
            above to run a multiplier.
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function EconomyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);
  // The write gate, mirroring the backend's per-route @Roles('admin'). An RM
  // reads the whole page with every control absent or disabled.
  const canWrite = (user?.roles ?? []).includes('admin');

  const [actions, setActions] = useState<EngagementAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEngagementActions(token)
      .then((page) => {
        if (!cancelled) setActions(page.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load actions');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home economy-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <div className="masthead">
        <span className="masthead-kicker">Staff</span>
        <h1 className="masthead-title">Engagement economy</h1>
        <p className="masthead-standfirst">
          What passive engagement pays, and when it pays double. Points only —
          a closed-loop score with no cash value, never bought and never redeemed.
        </p>
        {!canWrite && (
          <p className="economy-readonly">
            Read-only — changing the economy is admin-only.
          </p>
        )}
      </div>

      <ActionsSection
        token={token}
        canWrite={canWrite}
        actions={actions}
        setActions={setActions}
        loading={loading}
        error={error}
      />

      {/* Promotions needs the action list for its applies-to picker and its row
          labels, so it waits for that read rather than rendering a picker of
          raw action_type slugs. */}
      {actions && (
        <PromotionsSection token={token} canWrite={canWrite} actions={actions} />
      )}
    </main>
  );
}
