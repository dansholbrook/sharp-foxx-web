'use client';

// ============================================================================
// /account/notifications — what the platform is allowed to tell you.
//
// WHY HERE. /account is already the settings neighbourhood; it just had one
// tenant (/account/password). No roles.ts entry is needed or wanted: unlisted
// paths are open to any authenticated user by default, which is exactly right
// because the backend controller carries no @Roles at all — "every
// authenticated caller has a tray, exactly as every authenticated caller has a
// wallet".
//
// AND NO NAV LINK. The staff nav is already eleven items deep, and roles.ts
// argues at length against permanent links that are dead ends most of the time.
// The door is in the tray's own head, because the moment a user forms the
// intent to mute something is the moment they are looking at the thing that
// annoyed them.
//
// THE SERVER OWNS THE TYPE SET. This screen renders whatever GET
// /notifications/preferences hands back, in the order it hands it back, and
// never asks "am I a rep" — the correspondent rows are simply absent for a user
// with no field_reps row. Which is not the same thing as holding a rep ROLE: a
// bare admin has neither, and asking the token would get it wrong.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  NotificationPreference,
} from '../../api';

// The two headings.
//
// NOT "Fan" and "Correspondent", which is what the audience field is called and
// what a first pass would print. It would be actively confusing here:
// call_graded and call_voided are audience 'fan' while being LABELLED
// "Correspondent's Call results", so a rep would find "Correspondent's Call
// results" filed under a heading marked Fan. What the split actually separates
// is the games you play from the work you do.
const SECTIONS: Array<{
  audience: NotificationPreference['audience'];
  title: string;
  standfirst: string;
}> = [
  {
    audience: 'fan',
    title: 'Your games',
    standfirst:
      'Results, daily cards, and the nudge when a streak is about to break.',
  },
  {
    audience: 'correspondent',
    title: 'Your desk',
    standfirst:
      'The work queue: cards to grade, games assigned to you, and anything closed on your behalf.',
  },
];

export default function NotificationSettingsPage() {
  const router = useRouter();
  const { token } = useAuth();

  const [items, setItems] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The type currently in flight, so one row can show its own progress without
  // freezing the whole screen.
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getNotificationPreferences(token)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load preferences',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Optimistic flip, PATCH behind it, then re-render from the ECHO. PATCH
  // returns the whole resolved list, so the response IS the new state — there
  // is nothing to refetch and no way for this screen to drift from the server's
  // view. On failure the flip is reverted and the error is surfaced: unlike an
  // earn, a setting the user deliberately moved must not fail silently.
  const toggle = useCallback(
    async (pref: NotificationPreference) => {
      if (!token) return;
      const next = !pref.enabled;
      setError(null);
      setSaving(pref.type);
      setItems((prev) =>
        prev
          ? prev.map((p) =>
              p.type === pref.type
                ? { ...p, enabled: next, isDefault: false }
                : p,
            )
          : prev,
      );
      try {
        const res = await updateNotificationPreferences(token, [
          { type: pref.type, enabled: next },
        ]);
        setItems(res.items);
      } catch (err: unknown) {
        setItems((prev) =>
          prev ? prev.map((p) => (p.type === pref.type ? pref : p)) : prev,
        );
        setError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setSaving(null);
      }
    },
    [token],
  );

  if (!token) return null;

  return (
    <main className="feed-home">
      <div className="masthead">
        <span className="masthead-kicker">Account</span>
        <h1 className="masthead-title">Notifications</h1>
        <p className="masthead-standfirst">
          Choose what the platform tells you about. Turning something off stops
          future notifications of that kind — it doesn&apos;t clear anything
          already in your tray.
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      {items === null && !error && (
        <div className="card muted">Loading preferences…</div>
      )}

      {items !== null &&
        SECTIONS.map((section) => {
          const rows = items.filter((p) => p.audience === section.audience);
          // A fan has no desk, and the server has already left those rows out.
          if (rows.length === 0) return null;
          return (
            <section key={section.audience} className="card game notif-prefs">
              <span className="game-kicker">Notifications</span>
              <h2>{section.title}</h2>
              <p className="notif-prefs__standfirst">{section.standfirst}</p>

              {rows.map((pref) => (
                <label key={pref.type} className="notif-pref">
                  <input
                    type="checkbox"
                    checked={pref.enabled}
                    disabled={saving !== null}
                    onChange={() => void toggle(pref)}
                  />
                  <span className="notif-pref__text">
                    <span className="notif-pref__label">
                      {pref.label}
                      {/* What isDefault is FOR: it lets the screen show "on"
                          without claiming the user chose it. */}
                      {pref.isDefault && (
                        <span className="notif-pref__default">Default</span>
                      )}
                    </span>
                    <span className="notif-pref__desc">{pref.description}</span>
                  </span>
                </label>
              ))}
            </section>
          );
        })}
    </main>
  );
}
