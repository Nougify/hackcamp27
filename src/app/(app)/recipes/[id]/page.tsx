import { RecipeDetail } from '@/features/recipes/RecipeDetail';

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <RecipeDetail recipeId={id} />
    </main>
  );
}
