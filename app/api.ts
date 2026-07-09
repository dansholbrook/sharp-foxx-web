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

export const getCommissions = (token: string) =>
  authGet<CommissionsReport>('/reports/commissions', token);

export const getRevenue = (token: string) =>
  authGet<RevenueReport>('/reports/revenue', token);

export const getFieldReps = (token: string) =>
  authGet<FieldRep[]>('/field-reps', token);

export const getManagerReps = (token: string, id: string) =>
  authGet<ManagerRoster>(`/reports/managers/${id}/reps`, token);

export const getMyAssignments = (token: string) =>
  authGet<MyAssignment[]>('/assignments/mine', token);

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

// Any content already attached to a game, so a rep can find/edit an existing
// article on load (not just right after generating). Returns the joined listing
// shape, newest-created first for this non-published view.
export const getEventContent = (token: string, eventId: string) =>
  authGet<EventContentItem[]>(`/content?eventId=${eventId}`, token);

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
