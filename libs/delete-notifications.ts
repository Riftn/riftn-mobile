import { apiClient } from './api.client';

const BATCH_SIZE = 100;

/** Returns the IDs in batches that succeeded, including those already deleted. */
export async function deleteNotificationIds(ids: readonly string[], wallet: string): Promise<string[]> {
  const unique = [...new Set(ids)];
  const batches = Array.from({ length: Math.ceil(unique.length / BATCH_SIZE) }, async (_, index) => {
    const batch = unique.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
    await apiClient.post('/notification/delete-selected', { ids: batch, wallet }, { isAuthRequired: true });
    return batch;
  });

  return (await Promise.allSettled(batches)).flatMap(result =>
    result.status === 'fulfilled' ? result.value : [],
  );
}
