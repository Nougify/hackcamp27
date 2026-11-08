'use client';

import { useEffect, useState } from 'react';
import type { AdaptResponse, RecipeDetailResponse } from '@/contracts/api';
import { Badge, Button, Card } from '@/components/ui';
import { AdaptedCard } from './AdaptedCard';
import { OriginalCard } from './OriginalCard';

export function RecipeDetail({ recipeId }: { recipeId: string }) {
  const [detail, setDetail] = useState<RecipeDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recipes/${recipeId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setError('Recipe not found.');
          return;
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status}).`);
        setDetail(await res.json());
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load.');
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const adapt = async () => {
    setAdapting(true);
    setAdaptError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/adapt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.status === 409) {
        setAdaptError('Nothing to adapt — you have every ingredient.');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Couldn't find a safe substitution.");
      }
      const body = (await res.json()) as AdaptResponse;
      setDetail((d) => (d ? { ...d, adaptations: [body.adaptation, ...d.adaptations] } : d));
    } catch (err) {
      setAdaptError(err instanceof Error ? err.message : "Couldn't find a safe substitution.");
    } finally {
      setAdapting(false);
    }
  };

  if (error) return <p>{error}</p>;
  if (!detail) return <p className="text-muted">Loading recipe…</p>;

  const { original, matches, adaptations } = detail;
  const missing = matches.filter((m) => m.status === 'missing' || m.status === 'insufficient');
  const est = detail.nutrition.estimate;
  const pub = detail.nutrition.publisher;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold">{original.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {original.servings} servings
          {original.times.totalMin != null ? ` · ${original.times.totalMin} min` : ''}
        </p>
      </div>

      <Card>
        <div className="text-sm">
          ≈ {est.perServing.energyKcal ?? '?'} kcal · {est.perServing.proteinG ?? '?'} g protein per serving{' '}
          <span className="text-muted">
            (based on {est.basedOn} of {est.total} ingredients)
          </span>
        </div>
        {pub?.energyKcal != null && (
          <div className="mt-1 text-sm text-muted">Publisher&apos;s nutrition: {pub.energyKcal} kcal per serving</div>
        )}
        {est.estimatedFields.length > 0 && (
          <details className="mt-1 text-xs text-muted">
            <summary>Estimates used</summary>
            <ul className="list-disc pl-5">
              {est.estimatedFields.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <OriginalCard recipe={original} matches={matches} recipeId={recipeId} />

      {missing.length > 0 && adaptations.length === 0 && (
        <div>
          <Button variant="secondary" onClick={adapt} disabled={adapting}>
            {adapting ? 'Adapting…' : `Adapt for missing ingredients (${missing.length})`}
          </Button>
          {adaptError && <p className="mt-2 text-sm text-danger">{adaptError}</p>}
        </div>
      )}
      {adaptations.length > 0 && <Badge tone="ai">Showing {adaptations.length} AI adaptation(s) below</Badge>}
      {adaptations.map((a) => (
        <AdaptedCard key={a.variantId} adaptation={a} siteName={original.source.siteName} />
      ))}
    </div>
  );
}
