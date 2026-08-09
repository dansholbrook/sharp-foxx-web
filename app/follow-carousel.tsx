'use client';

// ============================================================================
// THE FOLLOW DISC AND THE CAROUSEL TILE — the avatar/monogram and the named tile
// a followed target renders as. Lifted out of the feed when /profile needed the
// same carousel: both surfaces read the SAME shared follows membership
// (follows-context), so a fan's follows must look identical in both, and the
// "correspondents have no page yet" rule must live in exactly one place.
//
// followHref RETURNING NULL IS LOAD-BEARING, not a gap to fill in later. An
// athlete links to /athletes/:id and a team to /teams/:id, but a correspondent
// has no fan-facing page at all — so the tile renders as text rather than as a
// link to nowhere. Every caller must handle the null; none may invent a href.
// ============================================================================

import Link from 'next/link';
import { followTargetName, FollowMineEntry, FollowSuggestion } from './api';

// Up to two initials from a "First Last" (or single-word) display name.
export function followInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase() || '—';
}

// Where a followed/suggested target links (correspondents have no page yet).
export function followHref(
  entry: FollowMineEntry | FollowSuggestion,
): string | null {
  if (entry.targetType === 'athlete') return `/athletes/${entry.athleteId}`;
  if (entry.targetType === 'team') return `/teams/${entry.teamId}`;
  return null;
}

// Avatar (athletes with a photo) or a monogram disc (teams, correspondents, or
// avatar-less athletes). Sized by the caller via a modifier class.
export function FollowDisc({
  entry,
  size,
}: {
  entry: FollowMineEntry | FollowSuggestion;
  size: 'lg' | 'sm';
}) {
  const name = followTargetName(entry);
  const avatarUrl = entry.targetType === 'athlete' ? entry.avatarUrl : null;
  return (
    <span
      className={`follow-disc follow-disc--${size} follow-disc--${entry.targetType}`}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} loading="lazy" className="follow-disc__img" />
      ) : (
        <span className="follow-disc__mono" aria-hidden="true">
          {followInitials(name)}
        </span>
      )}
    </span>
  );
}

// One tile in the "Following" carousel — disc + name, linking to the page.
export function CarouselItem({ entry }: { entry: FollowMineEntry }) {
  const name = followTargetName(entry);
  const href = followHref(entry);
  const inner = (
    <>
      <FollowDisc entry={entry} size="lg" />
      <span className="follow-carousel__name">{name}</span>
    </>
  );
  return href ? (
    <Link href={href} className="follow-carousel__item">
      {inner}
    </Link>
  ) : (
    <span className="follow-carousel__item follow-carousel__item--nolink">
      {inner}
    </span>
  );
}
