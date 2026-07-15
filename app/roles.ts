// Role-based routing + navigation -- the single source of truth for where each
// role lands after login, which nav links a role may see, and which pages a
// role may open. The dashboard reports endpoints are @Roles('admin')-gated on
// the backend; the rest of this map mirrors what each surface actually needs so
// a role never gets bounced to a raw 403.

export type Role =
  | 'admin'
  | 'regional_manager'
  | 'field_rep'
  | 'athlete'
  | 'viewer';

// Every nav destination, in display order, tagged with the roles that may use
// it. navLinksFor() filters this; page access reuses the same intent below.
interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  // The athlete's home. Listed first so it leads their (short) nav; filtered out
  // for every other role, so it never reorders anyone else's links.
  { href: '/nil', label: 'My NIL', roles: ['athlete'] },
  {
    href: '/feed',
    label: 'Feed',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The college map (2k schools / 25.8k teams), open to everyone: a fan browses
  // for their school, staff plan territory over the rows we don't cover yet.
  // Sits next to Feed because it's the other "look around" surface -- both are
  // browse, not work.
  {
    href: '/discover',
    label: 'Discover',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The schedule: every upcoming and live game, filterable. Open to everyone —
  // it's the "what can I watch tonight?" surface. Sits between Discover (browse
  // the map) and My games (the games you work), which is the honest reading of
  // it: another fan browse, one row above its staff-only namesake.
  {
    href: '/games',
    label: 'Games',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  {
    href: '/my-games',
    label: 'My games',
    roles: ['admin', 'regional_manager', 'field_rep'],
  },
  // The rep's "business office": logged sales + earned commissions. Open to every
  // role that can hold a rep profile (a bare admin with no rep row sees the page's
  // branded access state, since the earnings call 403s).
  {
    href: '/my-sales',
    label: 'My sales',
    roles: ['admin', 'regional_manager', 'field_rep'],
  },
  { href: '/field-reps', label: 'Field reps', roles: ['admin', 'regional_manager'] },
  // Read-only advertiser directory. Same gate as Field Reps -- staff who manage
  // the territory book the ads (creation still happens via Log a Sale).
  { href: '/advertisers', label: 'Advertisers', roles: ['admin', 'regional_manager'] },
  // Editorial review queue: submitted articles awaiting an editor. Same gate as
  // the backend GET /content/review-queue (admin + regional_manager).
  { href: '/review', label: 'Review', roles: ['admin', 'regional_manager'] },
  // Staff NIL review queue: submitted deliverables awaiting approval. Same gate
  // as the backend GET /nil/review-queue (admin + regional_manager).
  { href: '/nil-review', label: 'NIL Review', roles: ['admin', 'regional_manager'] },
  { href: '/applicants', label: 'Applicants', roles: ['admin', 'regional_manager'] },
  { href: '/dashboard', label: 'Reports', roles: ['admin'] },
];

// Post-login landing, highest-priority role first. A user with several roles
// lands at the first one they hold; anyone else falls back to the read-only feed.
const LANDING: Array<{ role: Role; href: string }> = [
  { role: 'admin', href: '/dashboard' },
  { role: 'regional_manager', href: '/field-reps' },
  { role: 'field_rep', href: '/my-games' },
  { role: 'athlete', href: '/nil' },
  { role: 'viewer', href: '/feed' },
];

export function landingFor(roles: string[]): string {
  for (const { role, href } of LANDING) {
    if (roles.includes(role)) return href;
  }
  return '/feed';
}

export function navLinksFor(roles: string[]): Array<{ href: string; label: string }> {
  return NAV_ITEMS.filter((item) =>
    item.roles.some((r) => roles.includes(r)),
  ).map(({ href, label }) => ({ href, label }));
}

// Which roles may open a given page. Paths not listed are open to any
// authenticated user (/feed, /search). /managers/:id shares the Field Reps gate
// since the "View roster" link that reaches it lives on that page.
//
// NOTE: /apply is deliberately absent -- it is a PUBLIC page that renders its
// own minimal branded shell (no AppNav) and never touches the auth session, so
// it needs no entry here and never redirects an anonymous visitor to login.
const PAGE_ACCESS: Array<{ match: (path: string) => boolean; roles: Role[] }> = [
  { match: (p) => p === '/dashboard', roles: ['admin'] },
  { match: (p) => p === '/field-reps', roles: ['admin', 'regional_manager'] },
  // Read-only advertiser directory -- same gate as Field Reps.
  { match: (p) => p === '/advertisers', roles: ['admin', 'regional_manager'] },
  // The staff review queue for the public /apply intake. Same gate as Field
  // Reps (the backend restricts GET/approve/reject to these two roles).
  { match: (p) => p === '/applicants', roles: ['admin', 'regional_manager'] },
  // Editorial review queue -- same gate as the backend review-queue route.
  { match: (p) => p === '/review', roles: ['admin', 'regional_manager'] },
  // The athlete's NIL home (deliverables + wallet) -- athlete-only.
  { match: (p) => p === '/nil', roles: ['athlete'] },
  // Staff NIL review queue -- same gate as GET /nil/review-queue.
  { match: (p) => p === '/nil-review', roles: ['admin', 'regional_manager'] },
  { match: (p) => p.startsWith('/managers/'), roles: ['admin', 'regional_manager'] },
  // Rep drill-down, reached by clicking a rep on the roster page -- same gate as
  // the roster. The API still enforces roster membership per rep (a manager
  // opening a rep off their roster 403s), which the page surfaces as AccessDenied.
  { match: (p) => p.startsWith('/reps/'), roles: ['admin', 'regional_manager'] },
  {
    match: (p) => p === '/my-games',
    roles: ['admin', 'regional_manager', 'field_rep'],
  },
  // The per-game workspace (/my-games/:eventId) shares My Games' role gate. The
  // API still enforces assignment ownership; the page also matches the id against
  // the caller's own /assignments/mine and shows the branded access state if it
  // isn't one of theirs.
  {
    match: (p) => p.startsWith('/my-games/'),
    roles: ['admin', 'regional_manager', 'field_rep'],
  },
  // Same role gate as My Games; the rep-profile check (which a bare admin fails)
  // happens at the API on the earnings call, surfaced as the page's access state.
  {
    match: (p) => p === '/my-sales',
    roles: ['admin', 'regional_manager', 'field_rep'],
  },
  // The schedule (/games) — every game, filterable, nav-reached by every role.
  // Must come before the /games/ rule below: that one is a startsWith and would
  // not match the bare path anyway, but keeping the exact match first means the
  // two never depend on each other's ordering.
  {
    match: (p) => p === '/games',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The fan-facing game page is open to every authenticated role -- a viewer
  // reaches it by clicking any game card on the feed or search results. Listed
  // explicitly (rather than relying on the open-by-default fallback) so the
  // intent is legible alongside the staff-gated pages above.
  //
  // athlete was missing here while the comment above claimed "every
  // authenticated role", so an athlete clicking a game card on the feed (a page
  // they can reach) hit AccessDenied. /games makes that reachable from the nav
  // too, so the gap is fixed rather than widened.
  {
    match: (p) => p.startsWith('/games/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The public athlete profile (/athletes/:id) is open to every authenticated
  // role incl. viewer/fans -- reached by name links from the NIL review queue,
  // an athlete's own "View my public profile" link, and (later) team rosters.
  // There is deliberately NO nav item; it's a link-reached page. The backend
  // GET /athletes/:id/profile carries the same gate and enforces what each read
  // may expose. Athlete included so an athlete can open their own profile.
  {
    match: (p) => p.startsWith('/athletes/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The team hub (/teams/:id) -- the fan surface tying games, articles, photos,
  // and the roster together. Open to every authenticated role incl. viewer, same
  // as the game and athlete pages it links between. NO nav item; link-reached
  // (from athlete affiliations and game scoreboards). The backend GET /teams/:id
  // and GET /athletes?teamId= carry the same all-roles gate.
  {
    match: (p) => p.startsWith('/teams/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The school and conference hubs — the front doors onto the imported college
  // dataset. Same all-roles gate as the team/athlete pages they link between,
  // matching the backend GET /institutions/:id and GET /conferences/:id. NO nav
  // items; both are link-reached (from a team hero, an athlete affiliation, or
  // each other).
  {
    match: (p) => p.startsWith('/schools/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  {
    match: (p) => p.startsWith('/conferences/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // The browse surface over the whole college map, feeding the school and team
  // hubs above. Open to every authenticated role, same as its destinations and
  // the backend GET /institutions and GET /teams it reads. Listed explicitly
  // rather than left to the open-by-default fallback: it's the rare all-roles
  // page that IS nav-reached, so the intent should be legible here.
  {
    match: (p) => p === '/discover',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
];

export function canAccess(roles: string[], pathname: string): boolean {
  const rule = PAGE_ACCESS.find((r) => r.match(pathname));
  if (!rule) return true;
  return rule.roles.some((r) => roles.includes(r));
}
