import type { ManualMealRequest } from '@/contracts/api';
import type { MealLog } from '@/contracts/domain';
import { api } from '@/features/pantry/api';

export const mealsApi = {
  log: (body: ManualMealRequest) => api<MealLog>('/api/meals', { method: 'POST', json: body }),
  remove: (id: string, eatenAt: string) =>
    api<{ ok: true }>(`/api/meals/${encodeURIComponent(id)}?eatenAt=${encodeURIComponent(eatenAt)}`, { method: 'DELETE' }),
};
