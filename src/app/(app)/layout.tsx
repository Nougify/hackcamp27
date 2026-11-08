import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth0 } from '@/lib/auth0';
import { ToastHost } from '@/components/ui/overlays';

const NAV = [
  { href: '/today', label: 'Today' },
  { href: '/pantry', label: 'Pantry' },
  { href: '/recipes', label: 'Recipes' },
  { href: '/settings', label: 'Settings' },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth0.getSession();
  if (!session) redirect('/auth/login');

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-24">
      <ToastHost>{children}</ToastHost>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 border-t bg-surface">
        <ul className="mx-auto flex max-w-3xl items-stretch justify-around">
          {NAV.map((item) => (
            <li key={item.href} className="flex-1">
              <Link href={item.href} className="flex min-h-16 items-center justify-center text-sm font-semibold">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <footer className="mt-8 text-center text-xs text-text-muted">
        Product data © Open Food Facts contributors, ODbL. Always check product labels for allergens.
      </footer>
    </div>
  );
}
