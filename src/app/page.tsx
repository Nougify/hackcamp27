import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { auth0, authDisabled } from "@/lib/auth0";

const steps = [
  ["Scan", "Barcode in, pantry updated. Expiry read from a photo, confirmed by you."],
  ["Cook what expires", "Real recipes from real sites, ranked by what goes off first."],
  ["Hands-free", "Wave to turn the page. Steps read aloud. Timers that survive a reload."],
];

export default async function Landing() {
  const signedIn = authDisabled || (await auth0.getSession()) !== null;

  return (
    <main className="relative flex w-full flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-accent-soft opacity-60 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
        <header className="flex items-center justify-between border-b border-line pb-6">
          <span className="font-display text-2xl font-semibold tracking-tight">Mise</span>
          {signedIn ? (
            <Link href="/today" className={buttonClass("secondary")}>Open the app</Link>
          ) : (
            // Plain <a>: /auth/* are Auth0 SDK routes, not client-side pages.
            <a href="/auth/login?returnTo=/today" className={buttonClass("secondary")}>Sign in</a>
          )}
        </header>

        <section className="flex flex-1 flex-col justify-center py-16">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-wide text-accent uppercase">
            Hands-free cooking
          </span>
          <h1 className="mt-5 max-w-3xl font-display text-5xl font-semibold leading-tight sm:text-6xl">
            Cook what you have, before it goes off.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Mise tracks your pantry and expiry dates, finds real recipes that use what&apos;s about to expire, and walks you
            through them hands-free while your hands are covered in flour.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            {signedIn ? (
              <Link href="/today" className={buttonClass("primary", "lg")}>Open the app</Link>
            ) : (
              <a href="/auth/login?returnTo=/today" className={buttonClass("primary", "lg")}>Get started</a>
            )}
          </div>
        </section>

        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(([title, body], i) => (
            <li
              key={title}
              className="rounded-2xl border border-line bg-surface p-6 transition-shadow hover:shadow-lg hover:shadow-ink/5"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                0{i + 1}
              </span>
              <h2 className="mt-4 font-display text-xl font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ol>

        <footer className="mt-12 border-t border-line pt-6 text-xs text-muted">
          Product data © Open Food Facts contributors, ODbL.
        </footer>
      </div>
    </main>
  );
}
