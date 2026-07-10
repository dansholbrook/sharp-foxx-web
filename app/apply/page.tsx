'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createApplication, ApplyValidationError, ApplyInput } from '../api';

// The two tracks, rendered as large radio cards (not a dropdown). Copy mirrors
// the recruiting header so an applicant sees the same pitch at the point of
// choosing. value maps 1:1 onto applications.track on the backend.
const TRACKS: Array<{
  value: ApplyInput['track'];
  title: string;
  blurb: string;
}> = [
  {
    value: 'field_rep',
    title: 'Correspondent',
    blurb: 'Cover local games, publish stories, and earn from local ad sales.',
  },
  {
    value: 'regional_manager',
    title: 'Regional Manager',
    blurb: 'Build and lead a local team of correspondents.',
  },
];

// Client-side mirror of createApplicationSchema so an applicant gets instant,
// per-field feedback before the round trip. Keyed by the same field names the
// server's zod flatten() returns, so a later server 400 slots into the same map.
function validate(v: {
  fullName: string;
  email: string;
  city: string;
  state: string;
  track: ApplyInput['track'] | '';
  hasSmartphone: boolean | null;
  pitch: string;
  resumeUrl: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.fullName.trim().length < 2) errors.fullName = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (v.city.trim().length < 2) errors.city = 'Enter your city.';
  if (v.state.trim().length < 2) errors.state = 'Enter your state.';
  if (!v.track) errors.track = 'Choose a track.';
  if (v.hasSmartphone === null) errors.hasSmartphone = 'Please let us know.';
  if (v.pitch.trim().length < 30) {
    errors.pitch = 'Tell us a little more — at least 30 characters.';
  }
  if (v.resumeUrl.trim() && !/^https?:\/\/.+/i.test(v.resumeUrl.trim())) {
    errors.resumeUrl = 'Enter a full http(s):// link, or leave it blank.';
  }
  return errors;
}

// A minimal branded public header for the unauthenticated /apply page: the
// Sharp Foxx wordmark and a small "Sign in" link back to the dev login. NOT the
// logged-in AppNav -- this page never touches the auth session.
function PublicHeader() {
  return (
    <div className="header-row">
      <span className="wordmark">Sharp Foxx</span>
      <Link href="/" className="link-btn">
        Sign in
      </Link>
    </div>
  );
}

const PITCH_MIN = 30;

export default function ApplyPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [track, setTrack] = useState<ApplyInput['track'] | ''>('');
  const [hasSmartphone, setHasSmartphone] = useState<boolean | null>(null);
  const [pitch, setPitch] = useState('');
  const [resumeUrl, setResumeUrl] = useState('');

  // Per-field messages (client mirror OR server zod flatten). generalError is
  // for the non-field cases (409 duplicate, network); dup flips the Sign in nudge.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const pitchLen = pitch.trim().length;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setIsDuplicate(false);

    const errors = validate({
      fullName,
      email,
      city,
      state,
      track,
      hasSmartphone,
      pitch,
      resumeUrl,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const input: ApplyInput = {
      fullName: fullName.trim(),
      email: email.trim(),
      city: city.trim(),
      state: state.trim(),
      track: track as ApplyInput['track'],
      hasSmartphone: hasSmartphone as boolean,
      pitch: pitch.trim(),
    };
    if (phone.trim()) input.phone = phone.trim();
    if (resumeUrl.trim()) input.resumeUrl = resumeUrl.trim();

    setSubmitting(true);
    try {
      await createApplication(input);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApplyValidationError) {
        // Collapse the server's per-field arrays to one message each and render
        // them inline against the same inputs the client mirror uses.
        const flat: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) {
          if (msgs?.length) flat[k] = msgs[0];
        }
        setFieldErrors(flat);
        if (err.formErrors.length) setGeneralError(err.formErrors[0]);
      } else {
        const msg = err instanceof Error ? err.message : 'Something went wrong.';
        setGeneralError(msg);
        // A 409 means the email already applied or already has an account -->
        // nudge them to sign in rather than re-apply.
        setIsDuplicate(msg.startsWith('409'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Success: replace the whole form with a branded confirmation. ----
  if (submitted) {
    return (
      <main className="apply-page">
        <PublicHeader />
        <div className="masthead">
          <span className="masthead-kicker">Recruiting</span>
          <h1 className="masthead-title">Application received</h1>
          <p className="masthead-standfirst">
            Thanks for applying to the Sharp Foxx network — we&apos;ll be in touch.
          </p>
        </div>
        <section className="card game apply-confirm">
          <p className="apply-confirm__lead">
            Your application is in front of our regional team. If it&apos;s a fit,
            we&apos;ll email you a sign-in ID to get started.
          </p>
          <Link href="/" className="btn-inline apply-confirm__cta">
            Back to sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="apply-page">
      <PublicHeader />

      <div className="masthead">
        <span className="masthead-kicker">Join the network</span>
        <h1 className="masthead-title">Join the Sharp Foxx network</h1>
        <p className="masthead-standfirst">
          Two ways in. <strong>Correspondent:</strong> cover local games, publish
          stories, and earn from local ad sales.{' '}
          <strong>Regional Manager:</strong> build and lead a local team.
        </p>
      </div>

      <section className="card game apply-card">
        <span className="game-kicker">Apply</span>
        <h2>Tell us about you</h2>

        <form onSubmit={onSubmit} className="rep-form apply-form" noValidate>
          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jordan Fox"
              autoComplete="name"
            />
            {fieldErrors.fullName && (
              <span className="apply-field-error">{fieldErrors.fullName}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@example.com"
              autoComplete="email"
              spellCheck={false}
            />
            {fieldErrors.email && (
              <span className="apply-field-error">{fieldErrors.email}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="phone">Phone (optional)</label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              autoComplete="tel"
            />
            {fieldErrors.phone && (
              <span className="apply-field-error">{fieldErrors.phone}</span>
            )}
          </div>

          <div className="field apply-city-state">
            <div className="field">
              <label htmlFor="city">City</label>
              <input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Springfield"
                autoComplete="address-level2"
              />
              {fieldErrors.city && (
                <span className="apply-field-error">{fieldErrors.city}</span>
              )}
            </div>
            <div className="field">
              <label htmlFor="state">State</label>
              <input
                id="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="Illinois"
                autoComplete="address-level1"
              />
              {fieldErrors.state && (
                <span className="apply-field-error">{fieldErrors.state}</span>
              )}
            </div>
          </div>

          <div className="field field--wide">
            <label>Which track?</label>
            <div className="track-cards">
              {TRACKS.map((t) => (
                <label
                  key={t.value}
                  className={`track-card${
                    track === t.value ? ' track-card--selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="track"
                    value={t.value}
                    checked={track === t.value}
                    onChange={() => setTrack(t.value)}
                    className="track-card__input"
                  />
                  <span className="track-card__title">{t.title}</span>
                  <span className="track-card__blurb">{t.blurb}</span>
                </label>
              ))}
            </div>
            {fieldErrors.track && (
              <span className="apply-field-error">{fieldErrors.track}</span>
            )}
          </div>

          <div className="field field--wide">
            <label>
              Do you have a smartphone capable of recording HD video?
            </label>
            <div className="yn-group">
              {[
                { label: 'Yes', value: true },
                { label: 'No', value: false },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  className={`yn-option${
                    hasSmartphone === opt.value ? ' yn-option--selected' : ''
                  }`}
                  onClick={() => setHasSmartphone(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {fieldErrors.hasSmartphone && (
              <span className="apply-field-error">{fieldErrors.hasSmartphone}</span>
            )}
          </div>

          <div className="field field--wide">
            <label htmlFor="pitch">Tell us about your local sports scene</label>
            <textarea
              id="pitch"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              rows={5}
              placeholder="The teams, the rivalries, the venues — and why you're the one to cover them."
              className="apply-textarea"
            />
            <span
              className={`apply-pitch-count${
                pitchLen >= PITCH_MIN ? ' apply-pitch-count--ok' : ''
              }`}
            >
              {pitchLen < PITCH_MIN
                ? `${pitchLen}/${PITCH_MIN} characters — ${PITCH_MIN - pitchLen} to go`
                : `${pitchLen} characters`}
            </span>
            {fieldErrors.pitch && (
              <span className="apply-field-error">{fieldErrors.pitch}</span>
            )}
          </div>

          <div className="field field--wide">
            <label htmlFor="resumeUrl">Resume or LinkedIn URL (optional)</label>
            <input
              id="resumeUrl"
              value={resumeUrl}
              onChange={(e) => setResumeUrl(e.target.value)}
              placeholder="https://linkedin.com/in/you"
              autoComplete="url"
              spellCheck={false}
            />
            {fieldErrors.resumeUrl && (
              <span className="apply-field-error">{fieldErrors.resumeUrl}</span>
            )}
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit application'}
            </button>
          </div>

          {generalError && (
            <div className="error rep-form-msg">
              {generalError}
              {isDuplicate && (
                <>
                  {' '}
                  Already have an account?{' '}
                  <Link href="/" className="apply-signin-link">
                    Sign in
                  </Link>
                  .
                </>
              )}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
