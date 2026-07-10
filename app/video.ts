// Shared YouTube → embed conversion. The one place that turns a stored videoUrl
// into an iframe-able /embed/ URL, so every surface (game page, and any future
// card/modal) treats the same link shapes identically.
//
// Handles all the common YouTube shapes we see in real correspondent data:
//   youtube.com/watch?v=ID   youtu.be/ID          youtube.com/live/ID
//   youtube.com/embed/ID     youtube.com/shorts/ID
// with or without www/m subdomains, and ignoring extra query params
// (?feature=, ?si=, &t=). All normalize to https://www.youtube.com/embed/ID.
//
// Returns null for anything that isn't a recognizable YouTube URL, so callers
// can fall back to a plain external link instead of embedding a broken frame.
export function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, '');

    // youtu.be/ID — the short-share host puts the id in the path.
    if (host === 'youtu.be') {
      return embedFrom(u.pathname.slice(1));
    }

    if (host === 'youtube.com') {
      // watch?v=ID — the id rides in the query string.
      if (u.pathname === '/watch') {
        return embedFrom(u.searchParams.get('v'));
      }
      // /live/ID, /embed/ID, /shorts/ID — the id is the first path segment
      // after the shape prefix; trailing params (?feature=, ?si=) are dropped.
      const m = u.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/);
      if (m) return embedFrom(m[1]);
    }

    return null;
  } catch {
    return null;
  }
}

function embedFrom(id: string | null | undefined): string | null {
  return id ? `https://www.youtube.com/embed/${id}` : null;
}
