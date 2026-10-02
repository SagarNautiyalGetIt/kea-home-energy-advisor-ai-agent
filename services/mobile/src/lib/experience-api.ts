import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useAuth } from '@/providers/auth';
import { apiJson, apiPath } from './backend-client';

export type OutageView = {
  status: 'not_linked' | 'current' | 'stale'; storage: 'database' | 'memory';
  snapshot: null | { distributor: string; source_url: string; fetched_at: string; revision: number;
    events: { event_id: string; title: string; start: string; end: string; status: string; reason: string }[] };
};
export type ClashProgress = {
  total_xp: number; planning_xp: number; verified_xp: number; estimated_shift_savings_nzd: string | number; storage: 'database' | 'memory';
  missions: { id: string; title: string; question: string; planning_xp: number }[];
  events: { key: string; mission_id: string; evidence: string; xp: number; day: string; source: string }[];
};

export function useHouseholdResource<T>(resource: 'scheduled-outages' | 'clash') {
  const { session } = useAuth();
  const account = session?.customerId;
  const [state, setState] = useState<{ account: string; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!account) return;
    const controller = new AbortController();
    setError(null);
    void apiJson<T>(apiPath(`/api/households/{customer_id}/${resource}`, { customer_id: account }), { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setState({ account, data });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) { setState(null); setError(failure instanceof Error ? failure.message : 'Unavailable. Please retry.'); }
    });
    return () => controller.abort();
  // Explicit retry invalidates the focused request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, resource, revision]));
  return { data: state && state.account === account ? state.data : null, error, refresh: () => setRevision((current) => current + 1) };
}
