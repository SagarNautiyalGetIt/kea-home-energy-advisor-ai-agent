import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiJson, jsonRequest } from '@/lib/backend-client';

type EvContext = { account_ref: string; has_ev: boolean | null };
const key = (customerId: string) => `kea-ev-ownership-v1-${customerId}`;

/** Keep the answer scoped to this account on this device, then restore it after API restarts. */
export async function restoreEvAnswer(customerId: string) {
  if (!customerId) return;
  const saved = await AsyncStorage.getItem(key(customerId));
  if (saved !== 'yes' && saved !== 'no') return;
  await apiJson<EvContext>(`/api/households/${encodeURIComponent(customerId)}/context/ev`, jsonRequest('PUT', { has_ev: saved === 'yes' }));
}

/** Read the typed backend answer after a chat turn; never infer it from chat text. */
export async function rememberEvAnswer(customerId: string) {
  if (!customerId) return;
  const context = await apiJson<EvContext>(`/api/households/${encodeURIComponent(customerId)}/context`);
  if (context.account_ref !== customerId || typeof context.has_ev !== 'boolean') return;
  await AsyncStorage.setItem(key(customerId), context.has_ev ? 'yes' : 'no');
}
