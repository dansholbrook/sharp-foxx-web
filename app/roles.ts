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

// WHERE A NAV ITEM SITS, which is a different question from who may see it.
//
//   'section'  — the top bar. A place on the platform, named the same way for
//                everyone who has it. Fans and staff share most of these.
//   'console'  — behind the single "Console" menu. THE HOUSE'S BACK OFFICE:
//                queues, directories, and the economy. Not "everything staff",
//                which is the definition this deliberately isn't — a field
//                rep's My Games IS their job, and burying a role's primary
//                surface to satisfy a tidiness rule is backwards. So My Games
//                and My Sales stay in the bar for the roles that hold them.
//
// The account items (My profile, My picks, notification settings, change
// password, log out) are in NEITHER group and are not in this array at all:
// they're identical for every signed-in role, so a role filter would be a
// no-op. They're written out once in the avatar menu in nav.tsx.
type NavGroup = 'section' | 'console';

// Every nav destination, in display order, tagged with the roles that may use
// it. navLinksFor() filters this; page access reuses the same intent below.
interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  group: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  // The athlete's home. Listed first so it leads their (short) nav; filtered out
  // for every other role, so it never reorders anyone else's links.
  { href: '/nil', label: 'My NIL', roles: ['athlete'], group: 'section' },
  {
    href: '/feed',
    label: 'Feed',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
    group: 'section',
  },
  // The college map (2k schools / 25.8k teams), open to everyone: a fan browses
  // for their school, staff plan territory over the rows we don't cover yet.
  // Sits next to Feed because it's the other "look around" surface -- both are
  // browse, not work.
  {
    href: '/discover',
    label: 'Discover',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
    group: 'section',
  },
  // The schedule: every upcoming and live game, filterable. Open to everyone —
  // it's the "what can I watch tonight?" surface. Sits between Discover (browse
  // the map) and My games (the games you work), which is the honest reading of
  // it: another fan browse, one row above its staff-only namesake.
  {
    href: '/games',
    label: 'Games',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
    group: 'section',
  },
  // Contests: browse open pick'em contests, enter, fill a pick sheet, follow the
  // leaderboard. A play surface, so it carries a nav LINK for every role (unlike
  // /picks + /leaderboard, whose pages are open to all but whose links are
  // fan-only) — staff play too, and the backend puts no @Roles on the fan
  // contest routes. Sits next to Games, the other browse-and-play surface.
  {
    href: '/contests',
    label: 'Contests',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
    group: 'section',
  },
  // The Arena: the free daily games — Beat the Oracle, the Foxx Trail, and
  // whatever lands next. ONE nav item, and the hub at /arena is where a fan
  // chooses; a link per game would grow the nav every time the Arena does, and
  // would bury the category itself. Every role, same as Contests and for the
  // same reason — the backend's fan routes carry no @Roles because the Arena is
  // the free front door to the product, and staff play along. Sits directly
  // after Contests: both are play surfaces, but this one is the DAILY one, so
  // it leads the pair a fan opens out of habit.
  {
    href: '/arena',
    label: 'Arena',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
    group: 'section',
  },
  // The points leaderboard. NOW EVERY ROLE, where it used to be fan-only.
  //
  // The old fan-only split on this and on /profile + /picks was never about
  // access — all three PAGES have always been open to everyone (see
  // PAGE_ACCESS below), because the backend puts no @Roles on the pick and
  // leaderboard routes and staff play along. It was about room: staff nav was
  // fifteen items deep and these were the three that could be cut. Console
  // gives that room back, so the standings stop being something only fans can
  // find, and /profile + /picks move into the avatar menu where every role
  // reaches them. The ⚡ chip still points at /profile; it is simply no longer
  // the only door staff have to it.
  {
    href: '/leaderboard',
    label: 'Leaderboard',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
    group: 'section',
  },
  // A REP'S OWN WORK, AND WHY IT IS NOT IN CONSOLE. Console is the house's back
  // office; My Games is a correspondent's entire job, and My Sales is where a
  // rep's commission lives. Putting a role's primary surface two taps deep to
  // make the bar tidier would be optimising the wrong thing — a field rep's bar
  // is seven items with these in it, which is not a crowding problem.
  {
    href: '/my-games',
    label: 'My games',
    roles: ['admin', 'regional_manager', 'field_rep'],
    group: 'section',
  },
  // The rep's "business office": logged sales + earned commissions. Open to every
  // role that can hold a rep profile (a bare admin with no rep row sees the page's
  // branded access state, since the earnings call 403s).
  {
    href: '/my-sales',
    label: 'My sales',
    roles: ['admin', 'regional_manager', 'field_rep'],
    group: 'section',
  },

  // ---- CONSOLE: the house's back office. -----------------------------------
  //
  // THESE ARE DELIBERATELY NOT GROUPED BY JOB. Splitting them into "editorial"
  // / "territory" / "platform" would be inventing an information architecture
  // and then having to defend it, and nobody yet knows which of these pages
  // gets opened daily and which twice a quarter. Grouping is worth doing off
  // real usage; until then a flat list in a sensible order is honest about what
  // we know. This is deferred, not missed.
  { href: '/field-reps', label: 'Field reps', roles: ['admin', 'regional_manager'], group: 'console' },
  // Read-only advertiser directory. Same gate as Field Reps -- staff who manage
  // the territory book the ads (creation still happens via Log a Sale).
  //
  // CONSOLE IS THIS PAGE'S ONLY DOOR. Nothing else in the app links to
  // /advertisers, so it must stay listed here or it becomes unreachable.
  { href: '/advertisers', label: 'Advertisers', roles: ['admin', 'regional_manager'], group: 'console' },
  // Editorial review queue: submitted articles awaiting an editor. Same gate as
  // the backend GET /content/review-queue (admin + regional_manager).
  { href: '/review', label: 'Review', roles: ['admin', 'regional_manager'], group: 'console' },
  // Staff NIL review queue: submitted deliverables awaiting approval. Same gate
  // as the backend GET /nil/review-queue (admin + regional_manager).
  { href: '/nil-review', label: 'NIL Review', roles: ['admin', 'regional_manager'], group: 'console' },
  { href: '/applicants', label: 'Applicants', roles: ['admin', 'regional_manager'], group: 'console' },
  // The National Board's management surface: open a house question, then lock /
  // resolve / void it. admin + regional_manager ONLY -- field_rep is excluded
  // deliberately, mirroring the backend's NATIONAL_ROLES (a rep opens questions
  // courtside on their own games; a national question speaks for the house).
  //
  // A page of its own rather than a section on an existing surface: every staff
  // page here is scoped to a territory, a roster, or a queue, and a national
  // question is scoped to none of them -- it has no game, no rep, and no review
  // state to hang off. /my-games/:eventId is the closest cousin (it carries the
  // per-game prediction console) but it is per-EVENT by construction, which is
  // exactly what a national question isn't. Sits last among the staff queues,
  // next to Reports: like Reports, it's a house-wide surface, not territory work.
  { href: '/national-admin', label: 'National', roles: ['admin', 'regional_manager'], group: 'console' },
  // The Correspondent's Call editorial desk: designate the week's game, name the
  // correspondent, and follow the card from draft to graded. admin +
  // regional_manager, mirroring the backend's CALL_CREATE_ROLES / CALL_READ_ROLES
  // -- a field_rep composes and grades, but does not CREATE, and cannot list.
  //
  // A NAV ITEM RATHER THAN A TILE ON /arena. The Arena hub is a fan surface --
  // three game cards and a streak strip -- and hanging a staff console off it
  // would put an editorial workflow inside the thing fans open out of habit.
  // Same call /national-admin made for the same reason, so it sits next to it:
  // both are house-wide editorial surfaces rather than territory work.
  //
  // THERE IS DELIBERATELY NO NAV ITEM FOR THE CORRESPONDENT. A field rep holds a
  // Call perhaps a few weeks a year; a permanent link that is a dead end most of
  // the time is worse than none. Their door is the tile on the game's own
  // workspace, which appears only when that game HAS a Call.
  { href: '/arena/call/desk', label: 'Call desk', roles: ['admin', 'regional_manager'], group: 'console' },
  // The engagement economy console: what each passive action pays, and the
  // scheduled multiplier windows. admin + regional_manager, matching the
  // backend's ECONOMY_READ_ROLES — but an RM sees it READ-ONLY, because every
  // write route narrows to @Roles('admin'). An RM needs to answer "why did my
  // fans stop earning check-in points?" without being able to move the economy.
  // Next to National and Reports: another house-wide surface, not territory work.
  { href: '/economy', label: 'Economy', roles: ['admin', 'regional_manager'], group: 'console' },
  { href: '/dashboard', label: 'Reports', roles: ['admin'], group: 'console' },
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

export interface NavLink {
  href: string;
  label: string;
}

// The nav, split the way it is rendered: `sections` is the top bar, `console`
// is the single menu behind it. Returning two arrays rather than one flat list
// keeps the grouping decision in this file, where the reasoning for it lives,
// instead of leaving nav.tsx to re-derive it from hrefs.
//
// `console` is empty for every fan role, which is how nav.tsx knows not to
// render the Console trigger at all — there is no such thing as an empty menu.
export function navLinksFor(roles: string[]): {
  sections: NavLink[];
  console: NavLink[];
} {
  const mine = NAV_ITEMS.filter((item) =>
    item.roles.some((r) => roles.includes(r)),
  );
  const pick = (group: NavGroup): NavLink[] =>
    mine
      .filter((item) => item.group === group)
      .map(({ href, label }) => ({ href, label }));
  return { sections: pick('section'), console: pick('console') };
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
  // The National Board console. Mirrors the backend's NATIONAL_ROLES, which is a
  // deliberate SUBSET of the OPENER_ROLES that guard the prediction writes: a
  // field_rep may open a question on a game they're working, but not one that
  // speaks for the house. The API enforces this per-request in the service
  // (assertMayAdminister) rather than via a route guard, because the rule
  // depends on the scope in the body/row -- so this gate keeps a rep off a page
  // whose every button would 403 rather than duplicating that check.
  { match: (p) => p === '/national-admin', roles: ['admin', 'regional_manager'] },
  // The economy console. Same READ gate as the backend (admin + RM); the page
  // itself renders read-only for an RM rather than letting them fire writes that
  // would 403. Same pattern as /national-admin: keep the role off pages whose
  // every button fails, and narrow within the page where the backend narrows.
  { match: (p) => p === '/economy', roles: ['admin', 'regional_manager'] },
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
  // The points surfaces. Open to EVERY authenticated role: the backend puts no
  // @Roles on /predictions/my-picks or /leaderboards/points because any caller
  // can pick, so a rep who followed their ⚡ chip here must not hit AccessDenied
  // on their own points.
  //
  // These three used to be wider than their nav links, which were fan-only for
  // room rather than for access. That gap is now closed: /leaderboard is a
  // section for every role above, and /profile + /picks are in the avatar menu,
  // which every signed-in role gets. Still listed explicitly rather than left
  // to the open-by-default fallback, because "open to everyone" is the load-
  // bearing fact here and it should be readable, not inferred.
  {
    match: (p) => p === '/profile',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  {
    match: (p) => p === '/picks',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  {
    match: (p) => p === '/leaderboard',
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // Contests — the list and every contest page. Open to EVERY authenticated
  // role (staff play too; the backend fan routes carry no @Roles), matching the
  // all-roles nav link above. Listed explicitly rather than left to the
  // open-by-default fallback so the intent reads alongside the points surfaces.
  {
    match: (p) => p === '/contests' || p.startsWith('/contests/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
  // ---- THE CALL'S STAFF TOOLS. THESE MUST STAY ABOVE THE /arena RULE BELOW. ----
  //
  // canAccess takes the FIRST matching rule, and the next entry is a
  // startsWith('/arena/') open to every role -- so a staff path under /arena
  // listed after it would inherit the fan gate and every viewer and athlete
  // would walk straight onto the editorial desk. Ordering is the gate here.
  //
  // The desk is CALL_CREATE_ROLES / CALL_READ_ROLES: editorial designates the
  // week's game and reads the schedule.
  { match: (p) => p === '/arena/call/desk', roles: ['admin', 'regional_manager'] },
  // Compose and grade are CALL_COMPOSE_ROLES, which adds field_rep and stops
  // there -- no viewer, no athlete.
  //
  // THIS GATE IS COARSE ON PURPOSE, and it is the same shape /national-admin
  // describes: "is this rep the named correspondent, and are they still assigned
  // to the game" is a fact about two ROWS, so the backend enforces it per-request
  // in CallService.assertCanCompose rather than in a route guard. Any field rep
  // can therefore open a colleague's Call here and take a 403 from the service.
  // That is not a hole to plug in this file -- duplicating a row-level rule in
  // the client would only give it a second place to be wrong. Both pages render
  // that 403 as a "this isn't your Call" state instead of an error box.
  {
    match: (p) => p.startsWith('/arena/call/compose/') || p.startsWith('/arena/call/grade/'),
    roles: ['admin', 'regional_manager', 'field_rep'],
  },
  // The Arena — the hub and every game under it (/arena/oracle, /arena/trail,
  // and whatever mounts next). Open to EVERY authenticated role, matching the
  // all-roles nav link and the backend's deliberately ungated fan routes (every
  // today / pick / map / leaderboard route in the arena module carries no
  // @Roles at all). ONE prefix rule rather than a line per game: the Arena's
  // gate is a property of the Arena, and a new game that had to remember to add
  // itself here would ship as a 403 for everyone.
  //
  // The three rules directly above are the exception and prove the rule: they
  // are STAFF TOOLS that happen to live at an Arena address, so each one is
  // listed by name and each one must stay ABOVE this line. A fan address under
  // /arena still needs no entry at all.
  {
    match: (p) => p === '/arena' || p.startsWith('/arena/'),
    roles: ['admin', 'regional_manager', 'field_rep', 'athlete', 'viewer'],
  },
];

export function canAccess(roles: string[], pathname: string): boolean {
  const rule = PAGE_ACCESS.find((r) => r.match(pathname));
  if (!rule) return true;
  return rule.roles.some((r) => roles.includes(r));
}
