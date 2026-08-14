# Sharp Foxx Web — project guide for Claude

Browser frontend for the Sharp Foxx API: **45 routes** across the fan product
(feed, games, contests, the six Arena games, leaderboards, profiles, Scout Book)
and the operator console (field reps, applicants, NIL review, economy, ad
sales). Next.js 14 (App Router) + React + TypeScript, **no** auth framework,
**no** component library, **no** CSS framework — plain `fetch` and one
stylesheet, on purpose.

Lives beside the backend at `../sharp-foxx-api`. Runs on **:3001**; the API runs
on **:3000** under the `/api/v1` prefix.

> This file described a five-file dev console until 2026-08-13. It was wrong by
> about forty routes. If something below no longer matches the code, the code is
> right — fix this file in the same commit rather than leaving the next reader to
> find out the hard way.

## Golden rules (do not break)

- **Keep the dependency list at three.** `next`, `react`, `react-dom`. No axios,
  no react-query, no redux, no UI kit, no CSS framework. If a task seems to want
  one, flag it before adding — the thin, legible chain is the point, and it has
  survived 45 routes without help.
- **All API access goes through `app/api.ts`.** One typed client (~80 exported
  functions) owns the base URL, the `Bearer` header, and Nest error-body
  parsing. Never `fetch` the API directly from a component.
- **Response types mirror the backend.** The interfaces in `app/api.ts` ARE the
  contract. When a backend shape changes, update them in the same pass — a
  frontend type that has drifted from the service is worse than no type.
- **The token lives in memory only.** `app/auth-context.tsx` holds it in React
  state; a refresh clears it and the page redirects. That is the deliberate dev
  choice. To persist, swap the `useState` in that one file — do not scatter
  storage reads.
- **Money is a string.** The API returns `numeric` as strings. Keep it a string
  to the render boundary and format with `usd()`. No math on it here.
- **Provider order in `app/layout.tsx` is load-bearing** and its comment block
  says why: Points wraps Earn (an earn pushes the new balance to the ⚡ chip),
  Earn wraps Follows (a follow IS an earn), Auth wraps all of it, AgeGate sits
  under Auth because it swaps the token. Notifications is innermost precisely
  because nothing depends on it. Read that comment before reordering.

## Layout

- `app/api.ts` — the typed client. Large, and the first place to look for what a
  surface can actually ask for.
- `app/globals.css` — ~21k lines, one file, heavily commented. Section banners
  mark each surface. It is long because it is the only stylesheet, not because
  it is disorganised.
- `app/layout.tsx` — root shell and the provider stack.
- `app/nav.tsx` — desktop nav row and the mobile cluster (points chip, bell,
  avatar, hamburger) plus the full-screen mobile sheet.
- `app/*-context.tsx` — auth, points, earn, follows, notifications.
- `app/feed/page.tsx` — the fan home. Two columns at ≥1024px, one interleaved
  column below (see the rail note).
- `app/feed-picks.tsx` — the feed's rail bands and the pick/contest/game row
  cards they render.

## Things that will bite you

- **`.frail` is `display: contents` below 1024px.** The rail's
  `max-height`/`overflow` therefore apply on desktop ONLY; on mobile its bands
  become direct grid items and CSS `order` weaves them into the single column.
  Any band that can grow without bound becomes the page on a phone. This is why
  the rail is three hard-capped bands and not seven.
- **Cards are a fixed width, not a responsive grid.** `.tcard` is
  `flex: 0 0 280px` (`.fmain-live .tcard` is 380px) inside a horizontal snap
  scroller. Widening a page reveals MORE cards; it does not grow them. Changing
  card size means changing `.tcard`, and it costs cards-per-row — measure before
  deciding.
- **Page width is a per-page decision.** `main` is 920px (console pages);
  `.feed-home` 1200; `.feed-dash` 1240; `.gamesdir-page`/`.discover-page`/
  profile/team/school/conference 1080; `.arena-page` 860; `.article-page` 820;
  `.reader` 720; `.apply-page` 760. `.feed-home--bleed` removes the cap for
  card-grid surfaces. Prose and tables keep a measure; grids do not.
- **The mobile header row is at capacity.** At ≤399px the ⚡ chip is dropped
  because the wordmark cannot wrap and three 44px tap targets cannot shrink.
  Nothing new fits beside the cluster on a phone — the comment in `globals.css`
  carries the budget.
- **Modifier classes are appended at the END of `globals.css`** because they
  share specificity with the rules they override, so source order decides.
  Moving that block earlier silently disables it.

## Conventions

- `'use client'` on anything using hooks or state.
- Surface errors inline (the `.error` box); the client turns a failed response
  into `"<status> <message>"` — don't swallow it.
- A rail band that has nothing to say returns `null` and its wrapper is
  `:empty`-hidden, so the rail is never a column of gaps.
- Config via `NEXT_PUBLIC_API_BASE` in `.env.local` (includes `/api/v1`).

## Commands

- Dev server: `npm run dev`   → http://localhost:3001 (API must be up on :3000)
- Typecheck:  `npx tsc --noEmit`
- Build:      `npm run build` — **do not run this to check your work.** Typecheck
  instead; a build is slow and is not what a review needs.

## Running the full stack

1. API:  `cd ../sharp-foxx-api && npm run start:dev`  (:3000)
2. Web:  `npm run dev`  (:3001)
3. Log in with a user UUID. Console routes are role-gated server-side, so a
   non-admin logs in fine and gets 403 on those pages. Grab an admin:
   `psql sharpfoxx -c "SELECT u.id FROM users u JOIN user_roles ur ON
   ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code='admin' LIMIT 1;"`

## Working style

- Show a short plan before writing code for anything touching more than one file.
- CORS lives on the backend (`sharp-foxx-api/src/main.ts`). If this port changes,
  update that origin too.
