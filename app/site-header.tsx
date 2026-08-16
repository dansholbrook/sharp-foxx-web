'use client';

// ============================================================================
// THE ONE HEADER. Rendered ONCE in app/layout.tsx, outside every page's <main>.
//
// ----------------------------------------------------------------------------
// WHAT THIS FIXES (RESOLVER_TICKETS.md W1), AND WHAT IT DOES NOT.
//
// Every page used to render its own copy of `.header-row` INSIDE `<main>`, and
// `main` is the content column each page caps for its own content: 760px for
// the apply/join forms, 1200px for the feed shell, uncapped for the bleed
// pages. So the amount of room the GLOBAL NAVIGATION got was decided by an
// EDITORIAL judgement about that page's content -- narrowing the Trail to suit
// a vertical road silently narrowed the site nav on the Trail.
//
// Those two decisions are now independent. The chrome spans the viewport; only
// the content column is capped.
//
// IT IS NOT A FIX FOR "THE NAV WRAPS". `.nav-links` wraps on purpose and should
// keep wrapping when it genuinely must -- see the ceiling table in W1, which is
// a statement about what the bar costs at its current size and is not repealed
// by this file. What changed is that the wrapping is now a function of the
// VIEWPORT, which is the thing it was always claiming to be about.
//
// ----------------------------------------------------------------------------
// THREE VARIANTS, CHOSEN BY ROUTE AND NOT BY TOKEN.
//
//   PUBLIC (/, /join, /apply) -- wordmark plus one or two links, no AppNav.
//     Route, not token, decides: a signed-in user who opens /join today sees the
//     public header, and that behaviour is preserved rather than re-litigated
//     here. These three shipped as three separate copies (two of them a
//     character-identical `PublicHeader`); they are one function now.
//
//   AUTHENTICATED -- wordmark + <AppNav/>, plus the search field on /feed only.
//
//   NOTHING -- signed out on an authenticated route. Every such page already
//     `return null`s while `!token`, so rendering chrome above a blank page
//     would be a NEW behaviour, not a preserved one.
//
// THE "Signed in as … · role" LINE IS GONE, markup and all. It was copy-pasted
// into 39 files and hidden at every width by a single `display: none` in
// globals.css, whose comment named this component as the real fix and the
// deletion as part of it. That fact lives in the avatar menu, next to the
// initials that carry the same answer at a glance.
// ============================================================================

import { FormEvent, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from './auth-context';
import { AppNav } from './nav';

// The routes with no session behind them. Kept as a set of exact paths rather
// than a prefix test on purpose: `/apply` is public but `/applicants` is a staff
// queue, and a startsWith would hand the applicant review screen a Sign-in link
// and no navigation.
const PUBLIC_ROUTES = new Set(['/', '/join', '/apply']);

// ---- Search: submit navigates to /search with the query in tow.
//
// MOVED HERE FROM feed/page.tsx UNCHANGED. It has to move -- it lived inside
// that page's `.header-row`, and the header is what left. It is deliberately
// still rendered on /feed ALONE: putting a 260px-floor field into the bar on
// every screen would spend on every page the width this refactor just gave
// back to the nav, and "search everywhere" is a product decision nobody has
// made. ----
function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  }

  return (
    <form className="feed-search" onSubmit={onSubmit} role="search">
      <svg
        className="feed-search__icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className="feed-search__input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search games, teams, sports…"
        aria-label="Search games, teams, sports"
      />
      <button className="feed-search__btn" type="submit">
        Search
      </button>
    </form>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { token } = useAuth();

  if (PUBLIC_ROUTES.has(pathname)) {
    // The login page offers the two ways IN; /join and /apply, being those two
    // ways, offer the way back. Same bar, different errand.
    const isLogin = pathname === '/';
    return (
      <div className="header-row">
        <span className="wordmark">Sharp Foxx</span>
        {isLogin ? (
          <div className="login-header-links">
            <Link href="/join" className="link-btn">
              New here? Join free →
            </Link>
            <Link href="/apply" className="link-btn">
              Apply to join
            </Link>
          </div>
        ) : (
          <Link href="/" className="link-btn">
            Sign in
          </Link>
        )}
      </div>
    );
  }

  // No session on a page that needs one: the page itself renders nothing, and a
  // header floating above nothing is worse than no header.
  if (!token) return null;

  // ONE BAR OF CHROME, and on /feed search rides inside it rather than below.
  // At >=768px it sits between the wordmark and the nav -- the reference
  // layout's single row. Below that it wraps to a second line INSIDE the same
  // bar (see .header-row--search in globals.css): the mobile cluster is already
  // at capacity at 390px, which is why the ⚡ chip drops out under 400px, so
  // there is no room to put a field beside it.
  const withSearch = pathname === '/feed';
  return (
    <div className={`header-row${withSearch ? ' header-row--search' : ''}`}>
      <span className="wordmark">Sharp Foxx</span>
      {withSearch && <SearchBar />}
      <AppNav />
    </div>
  );
}
