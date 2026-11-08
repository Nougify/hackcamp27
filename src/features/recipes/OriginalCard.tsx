'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OriginalRecipe, PantryMatch } from '@/contracts/domain';
import { Button, Card } from '@/components/ui/primitives';
import { MatchMarker } from './MatchMarker';

export function OriginalCard({
  recipe,
  matches,
  recipeId,
}: {
  recipe: OriginalRecipe;
  matches: PantryMatch[];
  recipeId: string;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchByIndex = new Map(matches.map((m) => [m.ingredientIndex, m]));

  const startCooking = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/cook/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId, variantId: recipe.variantId, servingsPlanned: recipe.servings }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error?.message ?? 'Could not start cooking.');
      }
      const session = await res.json();
      router.push(`/cook/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start cooking.');
      setStarting(false);
    }
  };

  return (
    <Card>
      <div className="text-sm">
        From <strong>{recipe.source.siteName}</strong>
        {recipe.source.author ? ` by ${recipe.source.author}` : ''}
      </div>
      <a
        href={recipe.source.url}
        target="_blank"
        rel="noopener"
        className="mt-1 inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline"
      >
        View original
      </a>
      <h2 className="mt-3 text-sm font-semibold text-text-muted">Ingredients</h2>
      <ul className="mt-1 flex flex-col gap-2">
        {recipe.ingredients.map((ing, i) => (
          <li key={i} className="flex items-start justify-between gap-3">
            <span>{ing.raw}</span>
            <MatchMarker status={matchByIndex.get(i)?.status ?? 'missing'} />
          </li>
        ))}
      </ul>
      <h2 className="mt-4 text-sm font-semibold text-text-muted">Steps</h2>
      <ol className="mt-1 flex list-decimal flex-col gap-2 pl-5">
        {recipe.steps.map((step) => (
          <li key={step.index}>{step.text}</li>
        ))}
      </ol>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <Button className="mt-4 w-full" onClick={startCooking} disabled={starting}>
        {starting ? 'Starting…' : 'Cook this recipe'}
      </Button>
    </Card>
  );
}
