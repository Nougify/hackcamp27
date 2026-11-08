import { SearchStream } from '@/features/recipes/SearchStream';

export default function RecipesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl font-semibold">Find recipes</h1>
      <p className="mb-4 mt-2 text-muted">Real recipes from the web, ranked toward whatever expires soonest.</p>
      <SearchStream />
    </main>
  );
}
