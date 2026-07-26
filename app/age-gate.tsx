'use client';

// ============================================================================
// THE 18+ GATE, FAN SIDE. One prompt, mounted once, for all eight gated entry
// surfaces (Oracle, Trail, Call, prediction picks, contest enter / picks /
// squares / parlay tickets).
//
// ----------------------------------------------------------------------------
// DO NOT ADD AN UNDER-18 BRANCH TO THIS COMPONENT.
//
// There is no under-18 path in the product and no backend field records a
// refusal, so the only two outcomes here are "affirmed" and "closed". A
// sympathetic-looking "I'm under 18" option would manufacture exactly the
// actual knowledge the backend deliberately declines to acquire -- see the
// LIMITS block above AgeGateGuard in sharp-foxx-api/src/common/http.ts, ¶2:
// not collecting a DOB means we never acquire actual knowledge that a specific
// user is a minor, which is protective, and there is no path to suspend an
// account on such knowledge today. Asking the question creates an obligation
// nothing in this system can discharge. Declining records NOTHING, client or
// server, and is not an admission of anything.
// ----------------------------------------------------------------------------
//
// WHY IT IS LAZY AND NEVER A REDIRECT. Reads are ungated on purpose across the
// whole API; AgeGateGuard stops a fan at the eight entry surfaces and nowhere
// else. So a fan who only follows teams and watches games is never interrupted,
// and the ask arrives at the moment it means something -- with their finger on
// the button they just pressed. mustAttestAge only lets the prompt open a beat
// EARLY, before a call we know will 403. The 403 itself is the authority: a
// session persisted before the gate shipped carries no flag at all, and those
// are precisely the accounts that owe an attestation.
//
// WHY THE SENTENCE IS NOT IN THIS FILE. The backend ships the wording inside
// the 403 and again in the attest-age response so the two can never drift. We
// render `terms.text`. The only literal lives in api.ts as a documented initial
// value for the one public page that has no token to fetch it with.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import {
  attestAge,
  getAgeGateTerms,
  AgeAttestationRequiredError,
  AgeAttestationTerms,
  AGE_GATE_FALLBACK_TERMS,
} from './api';
import { useAuth } from './auth-context';

// Thrown by runGated when the fan closes the prompt without affirming.
//
// It carries a plain, non-scolding sentence BECAUSE every gated call site
// already renders `err.message` in its own inline slot. That means a decline
// costs no call-site branching and still explains the no-op -- a fan who taps
// RIDE, closes the prompt and sees absolutely nothing has been told their tap
// broke. This is a statement of what's needed, not an error about what they did.
export class AgeGateDeclinedError extends Error {
  constructor() {
    super('You can enter once you confirm you’re 18 or older.');
    this.name = 'AgeGateDeclinedError';
  }
}

interface AgeGateState {
  // Run a gated action through the gate. Resolves with the action's own result
  // on success. If the action 403s for want of an attestation, the prompt opens
  // with the SERVER'S wording and -- on affirm -- the action is retried once
  // automatically, so the fan's tap completes in the gesture they started.
  // Throws AgeGateDeclinedError if they close it instead.
  runGated: <T>(fn: () => Promise<T>) => Promise<T>;
}

const AgeGateContext = createContext<AgeGateState | undefined>(undefined);

export function AgeGateProvider({ children }: { children: ReactNode }) {
  const { token, mustAttestAge, setSession } = useAuth();

  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<AgeAttestationTerms>(AGE_GATE_FALLBACK_TERMS);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pending runGated caller, parked until the fan answers.
  const resolveRef = useRef<((affirmed: boolean) => void) | null>(null);
  // Terms are only fetched for the PRE-EMPTIVE open (no 403 payload to read
  // them from). Once, best-effort: a failure leaves the initial value showing.
  const fetchedRef = useRef(false);

  const settle = useCallback((affirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(affirmed);
  }, []);

  // Open the prompt and park the caller. `next` is the server's wording when we
  // have it (from the 403); null means "keep what's in state" -- the pre-emptive
  // open, which has no payload to read.
  const ask = useCallback(
    (next: AgeAttestationTerms | null) =>
      new Promise<boolean>((resolve) => {
        // A second ask while one is parked supersedes it; the superseded caller
        // is told "declined" so it can never hang.
        settle(false);
        resolveRef.current = resolve;
        if (next) setTerms(next);
        setChecked(false);
        setError(null);
        setBusy(false);
        setOpen(true);
      }),
    [settle],
  );

  const refreshTerms = useCallback(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    getAgeGateTerms()
      .then(setTerms)
      .catch(() => {
        // Endpoint not shipped yet, or offline. The initial value stands, and a
        // later 403 carries the authoritative wording anyway. Allow a retry.
        fetchedRef.current = false;
      });
  }, []);

  const runGated = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      // Pre-emptive: we already know this account owes an attestation, so ask
      // before spending a call we know will refuse. The flag can be stale (they
      // attested in another tab) -- attest-age is idempotent and the first
      // attestation is the one kept, so asking twice costs nothing but a tap.
      if (mustAttestAge) {
        refreshTerms();
        if (!(await ask(null))) throw new AgeGateDeclinedError();
      }

      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof AgeAttestationRequiredError)) throw err;
        if (!(await ask(err.attestation))) throw new AgeGateDeclinedError();
        // Retry once. `fn` closed over the OLD token, which still says
        // att:false -- and that is fine: AgeGateGuard falls back to reading
        // users.age_attested_at whenever the claim is false, which is precisely
        // the mid-session case it was written for. The fresh token from the
        // swap makes the NEXT hour of calls skip that read; it is not needed
        // for this one to land.
        return await fn();
      }
    },
    [mustAttestAge, ask, refreshTerms],
  );

  async function affirm() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await attestAge(token);
      // The response is login-shaped, so ONE call swaps the token (now
      // att:true), refreshes the user, and clears mustAttestAge in both state
      // and storage. No reload, no second code path.
      setSession(res);
      setTerms(res.attestation);
      setOpen(false);
      setBusy(false);
      settle(true);
    } catch (err) {
      // Stay open with the reason and a live button. The write is idempotent,
      // so retrying is safe; and if it actually landed and only the response
      // was lost, the fan is already attested and their current token works.
      setError(err instanceof Error ? err.message : 'Could not save your confirmation.');
      setBusy(false);
    }
  }

  const decline = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
    settle(false);
  }, [busy, settle]);

  // Escape closes, exactly like "Not now" -- declining is a normal outcome, not
  // something to trap someone in a dialog over.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decline();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, decline]);

  return (
    <AgeGateContext.Provider value={{ runGated }}>
      {children}
      {open && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) decline();
          }}
        >
          <section
            className="card game modal-card agegate-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agegate-title"
          >
            <div className="modal-head">
              <div>
                <span className="game-kicker">Before you enter</span>
                <h2 id="agegate-title">One quick confirmation</h2>
              </div>
              <button type="button" className="link-btn modal-close" onClick={decline}>
                Close
              </button>
            </div>

            <p className="agegate-lead muted">
              Sharp Foxx contests and Arena games are for players {terms.minAge} and
              over. Confirm once and you won&apos;t be asked again.
            </p>

            {/* The sentence comes from the server, verbatim. Never a literal. */}
            <label className="checkbox-label agegate-affirm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={busy}
              />
              {terms.text}
            </label>

            {/* Not .rep-form-actions — that one is grid-column scoped to the
                .rep-form grid and lays out as nothing outside it. */}
            <div className="agegate-actions">
              <button type="button" onClick={affirm} disabled={!checked || busy}>
                {busy ? 'Confirming…' : 'Confirm and continue'}
              </button>
              <button type="button" className="link-btn" onClick={decline} disabled={busy}>
                Not now
              </button>
            </div>

            {error && <div className="error agegate-error">{error}</div>}

            <p className="agegate-note muted">
              You can keep reading, following and watching either way — this only
              covers entering contests, making picks and playing the Arena.
            </p>
          </section>
        </div>
      )}
    </AgeGateContext.Provider>
  );
}

export function useAgeGate(): AgeGateState {
  const ctx = useContext(AgeGateContext);
  if (!ctx) throw new Error('useAgeGate must be used within <AgeGateProvider>');
  return ctx;
}
