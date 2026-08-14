'use client';

// ============================================================================
// /arena/clash — BUREAU CLASH. The Arena game you do not play.
//
// There is no pick here, no entry, no daily action. Every credit earned in every
// OTHER Arena game scores for your city, which makes this a STATUS BOARD rather
// than a play surface — and the thing the screen has to land is that a fan's
// ordinary play elsewhere has already been counting for something all week.
// That is why the contribution meter sits second, directly under the tug, and
// why nothing on this page has a call to action except the one screen that
// genuinely does: picking a city.
//
// ONE PAGE, THREE CARDS, NOT THREE TABS. The spec's `g4-clash`, `g4-standings`
// and `g4-posts` are a static mockup's paging device. Everything they hold is
// short — a tug, a meter, a board of contributors, six standings rows — and a
// fan who has to tab to find out whether their city is winning has been charged
// a tap for nothing.
//
// THREE READS, SETTLING INDEPENDENTLY, exactly as the hub does it. The tug gates
// the screen because it IS the game (and it is the read that decides which of
// five states the page even is); posts and standings are context and each fails
// alone. A fan whose standings call 500s still gets their tug.
//
// POLLING: FIVE MINUTES, ON THE TUG ALONE, and only while a week is live. The
// spec insists twice that there are no websockets in v1, and the tug is the only
// thing on the page that moves — posts are static once written and standings
// only change on a Sunday. An `unaffiliated` or `no_week` page polls nothing at
// all: there is no board to move.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import {
  ClashBureau,
  ClashMembership,
  ClashPost,
  ClashStanding,
  ClashTug,
  getClashBureaus,
  getClashMe,
  getClashPosts,
  getClashStandings,
  getClashTug,
} from '../../api';
import { ClashBoard } from './board';
import { JoinBoard } from './join-board';
import { ClashPostsFeed } from './posts';

const POLL_MS = 5 * 60 * 1000;

export default function ClashPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [tug, setTug] = useState<ClashTug | null>(null);
  const [posts, setPosts] = useState<ClashPost[]>([]);
  const [standings, setStandings] = useState<ClashStanding[]>([]);
  const [season, setSeason] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ticks the countdown without re-reading. The clock is local; the numbers
  // behind it are not.
  const [now, setNow] = useState(() => Date.now());

  // Whether the fan is switching bureaus rather than joining for the first
  // time. Opens the same board over an existing membership.
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    // The tug is the one read that can fail the page — everything else degrades.
    const next = await getClashTug(token);
    setTug(next);
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;

    setLoading(true);
    getClashTug(token)
      .then((next) => {
        if (!cancelled) setTug(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not reach the board');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Context reads. Neither rethrows: a dead standings call must not take the
    // tug's render with it.
    getClashPosts(token)
      .then((res) => {
        if (!cancelled && res.state === 'ok') setPosts(res.items);
      })
      .catch(() => undefined);

    getClashStandings(token)
      .then((res) => {
        if (cancelled) return;
        setStandings(res.items);
        setSeason(res.season);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  // ---- THE POLL. Only while a board is actually live — see the header.
  const live = tug?.state === 'paired' || tug?.state === 'free_for_all';
  useEffect(() => {
    if (!live || !token) return;
    const timer = setInterval(() => {
      load().catch(() => undefined);
      setNow(Date.now());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, token, load]);

  // ---- THE CLOCK. A minute is the finest granularity this countdown ever
  // shows ("Resolves in 4h 12m"), so a minute is how often it ticks. A
  // per-second timer would repaint 60× for a string that changes once.
  useEffect(() => {
    if (!tug || tug.state === 'unaffiliated' || tug.state === 'no_week') return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [tug]);

  // After a join or a switch, re-read everything: the fan's whole page changes
  // identity, and the posts they can now see belong to a different bureau.
  async function afterJoin() {
    setSwitching(false);
    setLoading(true);
    try {
      await load();
      if (token) {
        const [p, s] = await Promise.allSettled([
          getClashPosts(token),
          getClashStandings(token),
        ]);
        if (p.status === 'fulfilled' && p.value.state === 'ok') {
          setPosts(p.value.items);
        }
        if (s.status === 'fulfilled') {
          setStandings(s.value.items);
          setSeason(s.value.season);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the board');
    } finally {
      setLoading(false);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home clash-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      {/* ---- THE CONTENT COLUMN. The page itself now runs the full width and
          THIS carries the measure, which is the whole point: the header row
          above is outside it, so the global nav gets the window rather than
          whatever cap this page's content happens to want. That coupling is
          RESOLVER_TICKETS.md W1, and moving the cap off `main` retires it for
          these pages.

          The content geometry is unchanged -- these blocks are vertical stacks
          and a centred column is what they want. Nothing here makes the Arena
          stop looking like a column; that is W2. ---- */}
      <div className="arena-col">

      <div className="page-head">
        <div>
          <h1 className="row-title page-head__title">Bureau Clash</h1>
        </div>
        <div className="masthead-actions">
          <Link href="/arena" className="link-btn">
            ← The Arena
          </Link>
        </div>
      </div>

      {loading && !tug && <div className="card muted">Reading the board…</div>}
      {error && <div className="error">{error}</div>}

      {/* ---- THE POSTS COME FIRST. This page is their only home in the app,
          and the Sunday banner is the beat the whole game is built around — a
          fan opening this on a Monday should meet it before anything else.
          Self-hides when there is nothing pinned. ---- */}
      {tug && tug.state !== 'unaffiliated' && <ClashPostsFeed posts={posts} />}

      {/* ---- UNAFFILIATED: the join board IS the page. 38 of 45 accounts are
          here, so this is the front door, not a fallback. The bureau list rides
          in on the same tug response — no second read. ---- */}
      {tug && tug.state === 'unaffiliated' && (
        <JoinBoard
          token={token}
          bureaus={tug.bureaus}
          current={null}
          onJoined={afterJoin}
        />
      )}

      {/* ---- SWITCHING: the same board over an existing membership. ---- */}
      {tug && tug.state !== 'unaffiliated' && switching && (
        <>
          <button
            type="button"
            className="link-btn clash-switch__back"
            onClick={() => setSwitching(false)}
          >
            ← Back to the board
          </button>
          <SwitchBoard token={token} onJoined={afterJoin} />
        </>
      )}

      {tug && tug.state !== 'unaffiliated' && !switching && (
        <>
          {/* The season label falls back through every place it is available —
              the standings read, then the live week, then the membership row —
              because the standings call is the one allowed to fail and its
              header should not read "Season" with a hole in it when it does. */}
          <ClashBoard
            tug={tug}
            standings={standings}
            season={season || seasonFrom(tug)}
            meId={user?.id}
            now={now}
          />

          {/* The way out, and it is a quiet link rather than a button: changing
              your bureau is a real commitment and should not sit on the page
              looking like an action the game wants you to take. */}
          <button
            type="button"
            className="link-btn clash-switch__open"
            onClick={() => setSwitching(true)}
          >
            Change my bureau
          </button>
        </>
      )}
      </div>
    </main>
  );
}

function seasonFrom(tug: ClashTug): string {
  switch (tug.state) {
    case 'no_week':
      return tug.bureau.season;
    case 'unpaired':
      return tug.week.season;
    case 'paired':
    case 'free_for_all':
      return tug.week.season;
    default:
      return '';
  }
}

// THE SWITCH BOARD needs two things the live tug does not carry: the full bureau
// list (the tug ships it only on its unaffiliated branch) and `switch_used` (the
// paired branch carries sides, not a bureau row). Both are read HERE, when the
// fan asks to switch, rather than on every page load for every fan who never
// will.
//
// It renders only once BOTH have landed. A join board drawn before `switch_used`
// is known would show five live cities to a fan who has already spent their
// change — an invitation the next tap turns into a 409, which is the exact
// ambush the commitment copy exists to prevent.
function SwitchBoard({
  token,
  onJoined,
}: {
  token: string;
  onJoined: () => void;
}) {
  const [bureaus, setBureaus] = useState<ClashBureau[] | null>(null);
  const [me, setMe] = useState<ClashMembership | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getClashBureaus(token), getClashMe(token)])
      .then(([list, mine]) => {
        if (cancelled) return;
        setBureaus(list.items);
        setMe(mine);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load bureaus');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) return <div className="error">{error}</div>;
  if (!bureaus) return <div className="card muted">Loading cities…</div>;

  return (
    <JoinBoard
      token={token}
      bureaus={bureaus}
      current={me}
      onJoined={onJoined}
    />
  );
}
