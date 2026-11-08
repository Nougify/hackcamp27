import { SearchStream } from '@/features/recipes/SearchStream';

export default function RecipesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-4 font-display text-3xl font-semibold">Find recipes</h1>
      <SearchStream />
    </main>
  );
}
