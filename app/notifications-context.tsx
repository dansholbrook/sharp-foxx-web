'use client';

// ============================================================================
// THE BELL AND THE TRAY — one shared notification state for the whole app.
//
// WHY A PROVIDER AND NOT STATE INSIDE AppNav. This used to read "<AppNav /> is
// rendered by each of the ~36 authenticated pages inside its own .header-row,
// NOT once in layout.tsx", and that is no longer the arrangement: <SiteHeader/>
// renders the bar once, in layout.tsx, above every page's <main>
// (RESOLVER_TICKETS.md W1).
//
// THE DECISION SURVIVES THE CHANGE THAT INVALIDATED ITS REASON, and it is worth
// saying why rather than quietly leaving it. The old argument was that state in
// AppNav re-runs on every route change; a poller could not live there. AppNav is
// now stable across navigations, so it COULD — but the provider is still the
// right home, because two bells are mounted at once (see the tray note below)
// and a poll hung off a control that exists twice is a poll that runs twice.
// One count, one interval, one tray, above the router.
//
// The Review/NIL queue badges in nav.tsx went the other way for the same
// reason, and the trade is deliberate: they are two best-effort calls that must
// be FRESH rather than shared, so they now re-read on `pathname` to reproduce
// exactly the per-navigation cadence remounting used to give them for free.
//
// This is the points-context.tsx shape — one provider under Auth, one fetch per
// token, a value shared by a control that renders on every screen — with three
// deliberate differences:
//
//   1. IT POLLS. A balance only moves when the fan acts, so the ⚡ chip never
//      needs to re-read. A notification arrives because a SWEEP ran, with no
//      client action anywhere near it.
//   2. THE LIST IS LAZY. GET /notifications/unread-count exists precisely so the
//      always-mounted thing is cheap; the 30-row list is read when the tray
//      opens and not before.
//   3. THE BELL RENDERS AT null. The chip hides until its balance loads because
//      a placeholder "0 pts" misreads as "you're broke". A bell is the only door
//      to the tray, so the BUTTON is unconditional and only the BADGE waits for
//      a real number — no wrong count ever flashes.
//
// The provider renders the tray itself, the way EarnProvider renders its toast
// strip: two bells are mounted at once (the desktop row and the mobile cluster,
// one of them display:none), and a tray hung off the bell would therefore exist
// twice. One panel, rendered once, driven from here.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { SlideOver } from './queue-table';
import {
  getNotificationUnread,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  etTime,
  etDateKey,
  ET_ZONE,
  NotificationAudience,
  NotificationItem,
  NotificationUnread,
} from './api';

// ---------------------------------------------------------------------------
// THE CADENCE.
//
// The house has two: 5s on a live game board (predictions.tsx) and 30s on the
// contest boards, the Arena and the referral dashboards. A bell is neither.
// Nothing in this tray is time-critical to the second — every emit site is a
// sweep, a cron or a grading transaction — so 60s halves the request rate on a
// number nobody is watching, and the return-to-tab refresh below closes any gap
// that actually matters.
// ---------------------------------------------------------------------------
const BELL_POLL_MS = 60_000;

// After this many consecutive failures the poll stops until the next focus /
// visibility event, which resets the counter. Cheap insurance against a tab
// left open against a downed API for six hours: without it, that is 360
// pointless requests; with it, it is five and then silence until the user comes
// back and asks for a fresh answer by returning to the tab.
const MAX_CONSECUTIVE_FAILURES = 5;

// ---------------------------------------------------------------------------
// What the bell needs, and nothing more. The TRAY is rendered by the provider
// with props, so its state never has to travel through the context — only the
// three things a button in the nav has to know.
// ---------------------------------------------------------------------------
interface NotificationsState {
  // null until the first read resolves (or while signed out). The badge renders
  // only from a real number.
  unread: NotificationUnread | null;
  open: boolean;
  openTray: () => void;
}

const NotificationsContext = createContext<NotificationsState | undefined>(
  undefined,
);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { token } = useAuth();

  const [unread, setUnread] = useState<NotificationUnread | null>(null);
  const [open, setOpen] = useState(false);
  // null = everything, which is the state where nothing is hidden.
  const [filter, setFilter] = useState<NotificationAudience | null>(null);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Read by the interval's closure, which is created once per token and must
  // not be torn down and rebuilt every time the panel opens.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const failures = useRef(0);
  // Whatever had focus when the tray was opened — one of the two bells, since
  // the click is what put focus there. SlideOver moves focus INTO the panel but
  // leaves returning it to the caller (queue-table.tsx says so), and there are
  // two bells mounted, so capturing the element beats guessing which one.
  const opener = useRef<HTMLElement | null>(null);

  // -------------------------------------------------------------------------
  // THE BADGE READ.
  //
  // FAILS SILENTLY, and that is the deliberate half of an asymmetry the tray
  // completes: this is a garnish on the nav that nobody asked for, exactly like
  // the ⚡ chip and the earn toasts, so a failed read leaves the last good count
  // on screen and says nothing. The TRAY, by contrast, surfaces its errors in a
  // red box, because the user explicitly opened it. Both halves are intentional;
  // seeing only one of them looks like an oversight.
  //
  // THE 401 IS LET THROUGH ON PURPOSE. toAuthError() inside api.ts fires the
  // central teardown in auth-context, so once this poll exists an expired token
  // bounces an idle user to the login page where today they would only find out
  // on their next click. That is a real behaviour change and it is the better
  // behaviour. Suppressing it would mean a bespoke fetch outside app/api.ts —
  // breaking a golden rule to preserve a worse outcome — so it stays.
  // -------------------------------------------------------------------------
  const refreshUnread = useCallback(async () => {
    if (!token) return;
    try {
      const next = await getNotificationUnread(token);
      setUnread(next);
      failures.current = 0;
    } catch {
      failures.current += 1;
    }
  }, [token]);

  // Load once per token, then poll. Signing out clears everything, so a second
  // user on the same browser never inherits a stale badge.
  useEffect(() => {
    if (!token) {
      setUnread(null);
      setItems(null);
      setLimit(null);
      setListError(null);
      setOpen(false);
      setFilter(null);
      failures.current = 0;
      return;
    }

    failures.current = 0;
    // Unconditional, unlike the ticks below: a tab that happens to be in the
    // background at login should still have a correct badge waiting on it.
    void refreshUnread();

    const timer = window.setInterval(() => {
      // Hidden tab: skip entirely. Browsers already throttle background timers,
      // but a skipped fetch is a fetch that did not happen, and a tab left open
      // for six hours is overwhelmingly a BACKGROUND tab — this single guard is
      // what makes that case cost nothing.
      if (document.visibilityState !== 'visible') return;
      // Tray open: the panel's own read already returned an authoritative count,
      // and a list reshuffling under a reading finger is the thing to avoid.
      if (openRef.current) return;
      if (failures.current >= MAX_CONSECUTIVE_FAILURES) return;
      void refreshUnread();
    }, BELL_POLL_MS);

    return () => window.clearInterval(timer);
  }, [token, refreshUnread]);

  // Coming back to the tab asks for a fresh answer immediately, and forgives
  // whatever failed while away. BOTH events, because `focus` alone misses the
  // tab-switch case in some browsers and `visibilitychange` alone misses
  // window-to-window focus on desktop — the ways-to-earn.tsx idiom, where a
  // duplicate read costs exactly one request.
  useEffect(() => {
    if (!token) return;
    function wake() {
      failures.current = 0;
      void refreshUnread();
    }
    function onVisible() {
      if (document.visibilityState === 'visible') wake();
    }
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, refreshUnread]);

  // -------------------------------------------------------------------------
  // THE LIST. Read on open and on every filter change. The response's `unread`
  // block is authoritative and arrives WHOLE even on a filtered read, so it is
  // taken here too — one call keeps the badge and the panel in step.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    // Set unconditionally; the panel renders the loader only when it has no rows
    // to show, so reopening with rows already in hand refreshes underneath them
    // rather than flashing a spinner over a list the user has seen before.
    setListLoading(true);
    setListError(null);
    getNotifications(token, { audience: filter ?? undefined })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setUnread(res.unread);
        setLimit(res.limit);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // LOUD, unlike the badge above: the user opened this panel on purpose,
        // so a failure is theirs to see. Same "<status> <message>" the rest of
        // the app surfaces.
        setListError(
          err instanceof Error ? err.message : 'Failed to load notifications',
        );
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token, filter]);

  const openTray = useCallback(() => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOpen(true);
  }, []);

  const closeTray = useCallback(() => {
    setOpen(false);
    // Put the keyboard back where it was. The bells never unmount, so this is
    // safe to do immediately; isConnected covers the paranoid case.
    if (opener.current?.isConnected) opener.current.focus();
    opener.current = null;
    // The filter does NOT survive a close. A tray whose default state hid half
    // its contents would let a rep who once filtered to their desk stop seeing
    // fan notifications indefinitely; "everything" is the only safe resting
    // state. The rows themselves are kept, so reopening refreshes rather than
    // reloading from empty.
    setFilter(null);
  }, []);

  // -------------------------------------------------------------------------
  // MARK ONE READ. The follows-context idiom: flip optimistically, POST behind
  // it, revert on failure. The endpoint is idempotent, so a retry is free and an
  // already-read row is skipped entirely rather than sent a no-op.
  //
  // The count is decremented optimistically because — unlike a pick or an earn —
  // the response carries the updated ROW but no fresh counts. Any drift is
  // corrected by the next poll.
  // -------------------------------------------------------------------------
  const markRead = useCallback(
    async (item: NotificationItem) => {
      if (!token || item.read) return;

      setItems((prev) =>
        prev
          ? prev.map((i) =>
              i.id === item.id
                ? { ...i, read: true, readAt: new Date().toISOString() }
                : i,
            )
          : prev,
      );
      setUnread((prev) =>
        prev
          ? {
              total: Math.max(0, prev.total - 1),
              fan: prev.fan - (item.audience === 'fan' ? 1 : 0),
              correspondent:
                prev.correspondent - (item.audience === 'correspondent' ? 1 : 0),
            }
          : prev,
      );

      try {
        await markNotificationRead(token, item.id);
      } catch {
        // Put it back exactly as it was. The 401 path inside the client still
        // tears the session down.
        setItems((prev) =>
          prev ? prev.map((i) => (i.id === item.id ? item : i)) : prev,
        );
        setUnread((prev) =>
          prev
            ? {
                total: prev.total + 1,
                fan: prev.fan + (item.audience === 'fan' ? 1 : 0),
                correspondent:
                  prev.correspondent +
                  (item.audience === 'correspondent' ? 1 : 0),
              }
            : prev,
        );
      }
    },
    [token],
  );

  // -------------------------------------------------------------------------
  // MARK ALL READ.
  //
  // `before` IS THE createdAt OF THE NEWEST ROW ON SCREEN, never `now`. The
  // server requires the boundary so the client has to state WHAT IT SAW: a
  // notification that arrives between the render and the tap must not be marked
  // read having never been displayed, and there is no unread-again. Sending
  // new Date().toISOString() would satisfy the type and reintroduce the exact
  // bug the parameter exists to prevent.
  //
  // The response's `unread` is the server's own post-write figure, so the badge
  // moves from it rather than from a refetch.
  // -------------------------------------------------------------------------
  const markAllRead = useCallback(async () => {
    if (!token || !items || items.length === 0) return;
    const before = items[0].createdAt;
    try {
      const res = await markAllNotificationsRead(token, before);
      setUnread(res.unread);
      // Everything rendered is at or below the boundary (the list is newest
      // first and the boundary is its head), so every row on screen is read.
      const now = new Date().toISOString();
      setItems((prev) =>
        prev
          ? prev.map((i) => (i.read ? i : { ...i, read: true, readAt: now }))
          : prev,
      );
    } catch (err: unknown) {
      setListError(
        err instanceof Error ? err.message : 'Failed to mark all read',
      );
    }
  }, [token, items]);

  // Tapping a notification: mark it, close the panel, go to the one-tap action.
  // The path is routed exactly as the backend sent it — see app/api.ts on why
  // there is no resolver in between.
  const activate = useCallback(
    (item: NotificationItem) => {
      void markRead(item);
      closeTray();
      router.push(item.deepLink);
    },
    [markRead, closeTray, router],
  );

  const value = useMemo<NotificationsState>(
    () => ({ unread, open, openTray }),
    [unread, open, openTray],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationTray
        open={open}
        items={items}
        unread={unread}
        limit={limit}
        filter={filter}
        loading={listLoading}
        error={listError}
        onClose={closeTray}
        onFilter={setFilter}
        onActivate={activate}
        onMarkAll={markAllRead}
      />
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx)
    throw new Error(
      'useNotifications must be used within <NotificationsProvider>',
    );
  return ctx;
}

// ===========================================================================
// THE BELL
//
// ONE bell, in two states. A rep is also a fan on the same account, so their
// work queue and their game results are one person's two contexts rather than
// two people — and a second permanent icon for the correspondent side would be
// the dead end roles.ts already refuses the correspondent a nav link over ("a
// rep holds a Call perhaps a few weeks a year; a permanent link that is a dead
// end most of the time is worse than none"). It would also be empty for every
// fan, forever.
//
// So the badge shows the WHOLE count — outside the tray, the question a badge
// answers is "is there anything?", which is not a segmented question — and the
// segmentation is carried by the glyph: outline normally, filled gold when
// anything is waiting on the rep's desk. The split becomes explicit only inside
// the tray, where it is actionable. State, not multiplicity.
// ===========================================================================
export function NotificationBell() {
  const { token } = useAuth();
  const { unread, open, openTray } = useNotifications();

  // AppNav only renders on authenticated screens, but it stays mounted through
  // the beat between logout and the redirect.
  if (!token) return null;

  const total = unread?.total ?? null;
  const desk = (unread?.correspondent ?? 0) > 0;

  const label =
    total === null
      ? 'Notifications'
      : total === 0
        ? 'Notifications, none unread'
        : desk
          ? `Notifications, ${total} unread, ${unread?.correspondent} on your desk`
          : `Notifications, ${total} unread`;

  return (
    <button
      type="button"
      className={`notif-bell${desk ? ' notif-bell--desk' : ''}`}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openTray}
    >
      <svg
        className="notif-bell__icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="notif-bell__body"
          d="M12 3.2a5 5 0 0 0-5 5v3.4L5.3 14.9h13.4L17 11.6V8.2a5 5 0 0 0-5-5Z"
        />
        <path className="notif-bell__clapper" d="M9.7 17.4a2.3 2.3 0 0 0 4.6 0" />
      </svg>
      {/* Reuses the gold .nav-badge pill the Review/NIL queue counts already
          wear; .notif-bell__badge only repositions it onto the glyph. Rendered
          from a real number or not at all. */}
      {total !== null && total > 0 && (
        <span className="nav-badge notif-bell__badge">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  );
}

// ===========================================================================
// THE TRAY
//
// A SlideOver, not a page. The primitive already does every hard part — Esc, a
// backdrop click, the scroll lock, focus into the panel, a fixed head, a
// scrolling body, a sticky footer, full width under 560px and a reduced-motion
// opt-out — and its head/body/footer split is the tray's shape exactly. A page
// would cost a route, a nav item that is a dead end, and the user's place on
// whatever they were reading. A notification is a detour, not a destination.
// ===========================================================================

// The type's home, as a reader-facing kicker. DERIVED FROM `type` because the
// list endpoint does not return `game` — only GET /notifications/preferences
// does — so the mapping has to live somewhere and one place is better than
// three. An unrecognised type falls back to the house name rather than to a raw
// snake_case key.
function kickerFor(item: NotificationItem): string {
  if (item.audience === 'correspondent') return 'Your desk';
  if (item.type.startsWith('call_')) return "Correspondent's Call";
  if (item.type.startsWith('oracle_')) return 'Beat the Oracle';
  if (item.type.startsWith('trail_')) return 'Foxx Trail';
  // THE FIRST TYPE HERE THAT IS NOT AN ARENA GAME. Its kicker is "Contests"
  // rather than "Tonight's Pick'em" because this line labels the row's HOME —
  // the surface the deep link opens — and the pick'em's home is the contest
  // lobby, which the fan already knows by that name from the nav and the feed
  // band. The title carries the specific.
  if (item.type.startsWith('pickem_')) return 'Contests';
  if (item.type === 'streak_jeopardy') return 'Your streak';
  return 'Sharp Foxx';
}

// The day a notification belongs to, named. Driven by `sentOnEt` — the ET
// calendar day the PLATFORM filed it under — and never by the viewer's timezone
// applied to createdAt, which would put a 9pm ET result under a different day
// for two fans looking at the same event.
//
// sentOnEt is a BARE DATE, so it gets the house local-noon-UTC parse rather than
// going through the ET instant helpers (see the timezone header in api.ts), and
// it is then formatted IN ET so the label can never disagree with the key it
// came from.
function dayLabel(sentOnEt: string): string {
  const now = Date.now();
  if (sentOnEt === etDateKey(new Date(now).toISOString())) return 'Today';
  if (sentOnEt === etDateKey(new Date(now - 86_400_000).toISOString()))
    return 'Yesterday';
  const d = new Date(`${sentOnEt}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return sentOnEt;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: ET_ZONE,
  });
}

// Newest-first means same-day rows are already contiguous, so grouping is a
// single pass with no sort and no map.
function groupByDay(
  items: NotificationItem[],
): Array<{ key: string; label: string; rows: NotificationItem[] }> {
  const groups: Array<{ key: string; label: string; rows: NotificationItem[] }> =
    [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.key === item.sentOnEt) last.rows.push(item);
    else
      groups.push({
        key: item.sentOnEt,
        label: dayLabel(item.sentOnEt),
        rows: [item],
      });
  }
  return groups;
}

function NotificationTray({
  open,
  items,
  unread,
  limit,
  filter,
  loading,
  error,
  onClose,
  onFilter,
  onActivate,
  onMarkAll,
}: {
  open: boolean;
  items: NotificationItem[] | null;
  unread: NotificationUnread | null;
  limit: number | null;
  filter: NotificationAudience | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onFilter: (next: NotificationAudience | null) => void;
  onActivate: (item: NotificationItem) => void;
  onMarkAll: () => void;
}) {
  if (!open) return null;

  const rows = items ?? [];

  // The desk filter appears only for someone who has a desk. Either arm alone
  // is wrong: the count alone hides the chip the moment a rep reads their last
  // work item (while filtered BY it), and the rows alone hide it whenever the
  // 30-row page happens to hold no correspondent rows.
  const hasDesk =
    (unread?.correspondent ?? 0) > 0 ||
    rows.some((r) => r.audience === 'correspondent');

  // ---- F5: MARK ALL READ IS HIDDEN WHILE A FILTER IS ACTIVE -----------------
  // POST /notifications/read-all takes a `before` boundary and NO audience — it
  // is a blanket clear over everything older than the timestamp. Offering it on
  // a filtered view would take the boundary from the newest DESK row and
  // silently mark every fan notification older than that read, with no way back.
  //
  // Hidden rather than disabled: a disabled button invites the user to work out
  // why, and there is nothing to work out. The correct move is to clear the
  // filter, which is one chip away and already on screen.
  // --------------------------------------------------------------------------
  const canMarkAll =
    filter === null && rows.length > 0 && (unread?.total ?? 0) > 0;

  // ---- F6: say so when the badge and the list disagree ----------------------
  // The badge counts everything; the list is at most one fixed page and may be
  // filtered besides. Left unsaid, a bell reading 46 above a panel holding 30
  // rows reads as a bug. The two branches are exhaustive: unfiltered and
  // untruncated, the list holds every row, so the counts cannot disagree.
  //
  // Gated on items !== null so a first open with a non-zero badge and no rows
  // YET doesn't briefly claim a disagreement that is only a load in flight.
  // --------------------------------------------------------------------------
  const disagrees = items !== null && unread !== null && unread.total > rows.length;
  const truncated = limit !== null && rows.length >= limit;
  const note = !disagrees
    ? null
    : truncated
      ? `Showing your last ${limit} — your badge counts all ${unread.total} unread.`
      : `Filtered — your badge counts all ${unread.total} unread.`;

  const footer =
    canMarkAll || note ? (
      <>
        {canMarkAll && (
          <button type="button" className="btn-ghost" onClick={onMarkAll}>
            Mark all read
          </button>
        )}
        {note && <p className="notif-foot__note">{note}</p>}
      </>
    ) : undefined;

  return (
    <SlideOver
      onClose={onClose}
      kicker={filter === 'correspondent' ? 'Your desk' : 'Your games and work'}
      title="Notifications"
      label="Notifications"
      footer={footer}
    >
      <div className="notif-toolbar">
        <div
          className="notif-filters"
          role="group"
          aria-label="Filter notifications"
        >
          <button
            type="button"
            className={`chip${filter === null ? ' chip--on' : ''}`}
            aria-pressed={filter === null}
            onClick={() => onFilter(null)}
          >
            All
          </button>
          {hasDesk && (
            <button
              type="button"
              className={`chip${filter === 'correspondent' ? ' chip--on' : ''}`}
              aria-pressed={filter === 'correspondent'}
              onClick={() => onFilter('correspondent')}
            >
              Your desk
              {(unread?.correspondent ?? 0) > 0 ? ` (${unread?.correspondent})` : ''}
            </button>
          )}
        </div>
        {/* The settings door lives HERE rather than in the nav: the moment a
            user forms the intent to mute something is the moment they are
            looking at the thing annoying them. Closing the tray first so the
            panel is not left open over the page it navigated away from. */}
        <Link
          href="/account/notifications"
          className="notif-toolbar__settings"
          onClick={onClose}
        >
          Settings
        </Link>
      </div>

      {/* LOUD, deliberately — the mirror of the badge's silence. See the note on
          refreshUnread above; the asymmetry is the design, not an oversight. */}
      {error && <div className="error">{error}</div>}

      {loading && rows.length === 0 && !error && (
        <div className="card muted">Loading notifications…</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="results-empty">
          {filter === 'correspondent' ? (
            <>
              <p className="results-empty__title">No work on your desk</p>
              <p className="results-empty__hint">
                When a Call needs grading, or a game is assigned to or closed for
                you, it lands here.
              </p>
            </>
          ) : (
            <>
              <p className="results-empty__title">Nothing yet</p>
              <p className="results-empty__hint">
                When a game you&apos;ve played is graded, it lands here.{' '}
                <Link href="/arena" onClick={onClose}>
                  Open the Arena
                </Link>{' '}
                and make a call.
              </p>
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="notif-list">
          {groupByDay(rows).map((group) => (
            <section key={group.key} className="notif-day">
              <h3 className="notif-day__label">{group.label}</h3>
              {group.rows.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onActivate={onActivate}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </SlideOver>
  );
}

// One row. Read state carries THREE cues and none of them is colour alone: the
// ground (--panel vs --panel-raised), a 2px gold rail down the left edge, and
// the title's weight and colour. A user who cannot distinguish the gold still
// has the rail's presence and the weight.
//
// The accessible name is composed rather than left to the inner text, so the
// read state — which is otherwise purely visual — is announced too.
function NotificationRow({
  item,
  onActivate,
}: {
  item: NotificationItem;
  onActivate: (item: NotificationItem) => void;
}) {
  const time = etTime(item.createdAt, { zone: true });
  return (
    <button
      type="button"
      className={`notif-item${item.read ? '' : ' notif-item--unread'}`}
      aria-label={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}${
        time ? ` ${time}` : ''
      }`}
      onClick={() => onActivate(item)}
    >
      <span className="notif-item__top">
        <span className="notif-item__kicker">{kickerFor(item)}</span>
        <span className="notif-item__time">{time}</span>
      </span>
      <span className="notif-item__title">{item.title}</span>
      <span className="notif-item__body">{item.body}</span>
    </button>
  );
}
