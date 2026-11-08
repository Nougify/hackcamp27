import Link from 'next/link';
import type { RecipeCandidate } from '@/contracts/domain';
import { Badge, Card } from '@/components/ui';
import { daysLabel } from './MatchMarker';

/** Every ingredient is on hand or a staple. */
export function canMake(candidate: RecipeCandidate): boolean {
  return candidate.matches.every((m) => m.status === 'have' || m.status === 'staple');
}

export function RecipeCard({ candidate }: { candidate: RecipeCandidate }) {
  const have = candidate.matches.filter((m) => m.status === 'have' || m.status === 'staple').length;
  const total = candidate.matches.length;
  const kcal = candidate.nutrition.perServing.energyKcal;
  const protein = candidate.nutrition.perServing.proteinG;

  const ready = canMake(candidate);

  return (
    <Card className={ready ? 'ring-2 ring-accent' : ''}>
      {ready && (
        <Badge tone="accent" className="mb-2">
          ✓ You have everything
        </Badge>
      )}
      <div className="text-xs text-muted">
        From <strong className="text-ink">{candidate.source.siteName}</strong>
        {candidate.source.author ? ` by ${candidate.source.author}` : ''}
      </div>
      <Link href={`/recipes/${candidate.recipeId}`} className="mt-1 block text-lg font-bold underline-offset-2 hover:underline">
        {candidate.title}
      </Link>
      <div className="mt-1 text-sm text-muted">
        {candidate.totalMin != null ? `${candidate.totalMin} min · ` : ''}
        {candidate.servings} servings · {have} of {total} ingredients on hand
      </div>
      {candidate.usesExpiring.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {candidate.usesExpiring.map((u) => (
            <li key={u.pantryItemId} className="rounded-full bg-surface-2 px-3 py-1 text-xs">
              uses {u.name} · {daysLabel(u.daysToExpiry)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-sm">
        {kcal != null || protein != null ? (
          <>
            ≈ {kcal ?? '?'} kcal · {protein ?? '?'} g protein per serving{' '}
            <span className="text-muted">
              (based on {candidate.nutrition.basedOn} of {candidate.nutrition.total} ingredients)
            </span>
          </>
        ) : (
          <span className="text-muted">Nutrition estimate unavailable</span>
        )}
      </div>
    </Card>
  );
}
