import type { AdaptedRecipe } from '@/contracts/domain';
import { Badge, Card } from '@/components/ui';

export function AdaptedCard({ adaptation, siteName }: { adaptation: AdaptedRecipe; siteName: string }) {
  return (
    <Card className="border-dashed bg-surface-2">
      <div className="flex items-center gap-2">
        <Badge tone="ai">AI-adapted</Badge>
        <span className="text-xs text-muted">Based on the original from {siteName}</span>
      </div>
      <h2 className="mt-3 text-sm font-semibold">Substitutions</h2>
      <ul className="mt-1 flex flex-col gap-2 text-sm">
        {adaptation.substitutions.map((s, i) => (
          <li key={i}>
            <span className="text-muted">Missing: {s.missingIngredient}</span>
            <br />
            {s.substitute ? (
              <>
                → Using: <strong>{s.substitute}</strong>
                {s.quantity ? ` (${s.quantity})` : ''} <span className="text-muted">(from your pantry)</span>
              </>
            ) : (
              <>→ Omit</>
            )}
            <br />
            <span className="text-xs text-muted">{s.reason}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-4 text-sm font-semibold">Ingredients</h2>
      <ul className="mt-1 flex flex-col gap-1">
        {adaptation.ingredients.map((ing, i) => (
          <li key={i} className="flex items-start gap-2">
            <span>{ing.text}</span>
            {ing.changed && <Badge tone="ai">changed</Badge>}
          </li>
        ))}
      </ul>
      <h2 className="mt-4 text-sm font-semibold">Steps</h2>
      <ol className="mt-1 flex list-decimal flex-col gap-2 pl-5">
        {adaptation.steps.map((step) => (
          <li key={step.index}>
            {step.text} {step.changed && <Badge tone="ai">AI-adapted</Badge>}
          </li>
        ))}
      </ol>
      {adaptation.warnings.length > 0 && (
        <>
          <h2 className="mt-4 text-sm font-semibold">Warnings</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-warn">
            {adaptation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
