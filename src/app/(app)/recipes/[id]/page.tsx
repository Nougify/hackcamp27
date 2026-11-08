import { RecipeDetail } from '@/features/recipes/RecipeDetail';

export default async function RecipePage({ params }: PageProps<'/recipes/[id]'>) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <RecipeDetail recipeId={id} />
    </main>
  );
}
