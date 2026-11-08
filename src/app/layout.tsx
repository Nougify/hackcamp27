import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mise',
  description: 'Hands-free pantry-to-plate cooking',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
