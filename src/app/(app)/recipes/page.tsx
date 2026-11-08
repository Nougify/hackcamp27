import { SearchStream } from '@/features/recipes/SearchStream';

export default function RecipesPage() {
  return (
    <main className="pt-6">
      <h1 className="text-2xl font-bold">Find recipes</h1>
      <p className="mb-4 mt-1 text-sm text-text-muted">
        Real recipes from the web, ranked toward whatever expires soonest.
      </p>
      <SearchStream />
    </main>
  );
}
