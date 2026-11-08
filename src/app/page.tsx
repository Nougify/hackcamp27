import Link from "next/link";
import { buttonClass } from "@/components/ui";

const steps = [
  ["Scan", "Barcode in, pantry updated. Expiry read from a photo, confirmed by you."],
  ["Cook what expires", "Real recipes from real sites, ranked by what goes off first."],
  ["Hands-free", "Wave to turn the page. Steps read aloud. Timers that survive a reload."],
];

export default function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="font-display text-2xl font-semibold">Mise</span>
        {/* Plain <a>: /auth/* are Auth0 SDK routes, not client-side pages. */}
        <a href="/auth/login" className={buttonClass("secondary")}>Sign in</a>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-3xl font-display text-5xl font-semibold leading-tight sm:text-6xl">
          Cook what you have, before it goes off.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Mise tracks your pantry and expiry dates, finds real recipes that use what&apos;s about to expire, and walks you
          through them hands-free while your hands are covered in flour.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <a href="/auth/login" className={buttonClass("primary", "lg")}>Get started</a>
          <Link href="/today" className={buttonClass("ghost", "lg")}>Open the app</Link>
        </div>
      </section>

      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map(([title, body], i) => (
          <li key={title} className="rounded-2xl border border-line bg-surface p-5">
            <span className="text-sm font-semibold text-accent">0{i + 1}</span>
            <h2 className="mt-2 font-display text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <footer className="mt-12 text-xs text-muted">Product data © Open Food Facts contributors, ODbL.</footer>
    </main>
  );
}
