import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from './auth-context';
import { FollowsProvider } from './follows-context';

export const metadata: Metadata = {
  title: 'Sharp Foxx — Admin',
  description: 'Dev admin frontend for the Sharp Foxx API',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <FollowsProvider>{children}</FollowsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
