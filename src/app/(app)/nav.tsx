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
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:static md:border-b md:border-t-0"
    >
      <div className="mx-auto flex max-w-5xl items-center px-2 md:px-6">
        <Link href="/today" className="mr-6 hidden font-display text-xl font-semibold md:block">Mise</Link>
        {links.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-1 items-center justify-center text-sm font-semibold md:flex-none md:px-4 ${
                active ? "text-accent" : "text-muted hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
