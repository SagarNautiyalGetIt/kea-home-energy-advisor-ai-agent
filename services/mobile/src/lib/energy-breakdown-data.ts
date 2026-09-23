import { apiFetch } from '@/lib/backend-client';

export type EnergyBreakdownCategory = {
  key: string;
  label: string;
  kwh: number;
  costNzd: number;
  sharePct: number;
  confidence: string;
  basis: string;
  caveat: string | null;
};

export type EnergyBreakdown = {
  available: boolean;
  period: string;
  categories: EnergyBreakdownCategory[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Energy breakdown response is invalid.');
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Energy breakdown is missing ${field}.`);
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Energy breakdown has an invalid ${field}.`);
  return value;
}

export async function loadEnergyBreakdown(customerId: string, signal?: AbortSignal): Promise<EnergyBreakdown> {
  const response = await apiFetch(`/api/households/${encodeURIComponent(customerId)}/energy-breakdown`, { signal });
  if (!response.ok) throw new Error(`Energy breakdown could not be loaded (${response.status}).`);
  const root = record(await response.json());
  const categories = Array.isArray(root.categories) ? root.categories.map((value) => {
    const row = record(value);
    return {
      key: text(row.key, 'category key'),
      label: text(row.label, 'category label'),
      kwh: number(row.kwh, 'category kWh'),
      costNzd: number(row.cost_nzd, 'category cost'),
      sharePct: number(row.share_pct, 'category share'),
      confidence: text(row.confidence, 'category confidence'),
      basis: text(row.basis, 'category basis'),
      caveat: typeof row.caveat === 'string' ? row.caveat : null,
    };
  }) : [];
  return { available: root.available === true, period: typeof root.period === 'string' ? root.period : '', categories };
}
