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
  status: 'draft' | 'published';
  authorUserId: string | null;
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
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
  status: 'draft' | 'published' | 'archived';
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

// A teams row as returned by GET /teams?sport=<sport> (teams.service.ts),
// ordered by name. level is the backend enum ('pro' | 'college' |
// 'high_school'); league is nullable (optional on create).
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

export async function login(userId: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

async function authGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toError(res);
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
  if (!res.ok) throw await toError(res);
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
  if (!res.ok) throw await toError(res);
  return res.json();
}

// DELETE returns 204 (no body), so there's nothing to parse -- resolve to void.
async function authDelete(path: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toError(res);
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

// Publishing/unpublishing are editorial actions (author-or-manager). Both take
// no body and return the updated row with its new status/publishedAt.
export const publishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/publish`, token, {});

export const unpublishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/unpublish`, token, {});

// Teams for a sport, name-ordered, to populate the Add Game team dropdowns.
export const getTeams = (token: string, sport: string) =>
  authGet<Team[]>(`/teams?sport=${encodeURIComponent(sport)}`, token);

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
