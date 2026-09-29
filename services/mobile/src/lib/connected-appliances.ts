import { apiJson } from '@/lib/backend-client';

export type ConnectedAppliance = {
  id: string;
  label: string;
  deviceClass: string;
  kwh: number;
  costNzd: number | null;
  sharePct: number | null;
  daysObserved: number;
};

export type ConnectedAppliances = {
  available: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  devices: ConnectedAppliance[];
};

export async function loadConnectedAppliances(customerId: string, signal?: AbortSignal): Promise<ConnectedAppliances> {
  const response = await apiJson<Record<string, unknown>>(`/api/households/${encodeURIComponent(customerId)}/appliances`, { signal });
  const devices = Array.isArray(response.devices) ? response.devices.flatMap((raw): ConnectedAppliance[] => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (row.confidence !== 'measured' || typeof row.device_id !== 'string' || typeof row.label !== 'string' || typeof row.device_class !== 'string' || typeof row.total_kwh !== 'number' || !Number.isFinite(row.total_kwh)) return [];
    return [{
      id: row.device_id,
      label: row.label,
      deviceClass: row.device_class,
      kwh: row.total_kwh,
      costNzd: typeof row.total_cost_nzd === 'number' && Number.isFinite(row.total_cost_nzd) ? row.total_cost_nzd : null,
      sharePct: typeof row.share_of_bill_pct === 'number' && Number.isFinite(row.share_of_bill_pct) ? row.share_of_bill_pct : null,
      daysObserved: typeof row.days_observed === 'number' ? row.days_observed : 0,
    }];
  }) : [];
  return {
    available: response.available === true,
    periodStart: typeof response.period_start === 'string' ? response.period_start : null,
    periodEnd: typeof response.period_end === 'string' ? response.period_end : null,
    devices,
  };
}
