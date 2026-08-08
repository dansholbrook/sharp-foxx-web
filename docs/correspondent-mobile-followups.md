# Correspondent surface — mobile pass follow-ups

Filed alongside the mobile pass on My Games and the game workspace. Everything
here was found during that pass and **deliberately not fixed in it**. Each entry
says why it was left, so a later session doesn't have to re-derive the argument.

---

## 1. `body { overflow-x: hidden }` masks overflow rather than preventing it

**Where:** `app/globals.css`, inside the `@media (max-width: 767px)` block.

**What:** A too-wide child is silently clipped instead of scrolling. It is a
mask, not a fix, and it is latent rather than live — a code read of the whole
correspondent surface at 390px found nothing currently overflowing.

**Why it wasn't done here:** it is the one item on the mobile list that is not
scoped to the correspondent surface. That rule is global and affects every
route, so removing it correctly means re-verifying all of them at 390px. The
catch that makes it worse: **the mask is exactly why the "nothing overflows"
finding can't be fully certified from a code read** — a clipped child and an
absent child look identical in the source. Shipping the removal as a rider on a
polish pass is how a sideways-scrolling `/discover` goes out unnoticed.

**What it needs:** its own pass, with a real device sweep across every route,
not a static read.

---

## 2. `AttachSponsorForm` has the same body-scroll-lock bug Add Game just had

**Where:** `app/my-games/[eventId]/page.tsx`, `AttachSponsorForm`.

**What:** identical to the bug just fixed in `AddGameForm` — a `.modal-overlay`
that never locks `document.body.style.overflow`, so on a phone the workspace
scrolls behind the open sheet. `SlideOver` (`app/queue-table.tsx`) has the
guard; these two modals never got it.

**Why it wasn't done here:** the fix was authorised for Add Game specifically,
as the first thing a correspondent does. This is the same handful of lines
against the same overlay class, and it is genuinely a bug rather than a
redesign — but it wasn't asked for, so it is written down instead of assumed.

**What it needs:** the same `useEffect` now in `add-game-form.tsx`. Worth
checking whether any other `.modal-overlay` user is missing it at the same time.

---

## 3. The workspace Call tile can only ever find a **published** call

**Where:** `app/my-games/[eventId]/page.tsx`, `CallTile` (the long header
comment on that component states this in full).

**What:** the grade route is keyed by CALL id and the workspace holds an EVENT
id, with no event→call lookup. `GET /arena/call/current` is the only route a
field rep can call that returns a call id at all, and it excludes drafts by
design (a fan must not see next week's half-written card). So a correspondent
still composing gets no tile on their own game and has to reach the compose tool
through the link editorial sends them.

**Why it wasn't done here:** it is pre-existing, it is a product/backend gap
rather than a mobile one, and closing it needs an API change — which this pass
explicitly had none of.

**What it needs:** `GET /arena/call/events` to grow a `mine` scope. Already
tracked as P1 in `docs/call-staff-backend-spec.md`. `CallTile` is where the
frontend side lands when it exists; the component is already shaped for it
(one best-effort read, self-hiding on failure).

---

## 4. Add Game as a full-screen sheet

**Where:** `app/add-game-form.tsx` + `.modal-overlay` / `.modal-card`.

**What:** on a phone this is the second most awkward flow on the surface. The
modal scrolls inside a viewport-height overlay, and `.team-picker__menu` /
`.school-picker__menu` cap at `max-height: 280px` and open **downward** — so a
picker near the bottom of the form, with the keyboard up, opens into very little
room. It works; it isn't pleasant.

**Why it wasn't done here:** it is a redesign, not a bug. `AddGameForm` is
shared with `/field-reps`, and it wraps a school picker and a native date wheel
whose behaviour shouldn't be disturbed casually. The body-scroll-lock was taken
as the cheap partial that fixes the actual defect; the sheet conversion was
declined deliberately.

**What it needs:** an explicit decision, and its own sizing. The pattern to copy
already exists — `.slideover-panel` goes full-width edge-to-edge below 767px.

---

## 5. Unverified without a physical device: iOS camera capture

**Where:** `app/my-games/[eventId]/page.tsx`, `PhotosSection` (the comment on
the pick row says the same thing at the call site).

**What:** the new "Take a photo" control sets `capture="environment"` with
`accept="image/jpeg,image/png,image/webp"`. iOS normally returns JPEG from a
camera capture, but HEIC has been reported leaking through on some iOS/Safari
combinations.

**Why it's only a note:** the failure is graceful. `onPick` validates type and
size before presigning, so a HEIC would produce an immediate "Use a JPEG, PNG,
or WebP image." tile rather than a wasted round trip or a broken upload. But
nobody has held a phone and watched it happen.

**What it needs:** five minutes with a real iPhone. If HEIC does come through,
the decision is whether to widen `accept` (and mirror it on the backend) or
leave the guard to reject it with a clearer message.
