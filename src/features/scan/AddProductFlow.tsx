'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LabelExtractionResponse } from '@/contracts/api';
import type { Product, ProductSource } from '@/contracts/domain';
import { Badge, Button, Card, useToast } from '@/components/ui';
import { pantryApi } from '@/features/pantry/api';
import { ProductForm, type ProductFormValues } from '@/features/pantry/ProductForm';
import { scanApi } from './api';
import type { ScannedCode } from './BarcodeScanner';
import { ExpiryCapture } from './ExpiryCapture';
import { PhotoCapture } from './PhotoCapture';
import { draftToFormInitial, productToFormInitial } from './pure';

// SPEC UF2/UF3: scan → found card, or not found → label photo → confirm. The manual form is
// reachable from every step.

const BarcodeScanner = dynamic(() => import('./BarcodeScanner').then((m) => m.BarcodeScanner), { ssr: false });

type Step =
  | { kind: 'scan'; notice?: string }
  | { kind: 'looking' }
  | { kind: 'found'; product: Product }
  | { kind: 'not_found'; gtin: string }
  | { kind: 'label'; gtin: string | null; message?: string }
  | { kind: 'draft'; response: LabelExtractionResponse }
  | { kind: 'manual'; gtin: string | null };

const SAME_CODE_WINDOW_MS = 1000;

function FoundCard({ product }: { product: Product }) {
  const kcal = product.per100.energyKcal;
  const per = product.basis === '100ml' ? '100 ml' : '100 g';
  const size = product.packageQuantity?.text ?? (product.packageQuantity ? `${product.packageQuantity.value} ${product.packageQuantity.unit}` : null);
  return (
    <Card className="flex gap-4">
      {product.imageUrl?.startsWith('https://') && (
        // eslint-disable-next-line @next/next/no-img-element -- third-party product photo, any host
        <img src={product.imageUrl} alt="" className="h-24 w-24 shrink-0 rounded-xl object-contain" />
      )}
      <div className="min-w-0">
        <h2 className="font-display text-xl font-semibold">{product.name}</h2>
        {product.brand && <p className="text-sm text-muted">{product.brand}</p>}
        <p className="mt-1 text-sm">
          {kcal != null ? `${Math.round(kcal)} kcal per ${per}` : 'No calorie data'}
          {size ? ` · ${size}` : ''}
        </p>
        <p className="mt-1 text-xs text-muted">Product data: Open Food Facts (ODbL)</p>
      </div>
    </Card>
  );
}

export function AddProductFlow() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [readingLabel, setReadingLabel] = useState(false);
  const lastCode = useRef<{ gtin: string; at: number } | null>(null);

  async function lookup(code: ScannedCode) {
    const now = Date.now();
    if (lastCode.current?.gtin === code.gtin && now - lastCode.current.at < SAME_CODE_WINDOW_MS) return;
    lastCode.current = { gtin: code.gtin, at: now };
    setStep({ kind: 'looking' });
    try {
      // lookupCode, not gtin: it keeps an EAN-8 as 8 digits for the providers.
      const r = await scanApi.lookup(code.lookupCode);
      if (r.status === 'found') setStep({ kind: 'found', product: r.product });
      else if (r.status === 'not_found') setStep({ kind: 'not_found', gtin: r.gtin });
      else setStep({ kind: 'scan', notice: "That barcode doesn't look valid" });
    } catch (e) {
      setStep({ kind: 'scan', notice: e instanceof Error ? e.message : 'Could not look up that barcode.' });
    }
  }

  async function readLabel(photos: Blob[], gtin: string | null) {
    setReadingLabel(true);
    try {
      const response = await scanApi.readLabel(photos, gtin);
      if (response.isFoodProduct) setStep({ kind: 'draft', response });
      else setStep({ kind: 'label', gtin, message: "That doesn't look like a food product. Try another photo, or enter it by hand." });
    } catch (e) {
      setStep({ kind: 'label', gtin, message: e instanceof Error ? e.message : "We couldn't read that photo." });
    } finally {
      setReadingLabel(false);
    }
  }

  async function save(values: ProductFormValues, gtin: string | null, source: ProductSource, userVerified: boolean) {
    await pantryApi.create({ ...values, gtin, source, userVerified });
    toast(`${values.name} added`);
    router.push('/pantry');
    router.refresh();
  }

  const rescan = () => setStep({ kind: 'scan' });
  const expirySlot = (apply: Parameters<typeof ExpiryCapture>[0]['onConfirm']) => <ExpiryCapture onConfirm={apply} />;

  return (
    <div className="grid gap-6">
      {step.kind === 'scan' && <BarcodeScanner onCode={(c) => void lookup(c)} notice={step.notice} />}

      {step.kind === 'looking' && (
        <p role="status" className="text-sm text-muted">
          Looking up that barcode…
        </p>
      )}

      {step.kind === 'found' && (
        <>
          <FoundCard product={step.product} />
          <ProductForm
            key={step.product.gtin}
            initial={productToFormInitial(step.product)}
            expirySlot={expirySlot}
            submitLabel="Add to pantry"
            onCancel={rescan}
            onSubmit={(v) => save(v, step.product.gtin, step.product.source, false)}
          />
        </>
      )}

      {step.kind === 'not_found' && (
        <Card>
          <h2 className="font-display text-xl font-semibold">We couldn&apos;t find this product.</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => setStep({ kind: 'label', gtin: step.gtin })}>Take photo of label</Button>
            <Button variant="secondary" onClick={() => setStep({ kind: 'manual', gtin: step.gtin })}>
              Enter manually
            </Button>
            <Button variant="ghost" onClick={rescan}>
              Scan another
            </Button>
          </div>
        </Card>
      )}

      {step.kind === 'label' && (
        <Card>
          <h2 className="font-display text-xl font-semibold">Photos of the product</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Add the front and the nutrition table, up to 3 photos.</p>
          <PhotoCapture
            max={3}
            busy={readingLabel}
            addLabel="Take photo"
            submitLabel="Read label"
            onSubmit={(p) => void readLabel(p, step.gtin)}
          />
          {step.message && (
            <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {step.message}
            </p>
          )}
        </Card>
      )}

      {step.kind === 'draft' &&
        (() => {
          const { initial, nutritionDropped } = draftToFormInitial(step.response.draft);
          return (
            <>
              {nutritionDropped && (
                <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm">
                  The label&apos;s serving weight couldn&apos;t be read, so its nutrition values were left out.
                </p>
              )}
              <ProductForm
                initial={initial}
                flaggedFields={step.response.flaggedFields}
                badge={<Badge tone="ai">Read by AI, please confirm</Badge>}
                expirySlot={expirySlot}
                submitLabel="Confirm"
                onCancel={rescan}
                onSubmit={(v) => save(v, step.response.draft.gtin, 'gemini_photo', true)}
              />
            </>
          );
        })()}

      {step.kind === 'manual' && (
        <ProductForm expirySlot={expirySlot} submitLabel="Add to pantry" onCancel={rescan} onSubmit={(v) => save(v, step.gtin, 'manual', true)} />
      )}

      {step.kind !== 'manual' && step.kind !== 'draft' && step.kind !== 'not_found' && (
        <div>
          <Button variant="ghost" onClick={() => setStep({ kind: 'manual', gtin: step.kind === 'found' ? step.product.gtin : null })}>
            Enter manually
          </Button>
        </div>
      )}
    </div>
  );
}
