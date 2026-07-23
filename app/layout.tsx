import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from './auth-context';
import { FollowsProvider } from './follows-context';
import { PointsProvider } from './points-context';

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
        <AuthProvider>
          <FollowsProvider>
            <PointsProvider>{children}</PointsProvider>
          </FollowsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
