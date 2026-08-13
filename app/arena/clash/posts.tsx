'use client';

// ============================================================================
// THE AUTO-POSTS — two a week, pinned, and THIS PAGE IS THEIR ONLY HOME.
//
// The controller says it plainly: the bureau board is where these land "until
// chat exists to hold them." There is no other surface in the app that renders
// them, so anything they don't say here, nobody reads. That is why they sit at
// the TOP of /arena/clash, above the tug — a pinned post is the loudest thing
// this game says and the reason a fan opens the page on a Monday at all.
//
// TWO KINDS, TWO WEIGHTS, and the difference is the whole retention mechanic:
//
//   'matchup' (Mon 00:01) — an announcement. Headline, body, two chips. It sets
//     up the week and then gets out of the way.
//
//   'result'  (Sun 23:59) — THE BANNER. Full display treatment, because this is
//     the beat the game is built around: a fan opens the app on Monday morning
//     and their city won something while they were asleep, off work they had
//     already done. It stays pinned until the next week takes it down.
//
// WHAT IS DELIBERATELY NOT BUILT: the spec's "▶ Play Sunday's resolve" button
// and its unfurl animation. That is a reviewer's device for demoing a state on a
// static page. In the real client the banner is simply THERE on Monday morning,
// already hung — a fan who has to press play to find out whether their city won
// has been handed a chore, and the one emotional beat of the week has been put
// behind a button.
//
// NO POLLING HERE. These are static once written; the tug is the only thing on
// the page that moves.
// ============================================================================

import { ClashPost, etDateTime } from '../../api';

// The result post's body arrives as one prose sentence with the numbers inside
// it ("10.00 average per active member — 10 Clash Points from 1 active
// member..."). It is rendered WHOLE rather than parsed apart: the server owns
// that sentence, and a client that split it on an em-dash would break the first
// time the copy changed. The loot row in the spec is drawn from the fields the
// client already has instead — see the board — not by mining this string.
function ResultPost({ post }: { post: ClashPost }) {
  return (
    <article className="clash-post clash-post--result">
      <header className="clash-post__meta">
        <span className="clash-post__bot" aria-hidden="true">
          FX
        </span>
        <span className="clash-post__from">Arena</span>
        <span className="clash-post__when">{etDateTime(post.created_at)}</span>
        {post.pinned && <span className="clash-post__pin">pinned</span>}
      </header>

      <div className="clash-banner">
        <h2 className="clash-banner__headline">{post.headline}</h2>
        <p className="clash-banner__body">{post.body}</p>
      </div>
    </article>
  );
}

function MatchupPost({ post }: { post: ClashPost }) {
  return (
    <article className="clash-post">
      <header className="clash-post__meta">
        <span className="clash-post__bot" aria-hidden="true">
          FX
        </span>
        <span className="clash-post__from">Arena</span>
        <span className="clash-post__when">{etDateTime(post.created_at)}</span>
        {post.pinned && <span className="clash-post__pin">pinned</span>}
      </header>

      <h3 className="clash-post__headline">{post.headline}</h3>
      <p className="clash-post__body">{post.body}</p>
    </article>
  );
}

export function ClashPostsFeed({ posts }: { posts: ClashPost[] }) {
  if (posts.length === 0) {
    // Self-hiding rather than a skeleton or a "no posts yet" shrug — same
    // discipline as the feed's bands and the Arena strip. A fan who joined
    // mid-week has nothing pinned yet, and an empty box is worse than no box.
    return null;
  }

  return (
    <section className="clash-posts" aria-label="Bureau board">
      {posts.map((p) =>
        p.kind === 'result' ? (
          <ResultPost key={p.id} post={p} />
        ) : (
          <MatchupPost key={p.id} post={p} />
        ),
      )}
    </section>
  );
}
