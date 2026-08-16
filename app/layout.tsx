import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from './auth-context';
import { AgeGateProvider } from './age-gate';
import { FollowsProvider } from './follows-context';
import { PointsProvider } from './points-context';
import { EarnProvider } from './earn-context';
import { NotificationsProvider } from './notifications-context';
import { SiteHeader } from './site-header';

export const metadata: Metadata = {
  title: 'Sharp Foxx — Admin',
  description: 'Dev admin frontend for the Sharp Foxx API',
};

// Without this, mobile Safari/Chrome assume a ~980px desktop viewport and paint
// the whole layout scaled down to a miniature — the bug this pass fixes first.
// device-width lets the CSS media queries below actually fire on phones.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* PROVIDER ORDER IS LOAD-BEARING. Points must wrap Earn (an earn pushes
            its new balance at the ⚡ chip), and Earn must wrap Follows (a
            successful follow is itself an earn — see follows-context.tsx).
            Auth wraps all three; nothing below it works without a token.
            AgeGate sits directly inside Auth because it reads the session and
            SWAPS THE TOKEN on a successful attestation (setSession) — so it must
            be under the provider that owns it, and above every surface that can
            take a gated action.

            Notifications sits INNERMOST on purpose: it reads useAuth and nothing
            else, and nothing else reads it, so it is the one provider here that
            can be added without disturbing the load-bearing chain above it. It
            renders the notification tray itself (the EarnProvider/EarnToasts
            shape) because two bells are mounted at once — the desktop row and
            the mobile cluster — and one panel must be rendered once. */}
        <AuthProvider>
          <AgeGateProvider>
            <PointsProvider>
              <EarnProvider>
                <FollowsProvider>
                  <NotificationsProvider>
                    {/* THE CHROME, ABOVE THE PAGE AND OUTSIDE ITS <main>.
                        It sits here, innermost, because it reads the session
                        (AuthProvider) and mounts the bell (NotificationsProvider)
                        — and because that is the whole point of the change: the
                        nav's width is now a function of the VIEWPORT rather than
                        of whatever max-width each page chose for its content.
                        See site-header.tsx and RESOLVER_TICKETS.md W1.

                        NOT rendered during session restore: AuthProvider swaps
                        its entire subtree for <SessionRestoring/> while
                        `restoring`, which carries its own minimal wordmark bar. */}
                    <SiteHeader />
                    {children}
                  </NotificationsProvider>
                </FollowsProvider>
              </EarnProvider>
            </PointsProvider>
          </AgeGateProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
