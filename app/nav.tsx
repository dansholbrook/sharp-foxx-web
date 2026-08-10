'use client';

import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { usePoints } from './points-context';
import { NotificationBell } from './notifications-context';
import { navLinksFor } from './roles';
import { getReviewQueue, getNilReviewQueue, points } from './api';

// The fan's points identity: a compact ⚡ chip that rides the nav on every page
// and links to their profile. Renders only once the wallet has actually
// loaded — never a placeholder "0 pts", which would misread as "you're broke" to
// a fan who simply hasn't been fetched yet.
//
// Shown to EVERY role, not just fans: any authenticated caller can pick (the
// backend deliberately allows staff to play along), so any of them can hold a
// balance.
//
// IT POINTS AT /profile, NOT /picks. The chip is the fan's identity in the nav,
// and /profile is where that identity lives whole — standing on both boards,
// streaks, badges, the ledger.
//
// It is no longer staff's ONLY door to /profile — the avatar menu now carries
// My profile and My picks for every role — but it stays, because a live balance
// on screen is a different thing from a link to where the balance lives.
function PointsChip() {
  const { balance } = usePoints();
  if (balance === null) return null;
  return (
    <Link href="/profile" className="points-chip" title="Your points and profile">
      <span className="points-chip__bolt" aria-hidden="true">
        ⚡
      </span>
      <span className="points-chip__value">{points(balance)}</span>
      <span className="points-chip__unit">pts</span>
    </Link>
  );
}

// ===========================================================================
// THE MENU PRIMITIVE
//
// A button-anchored popover, used twice: by the avatar and by Console. Built
// rather than borrowed, because nothing here was the right shape:
//
//   - SlideOver (queue-table.tsx) is a MODAL — dimmed backdrop, aria-modal,
//     scroll lock, focus moved into the panel. Correct for a review queue you
//     sit inside; far too much furniture for five account links, and
//     aria-modal on a menu is simply untrue.
//   - The team/school pickers close on an onBlur + 120ms setTimeout race. That
//     hack exists to let a click land on an option before the list unmounts,
//     it is bound to a text input, and it would make this unusable by keyboard.
//
// What IS borrowed is the bell's discipline about focus (notifications-context
// openTray/closeTray): a control that opens something must put the keyboard
// back where it found it. For a menu the opener is always the trigger itself,
// so this holds a ref to the trigger rather than reading document.activeElement.
//
// NOT a focus trap and NOT a scroll lock. Menus don't; modals do.
// ===========================================================================
function NavMenu({
  triggerClassName,
  triggerLabel,
  triggerContent,
  panelClassName,
  children,
}: {
  triggerClassName: string;
  triggerLabel: string;
  triggerContent: ReactNode;
  panelClassName?: string;
  // Given `close` so an item can dismiss the menu on its way somewhere. Route
  // changes close it anyway; this covers the items that don't navigate.
  children: (close: () => void) => ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes and hands the keyboard back to the trigger. Split from the
  // outside-click path below on purpose: dismissing with the mouse should not
  // yank focus across the page, but dismissing with the keyboard must leave it
  // somewhere the keyboard can carry on from.
  const closeToTrigger = useCallback(() => {
    setOpen(false);
    if (triggerRef.current?.isConnected) triggerRef.current.focus();
  }, []);

  // A route change dismisses it — the same idiom the mobile sheet uses, so
  // tapping a destination doesn't leave the menu hanging over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    // pointerdown, not click: the menu must be gone before whatever was clicked
    // underneath it reacts, and a click that starts inside and ends outside
    // (a drag over a label) is not a dismissal.
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeToTrigger();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeToTrigger]);

  // Arrow-key roving over whatever the panel happens to contain. Reading the
  // items off the DOM rather than making callers hand over a list keeps the
  // children plain JSX — an item is anything wearing role="menuitem".
  function moveFocus(delta: number, from?: 'edge') {
    const items = rootRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    );
    if (!items || items.length === 0) return;
    const list = Array.from(items);
    const current = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (from === 'edge' || current === -1) {
      next = delta > 0 ? 0 : list.length - 1;
    } else {
      next = (current + delta + list.length) % list.length;
    }
    list[next]?.focus();
  }

  // Opening with an arrow lands on the near end of the list; opening with a
  // click or Enter just shows the menu, and the effect below moves focus in.
  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) moveFocus(e.key === 'ArrowDown' ? 1 : -1, 'edge');
      else setOpen(true);
    }
  }

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus(1, 'edge');
    } else if (e.key === 'End') {
      e.preventDefault();
      moveFocus(-1, 'edge');
    } else if (e.key === 'Tab') {
      // Tabbing out of a menu is a dismissal, not a trap — let the browser move
      // focus normally and just take the panel down with it.
      setOpen(false);
    }
  }

  // Land the keyboard on the first item whenever the menu opens, however it was
  // opened. A mouse user gets a focus ring they didn't ask for; a keyboard user
  // gets a menu they can actually walk. That trade favours the keyboard.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [open]);

  return (
    <div className="nav-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {triggerContent}
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`nav-menu__panel${panelClassName ? ` ${panelClassName}` : ''}`}
          role="menu"
          aria-label={triggerLabel}
          onKeyDown={onPanelKeyDown}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

// Up to two letters off the display name. THIS IS THE WHOLE AVATAR — there is
// no avatar image anywhere on this platform, no upload, and nothing in the
// schema, so inventing an image path would mean inventing the backend that
// serves it. Initials on the accent ground cost nothing and carry the one thing
// the circle needs to carry: which account you are currently signed in as,
// which matters here because staff switch between them constantly.
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// The account menu. Identical for every signed-in role, which is why its items
// are written out here rather than filtered out of roles.ts.
function AvatarMenu({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  // displayName is required by the login response, but a blank one would put a
  // literal "?" in the circle rather than falling through, so test the name
  // before deriving from it — initialsFor never returns an empty string.
  const name = user.displayName?.trim() || user.id;
  const initials = initialsFor(name);

  return (
    <NavMenu
      triggerClassName="nav-avatar"
      triggerLabel={`Account: ${name}`}
      triggerContent={<span aria-hidden="true">{initials}</span>}
      panelClassName="nav-menu__panel--account"
    >
      {(close) => (
        <>
          {/* THE SIGN-IN LINE, AND ITS ONLY HOME. Every page used to print
              "Signed in as … · role" into its own header; that markup is now
              hidden at all widths (see globals.css) and this is where the fact
              lives. Behind a tap it costs no width, so it is shown to every
              role rather than staff only — the reason it mattered was that
              staff switch accounts, and the initials in the circle already
              answer that at a glance for everyone. */}
          <div className="nav-menu__head">
            <span className="nav-menu__name">{name}</span>
            {user.roles?.length ? (
              <span className="nav-menu__roles">{user.roles.join(', ')}</span>
            ) : null}
          </div>

          <Link href="/profile" role="menuitem" className="nav-menu__item">
            My profile
          </Link>
          <Link href="/picks" role="menuitem" className="nav-menu__item">
            My picks
          </Link>
          {/* A SECOND DOOR, NOT A RELOCATION. The tray keeps its own Settings
              link and keeps its reasoning: the moment someone forms the intent
              to mute something is the moment they are looking at the thing
              annoying them. This one serves the other intent — "I know I want
              to change my settings" — which arrives nowhere near the tray. */}
          <Link
            href="/account/notifications"
            role="menuitem"
            className="nav-menu__item"
          >
            Notification settings
          </Link>
          <Link
            href="/account/password"
            role="menuitem"
            className="nav-menu__item"
          >
            Change password
          </Link>

          <div className="nav-menu__rule" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="nav-menu__item"
            onClick={() => {
              close();
              onLogout();
            }}
          >
            Log out
          </button>
        </>
      )}
    </NavMenu>
  );
}

// The header nav links, filtered to what the signed-in role can actually use
// (see navLinksFor). Logout clears the in-memory session and bounces to the
// login page -- the same behavior every page had.
export function AppNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, logout } = useAuth();

  // The hamburger menu (only rendered/visible under 768px). Closes on route
  // change so tapping a link dismisses it, and locks page scroll while open.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function onLogout() {
    setMenuOpen(false);
    logout();
    router.replace('/');
  }

  const { sections, console: consoleLinks } = navLinksFor(user?.roles ?? []);

  // Badge the Review link with the queue count. One best-effort fetch on mount
  // (no polling); a failure or an empty queue simply shows no badge. Only staff
  // who can reach /review ever see the link, so gate the fetch on that too.
  const canReview = (user?.roles ?? []).some(
    (r) => r === 'admin' || r === 'regional_manager',
  );
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  // The NIL review queue count gets the same best-effort badge treatment; the
  // gate is identical (admin/regional_manager), so it rides on the same flag.
  const [nilReviewCount, setNilReviewCount] = useState<number | null>(null);
  useEffect(() => {
    if (!token || !canReview) return;
    let cancelled = false;
    getReviewQueue(token)
      .then((items) => {
        if (!cancelled) setReviewCount(items.length);
      })
      .catch(() => {
        /* leave the badge off on failure */
      });
    getNilReviewQueue(token)
      .then((items) => {
        if (!cancelled) setNilReviewCount(items.length);
      })
      .catch(() => {
        /* leave the badge off on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [token, canReview]);

  // The review/NIL count badges attach to the same two links wherever they are
  // rendered (inside Console, and flat in the mobile sheet), so factor the
  // decision out once.
  function badgeFor(href: string) {
    if (href === '/review' && reviewCount != null && reviewCount > 0)
      return <span className="nav-badge">{reviewCount}</span>;
    if (href === '/nil-review' && nilReviewCount != null && nilReviewCount > 0)
      return <span className="nav-badge">{nilReviewCount}</span>;
    return null;
  }

  // CONSOLE ROLLS THE TWO QUEUE COUNTS UP ONTO ITS OWN TRIGGER. Both badged
  // links now live inside a closed menu, and a count nobody can see is a count
  // that doesn't work — the badge exists precisely to pull an editor toward a
  // queue they weren't already thinking about. The per-item badges stay inside,
  // so the trigger answers "is there anything?" and the menu answers "where".
  const consoleTotal = (reviewCount ?? 0) + (nilReviewCount ?? 0);

  // No Console trigger for a role with nothing behind it — see navLinksFor.
  const consoleMenu =
    consoleLinks.length > 0 ? (
      <NavMenu
        triggerClassName="link-btn nav-console"
        triggerLabel={
          consoleTotal > 0
            ? `Console, ${consoleTotal} awaiting review`
            : 'Console'
        }
        triggerContent={
          <>
            <span>Console</span>
            {consoleTotal > 0 && (
              <span className="nav-badge" aria-hidden="true">
                {consoleTotal}
              </span>
            )}
            <span className="nav-console__chev" aria-hidden="true" />
          </>
        }
      >
        {() => (
          <>
            {consoleLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                className="nav-menu__item"
              >
                <span>{l.label}</span>
                {badgeFor(l.href)}
              </Link>
            ))}
          </>
        )}
      </NavMenu>
    ) : null;

  return (
    <>
      {/* Desktop (>=768px): the wide uppercase link row. Sections first, then
          Console, then the three controls at the right end — the chip and bell
          used to lead the row, which put two icons in front of every
          destination. Identity belongs at the end of a bar, not the start. */}
      <div className="nav-links nav-links--desktop">
        {sections.map((l) => (
          <Link key={l.href} href={l.href} className="link-btn">
            {l.label}
          </Link>
        ))}
        {consoleMenu}
        <PointsChip />
        <NotificationBell />
        <AvatarMenu onLogout={onLogout} />
      </div>

      {/* Mobile (<768px): a slim cluster of the points chip, the bell, the
          avatar + a hamburger. The bell and the avatar sit in the HEADER and
          deliberately not inside the nav sheet: the sheet is z-index 80, the
          slide-over is 60 and the menu panel is 70, so either one opened from
          inside the sheet would land underneath it. */}
      <div className="nav-mobile">
        <PointsChip />
        <NotificationBell />
        <AvatarMenu onLogout={onLogout} />
        <button
          type="button"
          className="nav-hamburger"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <span className="nav-hamburger__bars" aria-hidden="true" />
        </button>
      </div>

      {/* Mobile full-screen menu: DESTINATIONS ONLY. The identity line, Change
          password and Log out have moved to the avatar menu, which is one tap
          away in the same header — so this sheet no longer mixes places you can
          go with operations you can perform. Console's items are listed flat
          under a heading rather than nested: a menu inside a menu, on a phone,
          to save eight rows of a screen that already scrolls. */}
      {menuOpen && (
        <div className="nav-sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="nav-sheet__top">
            <span className="wordmark">Sharp Foxx</span>
            <button
              type="button"
              className="nav-sheet__close"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              ✕
            </button>
          </div>

          <nav className="nav-sheet__links">
            {sections.map((l) => (
              <Link key={l.href} href={l.href} className="nav-sheet__link">
                <span>{l.label}</span>
              </Link>
            ))}
          </nav>

          {consoleLinks.length > 0 && (
            <>
              <div className="nav-sheet__heading">Console</div>
              <nav className="nav-sheet__links">
                {consoleLinks.map((l) => (
                  <Link key={l.href} href={l.href} className="nav-sheet__link">
                    <span>{l.label}</span>
                    {badgeFor(l.href)}
                  </Link>
                ))}
              </nav>
            </>
          )}
        </div>
      )}
    </>
  );
}

// Branded "no access" page shown when a role directly visits a page it can't
// use, instead of the raw "403 Insufficient role" text. Reuses the feed shell,
// masthead, and empty-state styles -- no new CSS. The nav still lists the pages
// this role *can* reach, so it's a way out, not a dead end.
export function AccessDenied() {
  return (
    <main className="feed-home">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
        </div>
        <AppNav />
      </div>

      <div className="masthead">
        <span className="masthead-kicker">Restricted</span>
        <h1 className="masthead-title">No access</h1>
        <p className="masthead-standfirst">
          This page is limited to roles your account doesn&apos;t have.
        </p>
      </div>

      <div className="results-empty">
        <p className="results-empty__title">You don&apos;t have access to this page</p>
        {/* "the links above" stopped being literally true when the staff pages
            went behind Console, and this page's whole job is to be a way out. */}
        <p className="results-empty__hint">
          Your role can&apos;t open this page. Use the bar above — or the Console
          menu, if you&apos;re staff — to head somewhere you can.
        </p>
      </div>
    </main>
  );
}
