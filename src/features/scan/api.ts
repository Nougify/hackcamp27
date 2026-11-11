import type { ExpiryExtractionResponse, LabelExtractionResponse, ProductLookupResponse, ReceiptExtractionResponse } from '@/contracts/api';
import { api } from '@/features/pantry/api';

export const scanApi = {
  lookup: (barcode: string) => api<ProductLookupResponse>('/api/products/lookup', { method: 'POST', json: { barcode } }),

  readLabel: (photos: Blob[], gtin: string | null) => {
    const form = new FormData();
    photos.forEach((p, i) => form.append('images', p, `label-${i}.jpg`));
    if (gtin) form.append('gtin', gtin);
    return api<LabelExtractionResponse>('/api/vision/label', { method: 'POST', body: form });
  },

  readExpiry: (photo: Blob) => {
    const form = new FormData();
    form.append('image', photo, 'date.jpg');
    return api<ExpiryExtractionResponse>('/api/vision/expiry', { method: 'POST', body: form });
  },

  readReceipt: (photos: Blob[]) => {
    const form = new FormData();
    photos.forEach((p, i) => form.append('images', p, `receipt-${i}.jpg`));
    return api<ReceiptExtractionResponse>('/api/vision/receipt', { method: 'POST', body: form });
  },
};
