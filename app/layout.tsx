import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from './auth-context';
import { FollowsProvider } from './follows-context';
import { PointsProvider } from './points-context';

export const metadata: Metadata = {
  title: 'Sharp Foxx — Admin',
  description: 'Dev admin frontend for the Sharp Foxx API',
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
