"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/today", label: "Today" },
  { href: "/pantry", label: "Pantry" },
  { href: "/recipes", label: "Recipes" },
  { href: "/settings", label: "Settings" },
];

/** Top bar on desktop, bottom tab bar on phones. Hidden in cook mode (full-screen). */
export function AppNav() {
  const path = usePathname();
  if (path.startsWith("/cook")) return null;

  return (
    <>
    {/* Spacer so page content clears the fixed bottom bar on phones. */}
    <div aria-hidden className="h-14 md:hidden" />
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface shadow-[0_-1px_12px_-4px_rgba(0,0,0,0.12)] md:static md:order-first md:border-b md:border-t-0 md:shadow-none"
    >
      <div className="mx-auto flex max-w-5xl items-center px-2 md:px-6">
        <Link href="/today" className="mr-8 hidden font-display text-2xl font-semibold tracking-tight md:block">Chefly</Link>
        {links.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-1 items-center justify-center border-t-2 text-sm font-semibold transition-colors md:min-h-16 md:flex-none md:border-t-0 md:border-b-2 md:px-5 ${
                active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        {/* Plain <a>: /auth/* are Auth0 SDK routes, not client-side pages. */}
        <a
          href="/auth/logout"
          className="ml-1 flex min-h-14 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink md:ml-auto md:min-h-0 md:py-2"
        >
          Sign out
        </a>
      </div>
    </nav>
    </>
  );
}
