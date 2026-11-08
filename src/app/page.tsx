import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold text-(--color-text)">Mise</h1>
      <p className="max-w-md text-(--color-text-muted)">
        Hands-free, pantry-to-plate cooking. Scan what you have, find real recipes that use it
        before it expires, and cook with your voice and your hands free.
      </p>
      <Link
        href="/today"
        className="rounded-full bg-(--color-accent) px-6 py-3 font-medium text-(--color-accent-contrast)"
      >
        Get started
      </Link>
    </main>
  );
}
