import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from './auth-context';
import { FollowsProvider } from './follows-context';
import { PointsProvider } from './points-context';
import { EarnProvider } from './earn-context';

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
            Auth wraps all three; nothing below it works without a token. */}
        <AuthProvider>
          <PointsProvider>
            <EarnProvider>
              <FollowsProvider>{children}</FollowsProvider>
            </EarnProvider>
          </PointsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
