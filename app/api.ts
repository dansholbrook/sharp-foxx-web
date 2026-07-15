// Tiny typed client for the Sharp Foxx API. No axios, no react-query -- just
// fetch. Base URL comes from NEXT_PUBLIC_API_BASE (see .env.local) and already
// includes the /api/v1 prefix.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api/v1';

// ---- Response shapes (mirrors reports.service.ts on the backend) ----

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user: { id: string; displayName: string; roles: string[] };
  // True when the account is on a temporary password and must set a real one
  // before proceeding. Absent on the legacy dev (userId) login path -- callers
  // treat absent as false.
  mustChangePassword?: boolean;
}

export interface CommissionsReport {
  perRep: Array<{
    repId: string;
    // Resolved via field_reps -> users on the backend; null if unlinked.
    displayName: string | null;
    total: string;
    bySource: Record<string, string>;
  }>;
  grandTotal: string;
}

export interface RevenueReport {
  byStream: {
    adOrders: string;
    nilContributions: string;
    subscriptionPayments: string;
    retailOrders: string;
  };
  total: string;
}

// Mirrors the users table row returned by POST /users (users.service.ts).
export interface User {
  id: string;
  email: string;
  displayName: string;
  status: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors a field_reps row (field-reps.service.ts). commissionRate is numeric
// in the DB, so it comes back as a string -- keep it a string here.
export interface FieldRep {
  id: string;
  userId: string;
  // From a leftJoin to users on the backend list(); null if the user is
  // unlinked (mirrors the ManagerRoster/CommissionsReport name fields).
  displayName: string | null;
  email: string | null;
  kind: 'field_rep' | 'regional_manager';
  status: string;
  managerId: string | null;
  homeMarketId: string | null;
  cohortLabel: string | null;
  commissionRate: string;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors reports.service.ts `managerReps()`. displayName/email come from a
// leftJoin so they can be null; totalCommissions is numeric money -> a string.
export interface ManagerRoster {
  managerId: string;
  reps: Array<{
    repId: string;
    displayName: string | null;
    email: string | null;
    totalCommissions: string;
    adOrdersCount: number;
  }>;
}

// Mirrors reports.service.ts `myEarnings()` -- the CALLER's own commission
// earnings, resolved from their field_reps row (reps AND managers have one). All
// money is numeric -> a string; rate is a 4dp decimal string (e.g. "0.1500").
// sourceType is the commission_source enum; status the commission_status enum
// (lifetime totals include 'reversed'). commissions come back newest-first
// (earnedAt desc) -- render in API order. paidAt is null until paid.
export interface MyEarningsReport {
  totals: { pending: string; approved: string; paid: string; lifetime: string };
  commissions: Array<{
    id: string;
    sourceType: 'ad_order' | 'nil_contribution' | 'subscription' | 'retail_order';
    baseAmount: string;
    rate: string;
    amount: string;
    status: 'pending' | 'approved' | 'paid' | 'reversed';
    earnedAt: string;
    paidAt: string | null;
  }>;
}

// Mirrors reports.service.ts `managerSummary()` -- a territory rollup keyed on
// the manager's OWN field_reps id (the roster route's :id). Admin sees any
// territory; a regional_manager only their own (else 403). Money is numeric -> a
// string; recentOrders is capped at 10, newest-first, and stays UNFILTERED so a
// 'canceled'/'draft' order can appear (unlike totalSales, which excludes them).
// businessName/repDisplayName come from left joins, so they can be null.
export interface ManagerSummary {
  repCount: number;
  totalSales: { count: number; amount: string };
  totalCommissions: { pending: string; approved: string; paid: string };
  recentOrders: Array<{
    id: string;
    amount: string;
    status: string;
    createdAt: string;
    businessName: string | null;
    repDisplayName: string | null;
  }>;
}

// Mirrors assignments.service.ts `listMine()` -- the caller's own assignments
// joined to their events. Teams come back as raw UUIDs (no name join) and are
// nullable; scheduledAt/assignedAt are ISO strings (timestamptz, mode 'string').
export interface MyAssignment {
  id: string;
  status: 'assigned' | 'accepted' | 'submitted';
  source: 'assigned' | 'self_claimed';
  notes: string | null;
  assignedBy: string | null;
  assignedAt: string;
  event: {
    id: string;
    sport: string;
    venue: string | null;
    status: 'scheduled' | 'live' | 'final' | 'postponed' | 'canceled';
    scheduledAt: string;
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
  };
}

// Mirrors the bare event_assignments row returned by PATCH /assignments/:id
// (assignments.service.ts `update()`). Note there is NO event join here, unlike
// MyAssignment -- only merge the changed status/notes back into an existing row.
export interface AssignmentRow {
  id: string;
  eventId: string;
  repId: string;
  status: 'assigned' | 'accepted' | 'submitted';
  assignedBy: string | null;
  source: 'assigned' | 'self_claimed';
  notes: string | null;
  assignedAt: string;
}

// Request bodies for the two create calls (mirror the Zod schemas on the API).
export interface CreateUserInput {
  email: string;
  displayName: string;
}

export interface CreateFieldRepInput {
  userId: string;
  kind?: 'field_rep' | 'regional_manager';
  commissionRate?: number;
  cohortLabel?: string;
  managerId?: string;
  homeMarketId?: string;
}

// PATCH body for updating one's own assignment. The backend requires at least
// one field (updateAssignmentSchema.refine), so send only what changed.
export interface UpdateAssignmentInput {
  status?: MyAssignment['status'];
  notes?: string;
}

// The joined event listing returned by GET /events (events.service.ts `list`).
// Keeps every event column but adds homeTeam/awayTeam resolved via two aliased
// joins to `teams`, so those names are nullable (LEFT join / unset FK). sport
// and status are the backend enums; scheduledAt is a timestamptz ISO string.
// Ordered soonest-first by the backend for the Upcoming Games carousel.
export interface EventListItem {
  id: string;
  externalRef: string | null;
  sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'other';
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  marketId: string | null;
  venue: string | null;
  status: 'scheduled' | 'live' | 'final' | 'postponed' | 'canceled';
  scheduledAt: string;
  homeScore: number | null;
  awayScore: number | null;
  // Recap/replay link set via PATCH /events/:id/result. Nullable (or absent if a
  // deployment's list select hasn't surfaced it yet) -- the fan-side watch UI is
  // gated on its truthiness, so it simply stays hidden until a URL is present.
  videoUrl: string | null;
  isLocalStream: boolean;
  createdAt: string;
  updatedAt: string;
}

// PATCH /events/:id/result body (mirrors updateResultSchema in events.service.ts).
// Every field is optional but the backend requires at least one (empty body ->
// 400); scores are non-negative ints and videoUrl must be an http(s) URL. Send
// only the fields the rep actually filled in.
export interface UpdateEventResultInput {
  homeScore?: number;
  awayScore?: number;
  videoUrl?: string;
  status?: EventListItem['status'];
}

// The bare events row returned by PATCH /events/:id/result (`.returning()`) --
// NOT the joined EventListItem, so it carries no homeTeam/awayTeam names. Only
// the result fields the UI reads back after a save are typed here.
export interface EventResult {
  id: string;
  status: EventListItem['status'];
  homeScore: number | null;
  awayScore: number | null;
  videoUrl: string | null;
}

// Mirrors a content_items row (content.service.ts / schema.ts). Returned by
// POST /content/generate, which AI-drafts a recap and stores it as a DRAFT
// attached to the event -- it never auto-publishes, so status comes back
// 'draft'. body is an HTML string (rendered at the display boundary).
export interface ContentItem {
  id: string;
  kind: 'blog' | 'podcast' | 'video' | 'athlete_profile';
  // The editorial flow adds 'submitted' between draft and published: an author
  // submits a draft for review; a manager publishes it or returns it to draft.
  status: 'draft' | 'submitted' | 'published' | 'archived';
  authorUserId: string | null;
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  // Send-back feedback: a manager's optional note set when returning a submitted
  // item to draft, cleared on the next submit. Null on the happy path. Present on
  // the bare content_items row (GET /content/:id, submit/return/publish), but NOT
  // in the flattened list projection (getEventContent) -- see EventContentItem.
  reviewNote: string | null;
  institutionId: string | null;
  teamId: string | null;
  athleteId: string | null;
  eventId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// The published-content read model returned by GET /content?status=published
// (content.service.ts). Unlike the bare ContentItem row this flattens joins for
// display: author is a display-name string (not a UUID) and the event fields
// come from a left join, so they're nullable. body is a non-null HTML string
// here since only published items with a body are listed.
export interface FeedItem {
  id: string;
  kind: ContentItem['kind'];
  title: string;
  body: string;
  slug: string | null;
  publishedAt: string;
  author: string;
  eventSport: string | null;
  eventScheduledAt: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}

// The joined listing row returned by GET /content (content.service.ts
// `listContent`), e.g. GET /content?eventId=<uuid>. NOT a bare content_items
// row: it flattens joins (author display name, event/team context) and drops
// the FK columns, so it is intentionally distinct from ContentItem. status can
// also be 'archived' here (the backend enum has it). Only the fields the editor
// needs (id/status/title/body/publishedAt) overlap with ContentItem, which is
// why the editable draft state below is typed as the union of the two.
export interface EventContentItem {
  id: string;
  kind: ContentItem['kind'];
  status: 'draft' | 'submitted' | 'published' | 'archived';
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  author: string | null;
  eventId: string | null;
  eventSport: string | null;
  eventScheduledAt: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  // NOT in the list projection (listContent omits it) -- optional so the editor
  // can read draft.reviewNote off either shape. Fetch the bare row via
  // getContentItem to actually populate it.
  reviewNote?: string | null;
}

// A row in the editorial review queue (content.service.ts `reviewQueue`),
// returned by GET /content/review-queue. Submitted items awaiting a decision,
// newest-created first. Like the reader feed it flattens joins (author display
// name, event/team context) so a card renders without follow-up lookups. status
// is always 'submitted' here; body is the HTML to preview, reviewNote is any
// prior send-back note (usually null on a fresh submission).
export interface ReviewQueueItem {
  id: string;
  kind: ContentItem['kind'];
  status: 'submitted';
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  reviewNote: string | null;
  createdAt: string;
  author: string | null;
  eventId: string | null;
  eventSport: string | null;
  eventScheduledAt: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}

// POST /content/:id/return body (mirrors returnContentSchema). The note is the
// optional send-back feedback stored on review_note and shown to the author.
export interface ReturnContentInput {
  note?: string;
}

// Request body for POST /content/generate (mirrors generateArticleSchema). The
// AI rewrites sourceText (the rep's notes) into a recap for the given event.
export interface GenerateArticleInput {
  eventId: string;
  authorId: string;
  sourceText: string;
}

// PATCH body for editing a draft's title/body (mirrors updateContentSchema).
// The backend requires at least one field, so send only what changed.
export interface UpdateContentInput {
  title?: string;
  body?: string;
}

// The bare teams row returned by POST /teams (the inline "new team" creator in
// the Add Game form). level is the backend enum ('pro' | 'college' |
// 'high_school'); league is nullable (optional on create). Reading a list of
// teams goes through searchTeams -> TeamSearchResult, which is richer.
export interface Team {
  id: string;
  name: string;
  sport: string;
  level: string;
  league: string | null;
}

// POST /teams body (mirrors createTeamSchema). A duplicate name within a sport
// comes back 409 -> surfaced as "409 <message>" by the client.
export interface CreateTeamInput {
  name: string;
  sport: string;
  level: 'pro' | 'college' | 'high_school';
  league?: string;
}

// POST /events body (mirrors createEventSchema). scheduledAt is an ISO datetime
// string; team ids/venue/isLocalStream/status are all optional. Send only the
// fields the Add Game form actually filled in.
export interface CreateEventInput {
  sport: string;
  scheduledAt: string;
  venue?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  isLocalStream?: boolean;
  status?: EventListItem['status'];
}

// The bare events row returned by POST /events (`.returning()`) -- NOT the
// joined EventListItem, so it carries no homeTeam/awayTeam names. Only the
// fields the Add Game flow reads back (id, to self-claim) are relied on.
export interface CreatedEvent {
  id: string;
  sport: EventListItem['sport'];
  scheduledAt: string;
  venue: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: EventListItem['status'];
  isLocalStream: boolean;
}

// POST /assignments body. A manager (regional_manager/admin) may pass repId to
// assign that rep to the game; omitting repId self-claims for the caller's own
// rep row (managers have rep rows, so an omitted repId is a manager self-claim).
// notes is optional. Returns the bare event_assignments row (no event join),
// same shape as PATCH.
export interface CreateAssignmentInput {
  eventId: string;
  repId?: string;
  notes?: string;
}

// An advertiser row as returned by GET /advertisers. marketId/managedByRep come
// from nullable columns (an advertiser need not be tied to a market or a
// managing rep), so keep them nullable. Only id/businessName are read by the UI
// (the businessName is joined client-side onto ad orders, which carry only the
// advertiserId).
export interface Advertiser {
  id: string;
  businessName: string;
  marketId: string | null;
  managedByRep: string | null;
}

// POST /advertisers body. marketId is optional; a duplicate businessName comes
// back 409 -> "409 <message>", shown inline by the Log a Sale form.
export interface CreateAdvertiserInput {
  businessName: string;
  marketId?: string;
}

// An ad_packages row as returned by GET /ad-packages (active only). price is
// numeric money -> a string; durationDays/impressions are ints. Selecting a
// package in the Log a Sale form pre-fills the (editable) order amount from price
// and, with a start date, computes endsOn from durationDays.
export interface AdPackage {
  id: string;
  name: string;
  price: string;
  durationDays: number;
  impressions: number;
  isActive: boolean;
}

// An ad_orders row as returned by GET /ad-orders/mine and GET /ad-orders?repId=,
// and by POST /ad-orders. amount is numeric money -> a string; startsOn/endsOn
// are nullable date strings. advertiserId is a bare UUID here (no name join), so
// the UI resolves the businessName from GET /advertisers and joins by id.
export interface AdOrder {
  id: string;
  advertiserId: string;
  packageId: string | null;
  amount: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
}

// POST /ad-orders body. The backend creates the order AND its commission
// atomically; a field_rep's sale is always credited to themselves (enforced
// server-side), so no repId is sent. Send status "active". amount is required and
// must be > 0; packageId/startsOn/endsOn are optional.
export interface CreateAdOrderInput {
  advertiserId: string;
  packageId?: string;
  amount: number;
  status: string;
  startsOn?: string;
  endsOn?: string;
}

// A game sponsorship as returned by GET /sponsorships?eventId= and POST
// /sponsorships. businessName/advertiserId are resolved server-side from the
// linked ad order's advertiser, so the "Presented by" strip needs no extra
// join. eventId + adOrderId are the two sides of the link. The eventId lookup
// returns this row or null (a game with no presenting sponsor).
export interface Sponsorship {
  id: string;
  eventId: string;
  adOrderId: string;
  advertiserId: string;
  businessName: string;
}

// POST /sponsorships body. Links an existing ad order to an event. A rep may
// only pass their own orders (enforced server-side); a game that already has a
// sponsor comes back 409 -> "409 This game already has a presenting sponsor".
export interface CreateSponsorshipInput {
  eventId: string;
  adOrderId: string;
}

// Pull a useful message out of a Nest error body ({ message, statusCode }).
async function toError(res: Response): Promise<Error> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (body?.message) {
      detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    }
  } catch {
    /* non-JSON body -- fall back to statusText */
  }
  return new Error(`${res.status} ${detail}`);
}

// ---- Central 401 handling ----
//
// JWTs expire (1h). A token that's restored-but-expired, or simply invalidated
// mid-session, first shows up as a 401 on an authed call. Rather than have every
// caller re-check for that, the auth layer registers ONE handler here (see
// auth-context.tsx) that tears the session down (clear storage + state) and
// bounces to login. toAuthError() invokes it before surfacing the error, so the
// teardown happens in exactly one place.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

// Like toError, but for AUTHED calls: a 401 here means an expired/invalid token,
// so fire the central teardown first. Deliberately NOT used by the public calls
// (login/apply) or by changePassword -- there a 401 is a bad credential / wrong
// current password, not an expired session, and must not sign the user out.
async function toAuthError(res: Response): Promise<Error> {
  if (res.status === 401) onUnauthorized?.();
  return toError(res);
}

// Real sign-in: email + password. The backend returns the usual token/user
// payload plus mustChangePassword (true when the account is still on a temp
// password). A bad credential comes back 401 -> "401 <message>", surfaced
// verbatim by the login form.
export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

// Legacy dev sign-in: the same /auth/login endpoint still accepts a bare userId
// (a dev flag on the backend mints a token from it) for test users not yet
// migrated to a password. No mustChangePassword comes back on this path, so the
// caller treats it as false.
export async function devLogin(userId: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// Set a new password (Bearer auth). currentPassword is required whenever the
// account has any password set (including a temp). The backend enforces
// newPassword >= 10; a wrong current password comes back 401 and a weak/invalid
// new one 400 -- both surface as "<status> <message>". The success body isn't
// read (may be 200+json or 204), so this resolves to void.
export async function changePassword(
  token: string,
  input: ChangePasswordInput,
): Promise<void> {
  const res = await fetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toError(res);
}

async function authGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

async function authPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

async function authPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

// DELETE returns 204 (no body), so there's nothing to parse -- resolve to void.
async function authDelete(path: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toAuthError(res);
}

export const getCommissions = (token: string) =>
  authGet<CommissionsReport>('/reports/commissions', token);

export const getRevenue = (token: string) =>
  authGet<RevenueReport>('/reports/revenue', token);

export const getFieldReps = (token: string) =>
  authGet<FieldRep[]>('/field-reps', token);

export const getManagerReps = (token: string, id: string) =>
  authGet<ManagerRoster>(`/reports/managers/${id}/reps`, token);

// The caller's own commission earnings (reps AND managers -- anyone with a
// field_reps row). A user with no rep profile comes back 403 -> "403 No field
// rep profile for this user"; the My Games section hides itself on that.
export const getMyEarnings = (token: string) =>
  authGet<MyEarningsReport>('/reports/my-earnings', token);

// A manager's territory rollup (id is the manager's field_reps row id -- the
// roster route's :id). Admin any; a regional_manager only their own (else 403).
export const getManagerSummary = (token: string, id: string) =>
  authGet<ManagerSummary>(`/reports/managers/${id}/summary`, token);

export const getMyAssignments = (token: string) =>
  authGet<MyAssignment[]>('/assignments/mine', token);

// Manager drill-down: one rep's assignments (repId is a field_reps id), the same
// event-joined shape as /assignments/mine. Admin may query any rep; a
// regional_manager only reps on their own roster -- a rep off their roster comes
// back 403 -> "403 <message>". Like /mine, the event carries NO scores/video;
// load those from GET /events (getEvents) and join by event id, as My Games does.
export const getRepAssignments = (token: string, repId: string) =>
  authGet<MyAssignment[]>(`/assignments?repId=${encodeURIComponent(repId)}`, token);

// Content authored by one user. NOTE authorId is a USER id (content_items
// .author_user_id), NOT a field_reps id -- the roster's repId won't match here.
// Staff callers (admin/manager/rep) get every status incl. drafts; returns the
// joined listing shape (EventContentItem), newest-created first.
export const getContentByAuthor = (token: string, authorId: string) =>
  authGet<EventContentItem[]>(`/content?authorId=${encodeURIComponent(authorId)}`, token);

// The public feed: published content only, newest-first (ordering is enforced by
// the backend). Read-only, so no author gating -- any authenticated user can read.
export const getPublishedContent = (token: string) =>
  authGet<FeedItem[]>('/content?status=published', token);

// Events for the browsable feed, e.g. GET /events?status=scheduled (Upcoming
// Games). Any authenticated user can list; backend orders soonest-first.
export const getEvents = (token: string, status?: string) =>
  authGet<EventListItem[]>(
    `/events${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    token,
  );

// Any content already attached to a game. With no status filter (the default) a
// staff caller gets every status, so a rep can find/edit an existing draft on
// load (not just right after generating). Pass status: 'published' for the
// fan-facing game page -- that read is open to any authenticated role. Returns
// the joined listing shape, newest-created first.
export const getEventContent = (
  token: string,
  eventId: string,
  status?: 'draft' | 'published' | 'archived',
) =>
  authGet<EventContentItem[]>(
    `/content?eventId=${eventId}${status ? `&status=${status}` : ''}`,
    token,
  );

export const updateAssignment = (
  token: string,
  id: string,
  input: UpdateAssignmentInput,
) => authPatch<AssignmentRow>(`/assignments/${id}`, token, input);

// Report a game result. The assigned rep (or an admin) may call it; a non-owning
// rep gets 403 and an empty/invalid body gets 400 -- both surface as
// "<status> <message>". Returns the updated event row.
export const updateEventResult = (
  token: string,
  id: string,
  input: UpdateEventResultInput,
) => authPatch<EventResult>(`/events/${id}/result`, token, input);

export const createUser = (token: string, input: CreateUserInput) =>
  authPost<User>('/users', token, input);

export const createFieldRep = (token: string, input: CreateFieldRepInput) =>
  authPost<FieldRep>('/field-reps', token, input);

// AI-drafts a game recap from a rep's notes. Slow (a few seconds -- it's an AI
// call) and can fail with 502/503/504 on AI issues or 404 for a bad event/author
// id; the client surfaces those as "<status> <message>".
export const generateArticle = (token: string, input: GenerateArticleInput) =>
  authPost<ContentItem>('/content/generate', token, input);

// Edit a draft's title/body. Ownership (author-or-manager) is enforced on the
// backend; a bad id or foreign draft surfaces as "<status> <message>".
export const updateContent = (
  token: string,
  id: string,
  input: UpdateContentInput,
) => authPatch<ContentItem>(`/content/${id}`, token, input);

// The full bare content_items row by id (staff see any status). Unlike the
// flattened list projection this carries reviewNote, so the workspace fetches it
// to show a send-back "Editor's note" on a returned draft. A non-existent id is
// a 404 -> "404 <message>".
export const getContentItem = (token: string, id: string) =>
  authGet<ContentItem>(`/content/${id}`, token);

// The author submits their OWN draft for editorial review (draft -> submitted).
// A non-author gets 403 and a non-draft 409 -- both "<status> <message>".
// Clears any stale reviewNote from a previous send-back.
export const submitContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/submit`, token, {});

// Publishing is now staff-only (author-or-manager): a field_rep gets 403 with a
// message pointing at submit. Takes no body; returns the updated row.
export const publishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/publish`, token, {});

// Unpublishing is staff-only too (roster-scoped for managers); returns the
// updated row now back in draft.
export const unpublishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/unpublish`, token, {});

// Staff editorial review queue: submitted items awaiting a decision, newest
// first. Admin sees all; a regional_manager only submissions by roster reps. A
// caller without a manager profile (and not admin) gets 403.
export const getReviewQueue = (token: string) =>
  authGet<ReviewQueueItem[]>('/content/review-queue', token);

// A manager/admin returns a submitted item to its author as a draft, with an
// optional feedback note. Roster-scoped; a non-submitted item is a 409.
export const returnContent = (token: string, id: string, input: ReturnContentInput) =>
  authPost<ContentItem>(`/content/${id}/return`, token, input);

// GET /teams/:id -- a single team for the team hub page (/teams/[id]). Open to
// every authenticated role incl. viewer. institution resolves via a null-safe
// join server-side (pro teams have none). A bad id is a 404 -> "404 Team not
// found". Distinct from the lean Team picker row: it adds the institution.
// Social profile links, keyed by platform, value is the normalized public URL.
// Only present platforms appear (server drops empty keys). Shared by the athlete
// profile identity and the team hub; the edit form uses the same keys. Order here
// mirrors the backend (common/social-links.ts) and the icon row.
export const SOCIAL_PLATFORMS = [
  'instagram', 'tiktok', 'x', 'facebook', 'youtube', 'linkedin',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export interface TeamDetail {
  id: string;
  name: string;
  sport: string;
  level: string;
  socialLinks: SocialLinks;
  institution: { id: string; name: string } | null;
  // Null for pro teams (no institution) and for imported college teams whose
  // EADA row carried no conference. The conference hangs off the TEAM, not the
  // school: a school sits in different conferences per sport.
  conference: { id: string; name: string } | null;
}

export const getTeam = (token: string, id: string) =>
  authGet<TeamDetail>(`/teams/${encodeURIComponent(id)}`, token);

// ---------------------------------------------------------------------------
// The team directory (GET /teams) — the Add Game type-ahead and /discover
// ---------------------------------------------------------------------------

// A directory row. Richer than the lean Team row: it carries isActive and the
// joined school so results can be disambiguated ("Tigers" — Clemson University
// (SC)). institution is null for pro teams; conference is null for pro teams
// and for the ~5.5k imported teams whose conference the import never resolved.
// gender is 'mens' | 'womens' | 'coed', null on hand-made rows; division is the
// per-team 'Division I' etc.
export interface TeamSearchResult {
  id: string;
  name: string;
  sport: string;
  gender: string | null;
  division: string | null;
  level: string;
  league: string | null;
  isActive: boolean;
  institution: {
    id: string;
    name: string;
    stateCode: string | null;
    tier: InstitutionTier | null;
  } | null;
  conference: { id: string; name: string } | null;
}

// GET /teams filters. activeOnly defaults TRUE on the backend and every caller
// keeps it explicit: the college import left ~25.8k teams inactive, so the
// picker pins it true while /discover pins it false. A search under 2 chars is
// ignored server-side, so callers should avoid firing until 2. state/tier
// filter through the school join; conferenceId sits on the team itself.
export interface TeamSearchParams {
  search?: string;
  sport?: string;
  gender?: string;
  conferenceId?: string;
  state?: string;
  tier?: InstitutionTier;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

// Paged directory reads return the filtered `total` alongside the page, so a
// browse UI can render "Showing 25 of 3,412" without a second count call.
export interface Page<T> {
  items: T[];
  total: number;
}

export const searchTeams = (token: string, params: TeamSearchParams) => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.sport) qs.set('sport', params.sport);
  if (params.gender) qs.set('gender', params.gender);
  if (params.conferenceId) qs.set('conferenceId', params.conferenceId);
  if (params.state) qs.set('state', params.state);
  if (params.tier) qs.set('tier', params.tier);
  if (params.activeOnly !== undefined) qs.set('activeOnly', String(params.activeOnly));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  return authGet<Page<TeamSearchResult>>(`/teams?${qs.toString()}`, token);
};

// ---------------------------------------------------------------------------
// The school / conference graph (/schools/[id], /conferences/[id])
// ---------------------------------------------------------------------------

// institution_tier, straight off the backend enum. 'unclassified' is what the
// college import assigns an NCAA school with a missing/odd division.
export type InstitutionTier =
  | 'ncaa_d1' | 'ncaa_d2' | 'ncaa_d3' | 'naia' | 'juco' | 'high_school'
  | 'unclassified';

// A directory row from GET /institutions. Ordered active-first then name: the
// handful of schools we actually cover float above the ~2k imported ones.
export interface InstitutionSummary {
  id: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  tier: InstitutionTier;
  isActive: boolean;
  teamCount: number;
}

// One team on a school page. conference is null when the imported row carried
// none; division is the per-team 'Division I' etc. (the school's tier is the
// summary of those). gender is 'mens' | 'womens' | 'coed', null on hand-made rows.
export interface InstitutionTeam {
  id: string;
  name: string;
  sport: string;
  gender: string | null;
  division: string | null;
  isActive: boolean;
  conference: { id: string; name: string } | null;
}

// GET /institutions/:id -- identity + every team, ordered sport then gender.
// isActive is false for every imported school: the row exists so the graph
// resolves, but we don't cover it yet. mascot is null until an AD backfills it.
export interface InstitutionDetail {
  id: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  website: string | null;
  mascot: string | null;
  tier: InstitutionTier;
  isActive: boolean;
  teams: InstitutionTeam[];
}

export const getInstitution = (token: string, id: string) =>
  authGet<InstitutionDetail>(`/institutions/${encodeURIComponent(id)}`, token);

// School directory. A search under 2 chars is ignored server-side; limit is
// capped at 100 (default 25) and offset pages through the rest. Returns
// { items, total } — total counts the whole filtered set, not the page.
// activeOnly defaults FALSE here (the opposite of GET /teams): nearly every
// imported school is inactive, so a school browse must show them by default.
export const getInstitutions = (
  token: string,
  params: {
    search?: string;
    state?: string;
    tier?: InstitutionTier;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
) => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.state) qs.set('state', params.state);
  if (params.tier) qs.set('tier', params.tier);
  if (params.activeOnly !== undefined) qs.set('activeOnly', String(params.activeOnly));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const q = qs.toString();
  return authGet<Page<InstitutionSummary>>(`/institutions${q ? `?${q}` : ''}`, token);
};

// A directory row from GET /conferences. tier is nullable and is in practice
// NULL for all 146 imported conferences -- the import hangs the conference off
// the team and never sets a conference tier. Callers must hide the badge when
// it's absent rather than render an empty pill.
export interface ConferenceSummary {
  id: string;
  name: string;
  tier: InstitutionTier | null;
  memberCount: number;
}

// A member row on a conference page: a TEAM, joined to its school. institution
// is null only if a team somehow carries a conference but no school (a data bug
// -- the join is null-safe so one bad row can't blank the page).
export interface ConferenceMember {
  teamId: string;
  teamName: string;
  sport: string;
  gender: string | null;
  division: string | null;
  isActive: boolean;
  institution: { id: string; name: string; stateCode: string | null } | null;
}

// GET /conferences/:id -- identity + members, ordered institution name then sport.
export interface ConferenceDetail {
  id: string;
  name: string;
  tier: InstitutionTier | null;
  members: ConferenceMember[];
}

export const getConference = (token: string, id: string) =>
  authGet<ConferenceDetail>(`/conferences/${encodeURIComponent(id)}`, token);

export const getConferences = (
  token: string,
  params: { search?: string; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return authGet<ConferenceSummary[]>(`/conferences${q ? `?${q}` : ''}`, token);
};

// A roster row as returned by GET /athletes?teamId= (athletes.service.ts
// listByTeam). name is composed server-side (first + last); position/classYear/
// jerseyNumber/avatarUrl are all nullable (unset columns / no avatar). Ordered
// by last then first name. Open to every authenticated role incl. viewer.
export interface TeamRosterAthlete {
  id: string;
  name: string;
  position: string | null;
  classYear: string | null;
  jerseyNumber: string | null;
  avatarUrl: string | null;
}

// The team's roster, for the team hub's roster grid. Each card links to the
// athlete's public profile (/athletes/[id]).
export const getTeamRoster = (token: string, teamId: string) =>
  authGet<TeamRosterAthlete[]>(
    `/athletes?teamId=${encodeURIComponent(teamId)}`,
    token,
  );

// Create a team (admin/manager/field_rep). A duplicate name within the sport
// returns 409 -> "409 <message>", shown inline by the Add Game form.
export const createTeam = (token: string, input: CreateTeamInput) =>
  authPost<Team>('/teams', token, input);

// Create a game. Same roles as team create; returns the bare event row.
export const createEvent = (token: string, input: CreateEventInput) =>
  authPost<CreatedEvent>('/events', token, input);

// Create an assignment: a manager assigns a rep (input.repId) or self-claims a
// game (repId omitted). A self-claim lands in the caller's own My Games; a
// duplicate assignment comes back 409 -> "409 <message>", shown inline.
export const createAssignment = (token: string, input: CreateAssignmentInput) =>
  authPost<AssignmentRow>('/assignments', token, input);

// Advertisers to populate the Log a Sale dropdown (and to resolve businessName
// for ad-order listings, which carry only advertiserId).
export const getAdvertisers = (token: string) =>
  authGet<Advertiser[]>('/advertisers', token);

// Create an advertiser (name-only from the inline creator). A duplicate
// businessName returns 409 -> "409 <message>", shown inline.
export const createAdvertiser = (token: string, input: CreateAdvertiserInput) =>
  authPost<Advertiser>('/advertisers', token, input);

// Active ad packages to populate the (optional) package dropdown; selecting one
// pre-fills the order amount from its price.
export const getAdPackages = (token: string) =>
  authGet<AdPackage[]>('/ad-packages', token);

// The caller's own ad orders (a rep's logged sales), for the My Sales section.
export const getMyAdOrders = (token: string) =>
  authGet<AdOrder[]>('/ad-orders/mine', token);

// Manager/admin drill-down: one rep's ad orders (repId is a field_reps id). A
// manager is limited to their roster -- a rep off it comes back 403 ->
// "403 <message>"; the drill-down handles that without blanking the page.
export const getRepAdOrders = (token: string, repId: string) =>
  authGet<AdOrder[]>(`/ad-orders?repId=${encodeURIComponent(repId)}`, token);

// Log a sale: creates the ad order and its commission atomically. A field_rep's
// sale is always credited to themselves (backend-enforced). Send status "active".
export const createAdOrder = (token: string, input: CreateAdOrderInput) =>
  authPost<AdOrder>('/ad-orders', token, input);

// The presenting sponsor for a game (or null when none). Open to every role
// incl. viewer, so the fan-facing game page can render the "Presented by" strip.
export const getEventSponsorship = (token: string, eventId: string) =>
  authGet<Sponsorship | null>(
    `/sponsorships?eventId=${encodeURIComponent(eventId)}`,
    token,
  );

// Link an ad order to a game as its presenting sponsor. A rep may only use their
// own orders (enforced server-side); a game that already has a sponsor comes
// back 409 -> "409 This game already has a presenting sponsor", shown inline.
export const createSponsorship = (
  token: string,
  input: CreateSponsorshipInput,
) => authPost<Sponsorship>('/sponsorships', token, input);

// Remove a sponsorship. Permissions are enforced server-side (the rep who
// attached it, or staff); a foreign one surfaces as "<status> <message>".
export const deleteSponsorship = (token: string, id: string) =>
  authDelete(`/sponsorships/${id}`, token);

// ---- Live events: the courtside play-by-play stream on a game ----

// The live_event type enum on the backend. Each carries a small typed payload
// (see LiveEvent.payload) validated server-side. score_update ALSO syncs the
// events row scoreboard, so a fan poll sees the new score without a separate
// result save.
export type LiveEventType =
  | 'score_update'
  | 'period'
  | 'big_play'
  | 'timeout'
  | 'sponsor_spot'
  | 'status_note';

// A live_events row as returned by POST/GET /events/:id/live-events. payload is
// a per-type bag (the backend validates the shape for each type): score_update
// { homeScore, awayScore }, period { label }, big_play { text }, sponsor_spot
// { sponsorshipId }, timeout/status_note free-form. Typed loosely as optional
// fields so read sites can pull what a given type carries without a cast.
// createdAt is a timestamptz string WITH offset -- echo it back verbatim as the
// ?after= cursor (don't reformat it).
export interface LiveEvent {
  id: string;
  eventId: string;
  type: LiveEventType;
  payload: {
    homeScore?: number;
    awayScore?: number;
    label?: string;
    text?: string;
    sponsorshipId?: string;
    [key: string]: unknown;
  };
  createdAt: string;
}

// POST /events/:id/live-events body. payload rules per type are enforced on the
// backend; a bad shape comes back 400 -> "400 <message>". timeout/status_note
// take an optional free payload, so payload is optional here.
export interface CreateLiveEventInput {
  type: LiveEventType;
  payload?: Record<string, unknown>;
}

// The game's play-by-play, ascending, <=200 rows, open to all roles. Poll by
// passing the LAST seen event's createdAt as `after` (verbatim -- it includes
// the timezone offset); with no cursor this returns the full history so the fan
// feed can seed itself before it starts polling.
export const getLiveEvents = (token: string, eventId: string, after?: string) =>
  authGet<LiveEvent[]>(
    `/events/${eventId}/live-events${
      after ? `?after=${encodeURIComponent(after)}` : ''
    }`,
    token,
  );

// Emit one live event (admin or the assigned rep/manager). Returns the created
// row -- the console reconciles its optimistic score from the echoed payload.
export const createLiveEvent = (
  token: string,
  eventId: string,
  input: CreateLiveEventInput,
) => authPost<LiveEvent>(`/events/${eventId}/live-events`, token, input);

// Retract a live event (the emitter or an admin). 204, no body. NOTE the fan
// cursor poller can't see a deletion, so a retracted event lingers on already-
// loaded fan pages until reload -- an accepted v1 limitation.
export const deleteLiveEvent = (
  token: string,
  eventId: string,
  liveEventId: string,
) => authDelete(`/events/${eventId}/live-events/${liveEventId}`, token);

// ---- Applications: the public recruiting intake + the staff review queue ----

// The rep_status enum on the backend (field_reps.status). 'onboarding' gates a
// newly-approved rep behind training; 'active' unlocks their games portal.
export type RepStatus =
  | 'applicant'
  | 'onboarding'
  | 'active'
  | 'paused'
  | 'offboarded';

// A full applications row as returned by GET /applications (staff only). track
// maps 1:1 onto field_reps.kind and a role code. reviewedBy/reviewedAt/
// createdUserId are null until a staffer approves/rejects; createdUserId is the
// new sign-in id, present only after approval. Mirrors applications.service.ts.
export interface Application {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  city: string;
  state: string;
  track: 'field_rep' | 'regional_manager';
  hasSmartphone: boolean;
  pitch: string;
  resumeUrl: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdUserId: string | null;
  createdAt: string;
}

// POST /applications body (mirrors createApplicationSchema). The only
// unauthenticated write in the app. pitch must be >= 30 chars; resumeUrl, when
// present, must be an http(s) URL. phone/resumeUrl are optional.
export interface ApplyInput {
  fullName: string;
  email: string;
  phone?: string;
  city: string;
  state: string;
  track: 'field_rep' | 'regional_manager';
  hasSmartphone: boolean;
  pitch: string;
  resumeUrl?: string;
}

// POST /applications/:id/approve body (mirrors approveApplicationSchema).
// managerId (a regional_manager rep row) hangs the new rep under that manager;
// omit it and the approving manager auto-becomes the rep's manager.
export interface ApproveApplicationInput {
  managerId?: string;
  commissionRate?: number;
}

// The zod flatten() shape the API returns on a 400 from the create route
// (BadRequestException(error.flatten())). createApplication throws this so the
// apply form can render fieldErrors inline against each input.
export class ApplyValidationError extends Error {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
  constructor(fieldErrors: Record<string, string[]>, formErrors: string[]) {
    super(formErrors[0] ?? 'Please fix the highlighted fields.');
    this.name = 'ApplyValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

// PUBLIC create -- no token. A 400 (zod) throws ApplyValidationError with the
// per-field messages; a 409 (duplicate application OR an email that already has
// an account) throws the shared "409 <message>" Error the form turns into a
// "Sign in" nudge. Returns only { id, status } on success.
export async function createApplication(
  input: ApplyInput,
): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && (body.fieldErrors || body.formErrors)) {
      throw new ApplyValidationError(body.fieldErrors ?? {}, body.formErrors ?? []);
    }
  }
  throw await toError(res);
}

// Staff review queue: full rows, newest first. Defaults to status=submitted on
// the backend when no filter is given (admin, regional_manager).
export const getApplications = (token: string, status?: Application['status']) =>
  authGet<Application[]>(
    `/applications${status ? `?status=${status}` : ''}`,
    token,
  );

// Approve -> stands up the account (user + rep + role) and returns the updated
// application plus { userId, tempPassword } -- the sign-in credentials staff
// hand off to the applicant. tempPassword is shown once (never returned again).
export const approveApplication = (
  token: string,
  id: string,
  input: ApproveApplicationInput,
) =>
  authPost<Application & { userId: string; tempPassword: string }>(
    `/applications/${id}/approve`,
    token,
    input,
  );

// Reject -> stamps status + reviewer. No body; returns the updated application.
export const rejectApplication = (token: string, id: string) =>
  authPost<Application>(`/applications/${id}/reject`, token, {});

// Update a field_rep's status (admin, regional_manager). Used by the roster's
// "Activate" action to move an onboarding rep to 'active' (which also stamps
// onboardedAt server-side). Returns the updated field_reps row.
export const updateFieldRepStatus = (
  token: string,
  id: string,
  status: RepStatus,
) => authPatch<FieldRep>(`/field-reps/${id}/status`, token, { status });

// ---- LTI: one-time launch into the Academy (Moodle) ----

// GET /lti/launch/ticket (Bearer; caller needs a rep profile or admin) returns
// an absolute, one-time launch URL (60s expiry). Opening it in a browser tab
// runs the full LTI redirect chain and lands the user signed in inside Moodle.
export interface LtiLaunchTicket {
  url: string;
}

// Mint a launch ticket for the signed-in rep. A caller with no rep profile
// comes back 403 -> "403 <message>"; callers fall back to the plain Moodle URL.
export const getLtiLaunchTicket = (token: string) =>
  authGet<LtiLaunchTicket>('/lti/launch/ticket', token);

// ---- Game photos: correspondent upload + fan gallery (S3-style presigned PUT) ----

// A confirmed game photo as returned by GET /media?purpose=game_photo. publicUrl
// is the CDN/bucket URL used directly as the <img> src; uploaderUserId is a bare
// user id, matched against the signed-in user to decide who may delete a tile.
export interface GamePhoto {
  id: string;
  publicUrl: string;
  createdAt: string;
  uploaderUserId: string;
}

// POST /media/presign response. uploadUrl is a short-lived (10-min) presigned PUT
// bound to the exact contentType sent below; publicUrl is where the confirmed
// image will live; mediaId is the row to confirm/delete.
export interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  mediaId: string;
}

// Ask the API for a presigned upload slot for a game photo. purpose is fixed to
// "game_photo"; the backend enforces jpeg/png/webp, <=10MB, and that the caller
// is assigned to the event (else 403/400 -> "<status> <message>").
export const presignGamePhoto = (
  token: string,
  input: { fileName: string; contentType: string; sizeBytes: number; eventId: string },
) =>
  authPost<PresignResponse>('/media/presign', token, {
    purpose: 'game_photo',
    ...input,
  });

// Raw PUT of the file bytes to the presigned uploadUrl. This does NOT go through
// the API base and carries NO Authorization header -- the URL itself is the
// credential. The Content-Type MUST match the one sent to presign or the signed
// URL rejects it. A non-2xx (expired/mismatched) surfaces as "<status> upload".
export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`${res.status} upload failed`);
}

// Confirm an uploaded photo (POST /media/:id/confirm) so it becomes visible in
// GET /media. The success body isn't relied on (may be 200+json or 204), so this
// resolves to void -- callers already hold publicUrl/mediaId from presign.
export async function confirmMedia(token: string, mediaId: string): Promise<void> {
  const res = await fetch(`${BASE}/media/${mediaId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw await toAuthError(res);
}

// Confirmed photos for a game, viewer-allowed (any authenticated role). Used by
// the fan gallery and the workspace grid.
export const getGamePhotos = (token: string, eventId: string) =>
  authGet<GamePhoto[]>(
    `/media?eventId=${encodeURIComponent(eventId)}&purpose=game_photo`,
    token,
  );

// Delete a photo (uploader or admin, enforced server-side). 204, no body.
export const deleteMedia = (token: string, mediaId: string) =>
  authDelete(`/media/${mediaId}`, token);

// ---- NIL Phase 1: athlete deliverables + wallet, staff review queue + pools ----

// The money math stamped on a deliverable when it's approved: the gross (the
// deliverable's value), the platform fee taken from the school's pool, and the
// net credited to the athlete. All *_Cents are integer cents (divide by 100 at
// the render boundary); releasedAt is a timestamptz ISO string.
export interface NilRelease {
  grossCents: number;
  feeCents: number;
  netCents: number;
  releasedAt: string;
}

// A deliverable as returned by GET /nil/my-deliverables (the athlete's own).
// status walks assigned -> submitted -> approved. proofMediaId/proofPublicUrl are
// the confirmed proof upload attached at submit (null on an unstarted assigned
// card); reviewNote carries a staffer's send-back note on a returned (assigned)
// card. release is non-null only once approved.
export interface NilDeliverable {
  id: string;
  title: string;
  description: string | null;
  valueCents: number;
  status: 'assigned' | 'submitted' | 'approved';
  proofNote: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  createdAt: string;
  proofMediaId: string | null;
  proofPublicUrl: string | null;
  release: NilRelease | null;
  // Whether an approved/submitted deliverable is surfaced on the athlete's public
  // profile reel. Toggled at submit (showOnProfile on submit) or later via
  // setDeliverablePublicity. Only 'approved' + true items actually appear on the
  // profile, but the flag rides on every deliverable so the UI can reflect it.
  showOnProfile: boolean;
}

// One row in the athlete's wallet release history. Carries the same money math
// as a deliverable's release, plus the deliverable's title/id for the list (both
// optional -- the wallet is rendered defensively against the backend shape).
export interface NilWalletRelease extends NilRelease {
  id?: string;
  deliverableId?: string;
  title?: string | null;
}

// GET /nil/my-wallet (athlete). ledgerOnly is true in Phase 1 -- payouts are
// tracked here, not processed -- and the wallet caption is honest about that.
// totalNetCents is the sum of every release's net.
export interface NilWallet {
  totalNetCents: number;
  ledgerOnly: boolean;
  releases: NilWalletRelease[];
}

// A row in the staff NIL review queue (GET /nil/review-queue), one per submitted
// deliverable awaiting a decision. Carries the athlete's name, the value, and the
// proof (public URL + note) so a card renders without a follow-up lookup.
// institutionId, when present, is used to look up the pool's platform fee rate
// for the approve preview.
export interface NilReviewItem {
  id: string;
  title: string;
  description: string | null;
  // The submitting athlete: id (for a profile link) + first/last name, as the
  // review-queue query returns them (athletes is inner-joined, so athleteId is
  // always present; the names are non-null columns). Compose the display name at
  // the render boundary.
  athleteId: string;
  athleteFirstName: string | null;
  athleteLastName: string | null;
  valueCents: number;
  proofPublicUrl: string | null;
  proofNote: string | null;
  submittedAt: string | null;
  institutionId?: string | null;
}

// POST /nil/deliverables/:id/approve response: the updated deliverable plus the
// release math just stamped. A pool without enough balance comes back 409
// "Insufficient pool funds" -> surfaced as "409 <message>".
export interface NilApproveResponse {
  deliverable: NilDeliverable;
  release: NilRelease;
}

// GET /nil/pools/:institutionId (staff + that school's athletes). platformFeeRate
// is a fraction (0.15 = 15%); balanceCents is the pool's remaining balance. A
// school with no pool yet comes back with id null (zero-state). contributions/
// releases aren't rendered here (only the fee rate feeds the approve preview), so
// they're typed loosely.
export interface NilPool {
  id: string | null;
  balanceCents: number;
  platformFeeRate: number;
  contributions: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
}

// The athlete's own deliverables, any status, for the My NIL assignments board.
export const getMyDeliverables = (token: string) =>
  authGet<NilDeliverable[]>('/nil/my-deliverables', token);

// Submit a deliverable for review (assigned -> submitted). proofMediaId must be a
// CONFIRMED media_uploads row (purpose 'nil_proof'); a non-owner gets 403 and a
// non-assigned/unconfirmed proof a 409/400 -- all "<status> <message>". Returns
// the updated deliverable.
export const submitDeliverable = (
  token: string,
  id: string,
  input: { proofMediaId: string; proofNote?: string; showOnProfile?: boolean },
) => authPost<NilDeliverable>(`/nil/deliverables/${id}/submit`, token, input);

// Toggle whether a submitted/approved deliverable shows on the athlete's public
// profile reel (athlete owner only). Optimistic on the client; returns the
// updated deliverable. A non-owner gets 403 -> "403 <message>".
export const setDeliverablePublicity = (
  token: string,
  id: string,
  showOnProfile: boolean,
) =>
  authPatch<NilDeliverable>(`/nil/deliverables/${id}/publicity`, token, {
    showOnProfile,
  });

// The athlete's wallet: total net earned + the release ledger.
export const getMyWallet = (token: string) =>
  authGet<NilWallet>('/nil/my-wallet', token);

// Staff NIL review queue: submitted deliverables awaiting a decision (admin,
// regional_manager). A caller without that gate gets 403.
export const getNilReviewQueue = (token: string) =>
  authGet<NilReviewItem[]>('/nil/review-queue', token);

// Approve a submitted deliverable -> releases the funds and returns the deliverable
// + release math. 409 "Insufficient pool funds" when the pool can't cover it.
export const approveDeliverable = (token: string, id: string) =>
  authPost<NilApproveResponse>(`/nil/deliverables/${id}/approve`, token, {});

// Return a submitted deliverable to the athlete (submitted -> assigned) with an
// optional feedback note shown as an "editor's note" style callout on their card.
export const returnDeliverable = (
  token: string,
  id: string,
  input: { note?: string },
) => authPost<NilDeliverable>(`/nil/deliverables/${id}/return`, token, input);

// A school's NIL pool (staff + that school's athletes). Used by the review queue
// to read platformFeeRate for the approve preview.
export const getNilPool = (token: string, institutionId: string) =>
  authGet<NilPool>(`/nil/pools/${institutionId}`, token);

// Presign an upload slot for an NIL proof (image, video/mp4, or pdf, <=50MB --
// backend-enforced). Same presign -> PUT -> confirm chain as game photos, just a
// different purpose; reuse uploadToPresignedUrl(WithProgress) + confirmMedia.
export const presignNilProof = (
  token: string,
  input: { fileName: string; contentType: string; sizeBytes: number },
) =>
  authPost<PresignResponse>('/media/presign', token, {
    purpose: 'nil_proof',
    ...input,
  });

// Same raw presigned PUT as uploadToPresignedUrl, but over XMLHttpRequest so the
// caller can render a real upload progress bar (fetch can't report upload
// progress). onProgress is called with an integer 0-100. No Authorization header
// -- the URL is the credential -- and the Content-Type MUST match presign.
export function uploadToPresignedUrlWithProgress(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`${xhr.status} upload failed`));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

// ---- Athlete public profile: the social-style profile aggregate + owner edits ----

// GET /athletes/:id/profile (any authenticated role incl. viewer). A read-only
// aggregate assembled server-side from a few focused queries. EVERY URL field is
// null-safe (leftJoins), and NOTHING private leaks here -- no user_id, email, or
// money (the reel is the opted-in public subset only). Mirrors
// athletes.service.ts getProfile(). team/institution are null when unset.
export interface AthleteProfile {
  identity: {
    id: string;
    firstName: string;
    lastName: string;
    bio: string | null;
    jerseyNumber: string | null;
    position: string | null;
    classYear: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    // Normalized social profile URLs, present platforms only (see SocialLinks).
    socialLinks: SocialLinks;
    team: { id: string; name: string; sport: string } | null;
    institution: { id: string; name: string } | null;
  };
  stats: {
    deliverablesCompleted: number;
    articlesCount: number;
    teamGamesCount: number;
  };
  // The public content reel: approved deliverables the athlete opted to show.
  // proofContentType (e.g. 'image/jpeg', 'video/mp4', 'application/pdf') tells
  // the UI how to render the proof; proofPublicUrl is the media. NO money here.
  reel: Array<{
    id: string;
    title: string;
    releasedAt: string | null;
    proofPublicUrl: string | null;
    proofContentType: string | null;
  }>;
  // Published articles tagged to this athlete, for linking to /articles/[id].
  articles: Array<{ id: string; title: string; publishedAt: string | null }>;
  // The team's last 5 final games, both side names + scores, for /games/[id].
  recentGames: Array<{
    id: string;
    homeTeamName: string | null;
    awayTeamName: string | null;
    homeScore: number | null;
    awayScore: number | null;
    scheduledAt: string;
  }>;
}

// The public profile aggregate for one athlete. Open to every authenticated role
// (viewers/fans included). A bad id is a 404 -> "404 Athlete not found".
export const getAthleteProfile = (token: string, id: string) =>
  authGet<AthleteProfile>(`/athletes/${id}/profile`, token);

// GET /athletes/me (athlete-only) -> the caller's OWN athlete id. The one read
// that maps the signed-in user to their athlete row, so an athlete can link to
// and detect their own public profile (the profile read omits user_id by
// design). A caller with no athlete row (e.g. a bare admin) gets 404; callers
// treat that as "not an athlete" and simply hide the self-profile affordances.
export const getMyAthleteId = (token: string) =>
  authGet<{ athleteId: string }>('/athletes/me', token);

// PATCH /athletes/:id body (mirrors updateAthleteSchema). The athlete owner or an
// admin may send any subset; the backend requires at least one field. bio caps at
// 1000 chars ('' is a legit clear); jerseyNumber at 4; the media ids must be
// CONFIRMED uploads owned by the caller with purpose athlete_avatar/athlete_cover.
export interface UpdateAthleteInput {
  bio?: string;
  jerseyNumber?: string;
  avatarMediaId?: string;
  coverMediaId?: string;
  // Partial map of platform -> handle-or-URL. '' deletes a link; absent keys are
  // left untouched (backend merges). Values are validated/normalized server-side;
  // a bad value comes back 400 with per-field messages under fieldErrors.socialLinks.
  socialLinks?: SocialLinks;
}

// The zod flatten() body the athlete PATCH returns on a 400 (same shape as
// ApplyValidationError). socialLinks sub-errors collapse to fieldErrors.socialLinks
// as an array of messages, each prefixed with its platform label ("Instagram ...")
// so the edit form can map them back to the right input.
export class AthleteUpdateValidationError extends Error {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
  constructor(fieldErrors: Record<string, string[]>, formErrors: string[]) {
    super(formErrors[0] ?? 'Please fix the highlighted fields.');
    this.name = 'AthleteUpdateValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

// The bare athletes row returned by PATCH /athletes/:id (`.returning()`). Only
// the fields the edit surface reads back after a save are typed here; a foreign
// profile or bad media id surfaces as "<status> <message>".
export interface UpdatedAthlete {
  id: string;
  bio: string | null;
  jerseyNumber: string | null;
  avatarMediaId: string | null;
  coverMediaId: string | null;
  // The merged social map after the PATCH (normalized URLs, present keys only).
  socialLinks: SocialLinks;
}

// Edit one's own athlete profile (owner-or-admin, enforced server-side). Send
// only changed fields; an empty body is a 400. A zod 400 (e.g. a bad social link)
// throws AthleteUpdateValidationError with per-field messages so the edit form can
// render them inline; any other failure surfaces as the shared "<status> <message>".
export async function updateAthlete(
  token: string,
  id: string,
  input: UpdateAthleteInput,
): Promise<UpdatedAthlete> {
  const res = await fetch(`${BASE}/athletes/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && (body.fieldErrors || body.formErrors)) {
      throw new AthleteUpdateValidationError(body.fieldErrors ?? {}, body.formErrors ?? []);
    }
  }
  throw await toAuthError(res);
}

// Presign an upload slot for a profile avatar (image, <=5MB) or cover (image,
// <=10MB) -- backend-enforced, athlete-only. Same presign -> PUT -> confirm chain
// as game photos / NIL proofs; reuse uploadToPresignedUrlWithProgress +
// confirmMedia, then PATCH the athlete with the returned mediaId.
export const presignAthleteImage = (
  token: string,
  purpose: 'athlete_avatar' | 'athlete_cover',
  input: { fileName: string; contentType: string; sizeBytes: number },
) => authPost<PresignResponse>('/media/presign', token, { purpose, ...input });

// ---- Follows: follow athletes/teams/correspondents; personalized feed + suggestions ----

// The three things a user can follow. correspondent is followable via the API but
// has no dedicated page in this app yet, so no hero Follow button hosts it here.
export type FollowTargetType = 'athlete' | 'team' | 'correspondent';

// GET /follows/mine — the caller's follows, enriched and discriminated on
// targetType. Every entry carries followId + createdAt; the per-type fields
// identify the target and label it in the UI. URL fields are null-safe.
export type FollowMineEntry =
  | {
      targetType: 'athlete';
      followId: string;
      createdAt: string;
      athleteId: string;
      name: string;
      avatarUrl: string | null;
      teamName: string | null;
    }
  | {
      targetType: 'team';
      followId: string;
      createdAt: string;
      teamId: string;
      name: string;
      sport: string;
      institutionName: string | null;
    }
  | {
      targetType: 'correspondent';
      followId: string;
      createdAt: string;
      repId: string;
      displayName: string;
    };

// GET /follows/suggestions — the same shape as /mine plus a human-readable reason
// ("On a team you follow", etc.). Assignable to FollowMineEntry, so the shared
// FollowButton / carousel helpers accept a suggestion directly.
export type FollowSuggestion = FollowMineEntry & { reason: string };

// GET /follows/feed — the personalized content stream, discriminated on kind,
// newest-first and capped at 50. source is the follow that surfaced the entry
// (e.g. { type: 'team', name: 'Lincoln Lions' }) for the "via …" tag.
export type FollowFeedEntry =
  | {
      kind: 'game';
      id: string;
      matchup: string;
      homeTeamId: string | null;
      awayTeamId: string | null;
      homeScore: number | null;
      awayScore: number | null;
      status: 'scheduled' | 'live' | 'final' | 'postponed' | 'canceled';
      scheduledAt: string;
      source: { type: FollowTargetType; name: string };
    }
  | {
      kind: 'article';
      id: string;
      title: string;
      publishedAt: string | null;
      eventId: string | null;
      source: { type: FollowTargetType; name: string };
    };

// The POST/DELETE body — the target to (un)follow.
export interface FollowTargetInput {
  targetType: FollowTargetType;
  targetId: string;
}

// The stable target id out of a discriminated mine/suggestion entry (the id the
// follow rows on, per type). Used to key the carousel and build follow bodies.
export function followTargetId(
  entry: FollowMineEntry | FollowSuggestion,
): string {
  switch (entry.targetType) {
    case 'athlete':
      return entry.athleteId;
    case 'team':
      return entry.teamId;
    case 'correspondent':
      return entry.repId;
  }
}

// The display label out of a discriminated mine/suggestion entry.
export function followTargetName(
  entry: FollowMineEntry | FollowSuggestion,
): string {
  return entry.targetType === 'correspondent' ? entry.displayName : entry.name;
}

// The caller's follows, enriched. Fetch ONCE per session and share (see
// follows-context.tsx) — never per Follow button.
export const getMyFollows = (token: string) =>
  authGet<FollowMineEntry[]>('/follows/mine', token);

// The personalized content stream from everything the caller follows.
export const getFollowFeed = (token: string) =>
  authGet<FollowFeedEntry[]>('/follows/feed', token);

// Who to follow next — /mine-shaped entries each with a reason string.
export const getFollowSuggestions = (token: string) =>
  authGet<FollowSuggestion[]>('/follows/suggestions', token);

// The follower count for one target, for the "N followers" line beside a button.
export const getFollowCount = (
  token: string,
  targetType: FollowTargetType,
  targetId: string,
) =>
  authGet<{ count: number }>(
    `/follows/count?targetType=${targetType}&targetId=${encodeURIComponent(
      targetId,
    )}`,
    token,
  );

// POST /follows — idempotent 200 (re-following is a no-op), so the body isn't
// read. Following yourself comes back 409 -> "409 <message>"; the optimistic
// toggle reverts on that.
export async function followTarget(
  token: string,
  input: FollowTargetInput,
): Promise<void> {
  const res = await fetch(`${BASE}/follows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toAuthError(res);
}

// DELETE /follows — 204, no body back. Unlike the other DELETEs this one carries
// a JSON body (the target), so it can't use the shared bodyless authDelete.
export async function unfollowTarget(
  token: string,
  input: FollowTargetInput,
): Promise<void> {
  const res = await fetch(`${BASE}/follows`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toAuthError(res);
}
