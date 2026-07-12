'use client';

// Shared social-links icon row — rendered under the affiliation line on the
// athlete profile hero and the team hero. Values come from the backend already
// normalized to full profile URLs (see api.ts SocialLinks). Only platforms that
// are present render; the whole row is hidden when there are none. Each glyph is
// an external link (target=_blank, rel=noopener). No icon libraries — the marks
// are inline SVG so they inherit currentColor and theme cleanly.

import { SOCIAL_PLATFORMS, SocialLinks, SocialPlatform } from './api';

// Accessible name per platform (also used to label the edit inputs).
export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
};

// Minimal, recognizable inline glyphs. Kept simple on purpose (single viewBox,
// currentColor) so they read at ~18px and adapt to light/dark automatically.
const GLYPHS: Record<SocialPlatform, JSX.Element> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.3" cy="6.7" r="1.3" fill="currentColor" />
    </>
  ),
  tiktok: (
    <path
      d="M13 3.5v9.8a2.7 2.7 0 1 1-2.3-2.67v2.16a.7.7 0 1 0 .5.67V3.5H13a3.4 3.4 0 0 0 3 3.35v2.02A5.3 5.3 0 0 1 13 7.8z"
      fill="currentColor"
    />
  ),
  x: (
    <path
      d="M4 4l7.2 8.6L4.4 20h1.9l5.4-5.9L16.5 20H20l-7.5-9 6.4-7h-1.9l-5 5.5L7.5 4z"
      fill="currentColor"
    />
  ),
  facebook: (
    <path
      d="M14.2 8.3h1.9V5.6c-.33-.05-1.15-.15-2.1-.15-2.08 0-3.5 1.27-3.5 3.6v2.05H8v3h2.5V21h3.03v-6.85h2.4l.38-3h-2.78V9.4c0-.87.24-1.1 1.07-1.1z"
      fill="currentColor"
    />
  ),
  youtube: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="3.5" fill="currentColor" />
      <path d="M10.3 9.2l5 2.8-5 2.8z" fill="var(--panel, #fff)" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" />
      <path
        d="M7.2 9.2v8M7.2 6.4v.02M11 17.2v-4.4a1.9 1.9 0 0 1 3.8 0v4.4M11 12.8v4.4"
        fill="none"
        stroke="var(--panel, #fff)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </>
  ),
};

export function SocialLinksRow({
  links,
  className,
}: {
  links: SocialLinks | null | undefined;
  className?: string;
}) {
  // Present platforms only, in the canonical order.
  const present = SOCIAL_PLATFORMS.filter((p) => links?.[p]);
  if (present.length === 0) return null;

  return (
    <div className={`social-row${className ? ` ${className}` : ''}`}>
      {present.map((p) => (
        <a
          key={p}
          href={links![p]}
          target="_blank"
          rel="noopener noreferrer"
          className="social-link"
          aria-label={SOCIAL_LABELS[p]}
          title={SOCIAL_LABELS[p]}
        >
          <svg viewBox="0 0 24 24" className="social-glyph" aria-hidden="true">
            {GLYPHS[p]}
          </svg>
        </a>
      ))}
    </div>
  );
}
