# Sharp Foxx Web — project guide for Claude

Minimal browser frontend for the Sharp Foxx API. Its only job is to prove the
full **login → JWT → authenticated API call → render** chain end to end. It is a
dev admin console, not a product surface. Next.js 14 (App Router) + React +
TypeScript, **no** auth framework and **no** component library — plain `fetch`
and plain CSS on purpose.

Lives beside the backend at `../sharp-foxx-api`. Runs on **:3001**; the API runs
on **:3000** under the `/api/v1` prefix.

## Golden rules (do not break)

- **Keep it minimal.** No axios/react-query/redux, no UI kit, no CSS framework.
  If a task wants one of those, flag it before adding — the whole point is a thin,
  legible chain. Plain `fetch` + Context + one `globals.css`.
- **The token lives in memory only.** `app/auth-context.tsx` holds it in React
  state. A page refresh clears it and the dashboard redirects to `/`. That's the
  deliberate dev choice. To persist, swap the `useState` for `sessionStorage`/
  `localStorage` in that one file — don't scatter storage reads elsewhere.
- **All API access goes through `app/api.ts`.** One typed client owns the base
  URL, the `Bearer` header, and Nest error-body parsing. Don't call `fetch`
  against the API directly from components.
- **Response types mirror the backend.** The interfaces in `app/api.ts`
  (`CommissionsReport`, `RevenueReport`, `LoginResponse`) track
  `sharp-foxx-api/src/modules/reports/reports.service.ts` and `auth.service.ts`.
  If a backend shape changes, update these to match — they are the contract.
- **Money is a string.** The API returns `numeric` money as strings; keep it a
  string until the render boundary and format with the `usd()` helper. Don't do
  math on it here.

## Layout

- `app/api.ts` — typed API client (`login`, `getCommissions`, `getRevenue`).
- `app/auth-context.tsx` — in-memory token/user Context + `useAuth()`.
- `app/page.tsx` — dev login (`/`): userId input → POST → store token → dashboard.
- `app/dashboard/page.tsx` — `/dashboard`: fetches both reports with the Bearer
  token, renders commissions-per-rep and revenue-by-stream tables.
- `app/layout.tsx` + `app/globals.css` — root shell + minimal dark styling.

## Conventions

- `'use client'` on anything using hooks/state (login, dashboard, auth context).
- Surface errors inline in the UI (see the `.error` box) — the client turns a
  failed response into `"<status> <message>"`; don't swallow it.
- Config via `NEXT_PUBLIC_API_BASE` in `.env.local` (includes `/api/v1`).

## Commands

- Dev server: `npm run dev`   → http://localhost:3001 (API must be up on :3000)
- Typecheck:  `npx tsc --noEmit`
- Build:      `npm run build`

## Running the full stack

1. API:  `cd ../sharp-foxx-api && npm run start:dev`  (:3000)
2. Web:  `npm run dev`  (:3001)
3. Log in with an **admin** user's UUID — the reports endpoints are
   `@Roles('admin')`-gated, so a non-admin logs in but gets 403 on the dashboard.
   Grab one: `psql sharpfoxx -c "SELECT u.id FROM users u JOIN user_roles ur ON
   ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code='admin' LIMIT 1;"`

## Working style

- Show a short plan before writing code for anything touching more than one file.
- CORS lives on the backend (`sharp-foxx-api/src/main.ts`, `enableCors`). If the
  frontend port changes, update that origin too.
