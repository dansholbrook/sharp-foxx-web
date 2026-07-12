'use client';

// The athlete public profile (/athletes/[id]) — a modern social-profile surface:
// a full-bleed cover, an overlapping avatar, an identity header, a compact stat
// strip, then content sections (reel, articles, recent games). Open to every
// authenticated role incl. viewers/fans (see roles.ts). Reached by links, not
// nav. When the signed-in user IS this athlete, the hero shows an "Edit profile"
// button that opens a slide-over for bio / jersey / avatar / cover.
//
// Everything the page renders comes from the read-only GET /athletes/:id/profile
// aggregate — nothing private (no user_id, email, or money) is exposed there.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { SlideOver } from '../../queue-table';
import {
  getAthleteProfile,
  getMyAthleteId,
  updateAthlete,
  presignAthleteImage,
  uploadToPresignedUrlWithProgress,
  confirmMedia,
  AthleteProfile,
} from '../../api';

// Date-only formatting for reel/article/game metadata (mirrors the game page).
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// Capitalize a lowercase sport enum ('basketball' -> 'Basketball') for display.
function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Up to two initials for the avatar fallback disc.
function initialsOf(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '—';
}

// ---- Image upload policy (mirrors the backend media purpose rules) ----
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const COVER_MAX_BYTES = 10 * 1024 * 1024;

type ConfirmedImage = { mediaId: string; publicUrl: string };

// A single image picker used for both the avatar and the cover in the edit
// slide-over: runs the picked file through presign -> PUT (real progress bar) ->
// confirm, then hands the confirmed { mediaId, publicUrl } up so the form can
// PATCH the athlete and preview it. A bad type/size is rejected before presign.
function ImageUploader({
  token,
  purpose,
  maxBytes,
  shape,
  previewUrl,
  hint,
  disabled,
  onConfirmed,
}: {
  token: string;
  purpose: 'athlete_avatar' | 'athlete_cover';
  maxBytes: number;
  shape: 'disc' | 'cover';
  previewUrl: string | null;
  hint: string;
  disabled: boolean;
  onConfirmed: (img: ConfirmedImage) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runUpload(file: File) {
    setPhase('uploading');
    setProgress(0);
    setError(null);
    try {
      const { uploadUrl, publicUrl, mediaId } = await presignAthleteImage(
        token,
        purpose,
        { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      );
      await uploadToPresignedUrlWithProgress(uploadUrl, file, file.type, setProgress);
      await confirmMedia(token, mediaId);
      setPhase('idle');
      onConfirmed({ mediaId, publicUrl });
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    // Reset the input so re-picking the same file fires onChange again.
    if (inputRef.current) inputRef.current.value = '';
    if (!IMAGE_TYPES.includes(file.type)) {
      setPhase('failed');
      setError('Use a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > maxBytes) {
      setPhase('failed');
      setError(`Too large — max ${Math.round(maxBytes / 1024 / 1024)}MB.`);
      return;
    }
    void runUpload(file);
  }

  return (
    <div className="profile-uploader">
      <div
        className={
          shape === 'disc'
            ? 'profile-uploader__preview profile-uploader__preview--disc'
            : 'profile-uploader__preview profile-uploader__preview--cover'
        }
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="profile-uploader__img" />
        ) : (
          <span className="profile-uploader__empty">No image</span>
        )}
      </div>

      <div className="profile-uploader__controls">
        {phase === 'uploading' ? (
          <div className="nil-progress" aria-live="polite">
            <div className="nil-progress__track">
              <div className="nil-progress__bar" style={{ width: `${progress}%` }} />
            </div>
            <span className="nil-progress__pct">{progress}%</span>
          </div>
        ) : (
          <label className="photos-pick profile-uploader__pick">
            {previewUrl ? 'Replace' : phase === 'failed' ? 'Try another' : 'Upload'}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="photos-file-input"
              disabled={disabled}
              onChange={(e) => onPick(e.target.files)}
            />
          </label>
        )}
        <span className="game-hint profile-uploader__hint">{hint}</span>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

// What a successful save hands back to the page so the hero updates in place
// without a full profile reload. Only touched fields are present.
type ProfileEdits = {
  bio: string;
  jerseyNumber: string;
  avatarUrl?: string;
  coverUrl?: string;
};

// The edit slide-over — the athlete's own edit surface. Bio (1000 max + counter),
// jersey number, and avatar + cover uploaders. Save PATCHes only the changed
// fields (the backend requires at least one); uploaded media is staged locally
// and applied on Save via its mediaId. Owner-or-admin is enforced server-side.
function EditProfile({
  token,
  athleteId,
  identity,
  onSaved,
  onClose,
}: {
  token: string;
  athleteId: string;
  identity: AthleteProfile['identity'];
  onSaved: (edits: ProfileEdits) => void;
  onClose: () => void;
}) {
  const initialBio = identity.bio ?? '';
  const initialJersey = identity.jerseyNumber ?? '';
  const [bio, setBio] = useState(initialBio);
  const [jersey, setJersey] = useState(initialJersey);
  // Newly-uploaded, confirmed media held between confirm and Save.
  const [avatar, setAvatar] = useState<ConfirmedImage | null>(null);
  const [cover, setCover] = useState<ConfirmedImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bioTrimmedLen = bio.length;
  const dirty =
    bio !== initialBio || jersey !== initialJersey || !!avatar || !!cover;

  async function onSave() {
    // Build the patch of only what changed. bio: '' is a legit clear, so compare
    // against the initial rather than truthiness; jersey the same.
    const patch: Parameters<typeof updateAthlete>[2] = {};
    if (bio !== initialBio) patch.bio = bio;
    if (jersey !== initialJersey) patch.jerseyNumber = jersey;
    if (avatar) patch.avatarMediaId = avatar.mediaId;
    if (cover) patch.coverMediaId = cover.mediaId;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateAthlete(token, athleteId, patch);
      onSaved({
        bio,
        jerseyNumber: jersey,
        ...(avatar ? { avatarUrl: avatar.publicUrl } : {}),
        ...(cover ? { coverUrl: cover.publicUrl } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
      setSaving(false);
    }
  }

  return (
    <SlideOver
      onClose={onClose}
      kicker="Your profile"
      title="Edit profile"
      label="Edit athlete profile"
      footer={
        <>
          <button type="button" disabled={saving || !dirty} onClick={onSave}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="profile-edit">
        <div className="field field--wide">
          <label>Cover photo</label>
          <ImageUploader
            token={token}
            purpose="athlete_cover"
            maxBytes={COVER_MAX_BYTES}
            shape="cover"
            previewUrl={cover?.publicUrl ?? identity.coverUrl}
            hint="JPEG, PNG, or WebP · up to 10MB · wide (3:1) looks best"
            disabled={saving}
            onConfirmed={setCover}
          />
        </div>

        <div className="field field--wide">
          <label>Profile photo</label>
          <ImageUploader
            token={token}
            purpose="athlete_avatar"
            maxBytes={AVATAR_MAX_BYTES}
            shape="disc"
            previewUrl={avatar?.publicUrl ?? identity.avatarUrl}
            hint="JPEG, PNG, or WebP · up to 5MB"
            disabled={saving}
            onConfirmed={setAvatar}
          />
        </div>

        <div className="field field--wide">
          <label htmlFor="profile-bio">Bio</label>
          <textarea
            id="profile-bio"
            value={bio}
            rows={5}
            maxLength={1000}
            placeholder="Tell fans who you are — your game, your goals, your story."
            disabled={saving}
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="game-hint profile-edit__counter">
            {bioTrimmedLen}/1000
          </span>
        </div>

        <div className="field">
          <label htmlFor="profile-jersey">Jersey number</label>
          <input
            id="profile-jersey"
            value={jersey}
            maxLength={4}
            inputMode="numeric"
            placeholder="e.g. 23"
            disabled={saving}
            onChange={(e) => setJersey(e.target.value)}
          />
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </SlideOver>
  );
}

// One reel card — renders the proof by its content type: an image inline, an
// mp4/video in a <video controls>, anything else (pdf, etc.) as a document link
// card. Title + released date beneath.
function ReelCard({ item }: { item: AthleteProfile['reel'][number] }) {
  const type = item.proofContentType ?? '';
  const url = item.proofPublicUrl;
  const isImage = type.startsWith('image/');
  const isVideo = type.startsWith('video/');

  return (
    <article className="profile-reel__card">
      <div className="profile-reel__media">
        {url && isImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={item.title}
            loading="lazy"
            className="profile-reel__img"
          />
        )}
        {url && isVideo && (
          <video controls preload="metadata" className="profile-reel__video">
            <source src={url} type={type} />
          </video>
        )}
        {url && !isImage && !isVideo && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-reel__doc"
          >
            <span className="profile-reel__doc-icon" aria-hidden="true">
              ↗
            </span>
            <span className="profile-reel__doc-label">View document</span>
          </a>
        )}
        {!url && (
          <span className="profile-reel__empty">No preview</span>
        )}
      </div>
      <div className="profile-reel__meta">
        <span className="profile-reel__title">{item.title}</span>
        {item.releasedAt && (
          <span className="profile-reel__date">{formatDate(item.releasedAt)}</span>
        )}
      </div>
    </article>
  );
}

export default function AthletePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // The caller's own athlete id (athlete role only), for own-profile detection.
  const [myAthleteId, setMyAthleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // No token (e.g. after a refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setProfile(await getAthleteProfile(t, id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load profile';
      // A 404 is a legitimately-missing athlete, not a page error.
      if (msg.startsWith('404')) setNotFound(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (token && allowed) load(token);
  }, [token, allowed, load]);

  // Resolve the caller's own athlete id once (athletes only). Best-effort: a
  // non-athlete (or a 404 for an admin with no athlete row) simply leaves it
  // null, so the "Edit profile" affordance stays hidden.
  useEffect(() => {
    if (!token) return;
    const roles = user?.roles ?? [];
    if (!roles.includes('athlete')) return;
    let cancelled = false;
    getMyAthleteId(token)
      .then((r) => {
        if (!cancelled) setMyAthleteId(r.athleteId);
      })
      .catch(() => {
        /* not an athlete / no row — leave own-profile detection off */
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const isOwn = myAthleteId !== null && myAthleteId === id;

  const identity = profile?.identity;

  // "#23 · Point guard" — whichever of jersey/position exist.
  const jerseyPosition = useMemo(() => {
    if (!identity) return '';
    const parts: string[] = [];
    if (identity.jerseyNumber) parts.push(`#${identity.jerseyNumber}`);
    if (identity.position) parts.push(identity.position);
    return parts.join(' · ');
  }, [identity]);

  // "Team · Sport · Institution" — plain text; team pages come later.
  const affiliation = useMemo(() => {
    if (!identity) return [] as string[];
    const parts: string[] = [];
    if (identity.team?.name) parts.push(identity.team.name);
    if (identity.team?.sport) parts.push(titleCase(identity.team.sport));
    if (identity.institution?.name) parts.push(identity.institution.name);
    return parts;
  }, [identity]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home profile-page">
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

      {loading && <div className="card muted">Loading profile…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && notFound && (
        <div className="results-empty">
          <p className="results-empty__title">Athlete not found</p>
          <p className="results-empty__hint">
            This profile may have been removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && profile && identity && (
        <>
          {/* ---- HERO ---- */}
          <section className="profile-hero">
            <div
              className={
                identity.coverUrl
                  ? 'profile-cover'
                  : 'profile-cover profile-cover--fallback'
              }
              style={
                identity.coverUrl
                  ? { backgroundImage: `url(${identity.coverUrl})` }
                  : undefined
              }
            >
              {isOwn && (
                <button
                  type="button"
                  className="btn-ghost profile-edit-btn"
                  onClick={() => setEditing(true)}
                >
                  Edit profile
                </button>
              )}
            </div>

            <div className="profile-identity">
              <div className="profile-avatar">
                {identity.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={identity.avatarUrl}
                    alt={`${identity.firstName} ${identity.lastName}`}
                    className="profile-avatar__img"
                  />
                ) : (
                  <span className="profile-avatar__initials" aria-hidden="true">
                    {initialsOf(identity.firstName, identity.lastName)}
                  </span>
                )}
              </div>

              <div className="profile-identity__body">
                <h1 className="profile-name">
                  {identity.firstName} {identity.lastName}
                </h1>
                {(jerseyPosition || identity.classYear) && (
                  <p className="profile-role">
                    {jerseyPosition}
                    {jerseyPosition && identity.classYear ? ' · ' : ''}
                    {identity.classYear}
                  </p>
                )}
                {affiliation.length > 0 && (
                  <p className="profile-affil">
                    {affiliation.map((seg, i) => (
                      <span key={i} className="profile-affil__seg">
                        {seg}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ---- STAT STRIP ---- */}
          <section className="profile-stats">
            <div className="profile-stat">
              <span className="profile-stat__value">
                {profile.stats.deliverablesCompleted}
              </span>
              <span className="profile-stat__label">Deliverables completed</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat__value">
                {profile.stats.articlesCount}
              </span>
              <span className="profile-stat__label">Articles</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat__value">
                {profile.stats.teamGamesCount}
              </span>
              <span className="profile-stat__label">Team games</span>
            </div>
          </section>

          {/* ---- BIO ---- */}
          {identity.bio && (
            <section className="card profile-section">
              <span className="game-kicker">About</span>
              <p className="profile-bio">{identity.bio}</p>
            </section>
          )}

          {/* ---- CONTENT REEL ---- */}
          {profile.reel.length > 0 && (
            <section className="card profile-section">
              <span className="game-kicker">Content</span>
              <h2 className="profile-section__title">Reel</h2>
              <div className="profile-reel">
                {profile.reel.map((item) => (
                  <ReelCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* ---- IN THE NEWS ---- */}
          {profile.articles.length > 0 && (
            <section className="card profile-section">
              <span className="game-kicker">Coverage</span>
              <h2 className="profile-section__title">In the news</h2>
              <div className="game-covlist">
                {profile.articles.map((a) => (
                  <Link
                    key={a.id}
                    href={`/articles/${a.id}`}
                    className="game-covrow"
                  >
                    <span className="game-covrow__title">{a.title}</span>
                    <span className="game-covrow__date">
                      {formatDate(a.publishedAt)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ---- RECENT GAMES ---- */}
          {profile.recentGames.length > 0 && (
            <section className="card profile-section">
              <span className="game-kicker">Schedule</span>
              <h2 className="profile-section__title">Recent games</h2>
              <div className="profile-games">
                {profile.recentGames.map((g) => {
                  const home = g.homeTeamName ?? 'TBD';
                  const away = g.awayTeamName ?? 'TBD';
                  const hasScore = g.homeScore !== null && g.awayScore !== null;
                  return (
                    <Link
                      key={g.id}
                      href={`/games/${g.id}`}
                      className="profile-gamerow"
                    >
                      <span className="profile-gamerow__matchup">
                        {home} <span className="profile-gamerow__vs">vs</span>{' '}
                        {away}
                      </span>
                      <span className="profile-gamerow__meta">
                        {hasScore && (
                          <span className="profile-gamerow__score">
                            {g.homeScore} – {g.awayScore}
                          </span>
                        )}
                        <span className="profile-gamerow__date">
                          {formatDate(g.scheduledAt)}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {editing && profile && identity && (
        <EditProfile
          token={token}
          athleteId={id}
          identity={identity}
          onClose={() => setEditing(false)}
          onSaved={(edits) => {
            // Merge the saved fields into the identity in place; close the panel.
            setProfile((prev) =>
              prev
                ? {
                    ...prev,
                    identity: {
                      ...prev.identity,
                      bio: edits.bio,
                      jerseyNumber: edits.jerseyNumber,
                      avatarUrl: edits.avatarUrl ?? prev.identity.avatarUrl,
                      coverUrl: edits.coverUrl ?? prev.identity.coverUrl,
                    },
                  }
                : prev,
            );
            setEditing(false);
          }}
        />
      )}
    </main>
  );
}
