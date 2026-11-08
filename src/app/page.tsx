import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { auth0, authDisabled } from "@/lib/auth0";

const values = [
  ["Real recipes", "Pulled from real sites across the web, not generated."],
  ["Hands-free", "Wave to turn a page. Steps read aloud, start to finish."],
  ["Nothing wasted", "Every suggestion is ranked by what expires soonest."],
];

const steps = [
  ["Scan", "Barcode in, pantry updated. Point your camera at the expiry date and confirm the read."],
  ["Cook what expires", "Real recipes from real sites, ranked by what goes off first, filtered to your diet and allergies."],
  ["Hands-free", "Wave to turn the page. Steps read aloud. Timers that survive a reload."],
];

const features = [
  ["P", "Pantry tracking", "Every item, every best-before date, sorted soonest first."],
  ["S", "Barcode scanning", "Point your camera at a barcode and we fill in the details."],
  ["R", "Smart recipe matching", "Ranked by your pantry, filtered to your diet and allergens."],
  ["C", "Hands-free cook mode", "Gesture or voice through every step, with timers built in."],
  ["N", "Nutrition tracking", "Log what you eat and see it against your daily goals."],
  ["L", "Private by default", "Camera frames and label photos are never stored."],
];

export default async function Landing() {
  const signedIn = authDisabled || (await auth0.getSession()) !== null;

  const primaryCta = signedIn ? (
    <Link href="/today" className={buttonClass("primary", "lg")}>Open the app</Link>
  ) : (
    // Plain <a>: /auth/* are Auth0 SDK routes, not client-side pages.
    <a href="/auth/login?returnTo=/today" className={buttonClass("primary", "lg")}>Get started free</a>
  );

  return (
    <main className="relative flex w-full flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-accent-soft opacity-60 blur-3xl"
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-10">
        <header className="flex items-center justify-between border-b border-line pb-6">
          <span className="font-display text-2xl font-semibold tracking-tight">Chefly</span>
          {signedIn ? (
            <Link href="/today" className={buttonClass("secondary")}>Open the app</Link>
          ) : (
            <a href="/auth/login?returnTo=/today" className={buttonClass("secondary")}>Sign in</a>
          )}
        </header>

        <section className="flex flex-col justify-center py-16">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-wide text-accent uppercase">
            Hands-free cooking, zero waste
          </span>
          <h1 className="mt-5 max-w-3xl font-display text-5xl font-semibold leading-tight sm:text-6xl">
            Chefly turns your pantry into dinner, before anything goes off.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Scan what you have, get real recipes ranked by what&apos;s about to expire, and cook through them hands-free
            while your hands are covered in flour.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">{primaryCta}</div>
        </section>

        <dl className="grid gap-4 border-t border-line py-10 sm:grid-cols-3">
          {values.map(([title, body]) => (
            <div key={title}>
              <dt className="font-display text-lg font-semibold text-accent">{title}</dt>
              <dd className="mt-1 text-sm text-muted">{body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="relative z-10 border-y border-line bg-surface-2/60 py-16">
        <div className="mx-auto w-full max-w-5xl px-6">
          <h2 className="font-display text-3xl font-semibold">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {steps.map(([title, body], i) => (
              <li
                key={title}
                className="rounded-2xl border border-line bg-surface p-6 transition-shadow hover:shadow-lg hover:shadow-ink/5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  0{i + 1}
                </span>
                <h3 className="mt-4 font-display text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="font-display text-3xl font-semibold">Everything in one app</h2>
        <p className="mt-2 max-w-xl text-muted">No juggling a pantry app, a recipe site, and a nutrition tracker.</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([mark, title, body]) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-semibold text-accent">
                {mark}
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line bg-surface-2 p-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold">Stop guessing what&apos;s for dinner.</h2>
            <p className="mt-2 text-muted">Scan your pantry and see what you can cook tonight.</p>
          </div>
          {primaryCta}
        </div>
      </div>

      <footer className="relative z-10 mx-auto w-full max-w-5xl border-t border-line px-6 py-6 text-xs text-muted">
        Product data © Open Food Facts contributors, ODbL.
      </footer>
    </main>
  );
}
