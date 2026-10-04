import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';
import { demoPlansData } from '@/data/mock';

export type PricingStyle = {
  id: string;
  name: string;
  eyebrow: string;
  summary?: string;
  rateLabel: string;
  rate: string;
  daily: string;
  rates: readonly { label: string; value: string; unit: string; window?: string }[];
  bestFor: string;
  highlights: readonly string[];
  badge?: string;
};

export type CommitmentTerm = {
  id: string;
  name: string;
  priceTreatment: string;
  monthlyCredit: string;
  creditNote: string;
  totalCredit: string;
  earlyExitFee: string;
  badge?: string;
};

export type PlansViewData = {
  pricingStyles: PricingStyle[];
  commitmentTerms: CommitmentTerm[];
  currentPlan: { pricingStyle: string; term: string };
  changeRequestsAvailable: boolean;
  limitation: string | null;
};

const plansPath = process.env.EXPO_PUBLIC_PLANS_PATH?.trim() || '/api/households/{customer_id}/plans';
const switchPath = process.env.EXPO_PUBLIC_PLAN_SWITCH_PATH?.trim();

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Plans response has an invalid ${label}.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Plans response is missing ${label}.`);
  return value;
}

function normalizePlans(value: unknown): PlansViewData {
  const root = record(value, 'body');
  const pricing = root.pricingStyles ?? root.pricing_styles;
  const terms = root.commitmentTerms ?? root.commitment_terms;
  const current = record(root.currentPlan ?? root.current_plan, 'current plan');
  if (!Array.isArray(pricing) || !Array.isArray(terms)) throw new Error('Plans response is missing plan options.');
  return {
    pricingStyles: pricing.map((item) => {
      const row = record(item, 'pricing option');
      const highlights = row.highlights;
      const rawRates = Array.isArray(row.rates) ? row.rates : [];
      const rates = rawRates.map((entry) => {
        const rate = record(entry, 'rate');
        return { label: text(rate.label, 'rate label'), value: text(rate.value, 'rate value'), unit: typeof rate.unit === 'string' ? rate.unit : '', window: typeof rate.window === 'string' ? rate.window : undefined };
      });
      const firstRate = rates[0];
      return {
        id: text(row.id, 'pricing ID'), name: text(row.name, 'pricing name'), eyebrow: text(row.eyebrow, 'pricing description'), summary: typeof row.summary === 'string' ? row.summary : undefined,
        rate: text(row.rate, 'pricing rate'), rateLabel: typeof row.rateLabel === 'string' ? row.rateLabel : firstRate?.label ?? 'Usage rate', daily: text(row.daily, 'daily charge').replace(/\s*\/day$/, ''), rates: rates.length ? rates : [{ label: typeof row.rateLabel === 'string' ? row.rateLabel : 'Usage rate', value: text(row.rate, 'pricing rate'), unit: String(row.rate).includes('/kWh') ? '' : '/kWh' }], bestFor: text(row.bestFor ?? row.best_for, 'best-for text'),
        highlights: Array.isArray(highlights) ? highlights.map((entry) => text(entry, 'highlight')) : [],
        badge: typeof (row.badge ?? row.flag) === 'string' ? String(row.badge ?? row.flag) : undefined,
      };
    }),
    commitmentTerms: terms.map((item) => {
      const row = record(item, 'commitment option');
      return {
        id: text(row.id, 'term ID'), name: text(row.name, 'term name'), priceTreatment: text(row.priceTreatment ?? row.price_treatment, 'price treatment'),
        monthlyCredit: text(row.monthlyCredit ?? row.monthly_credit, 'monthly credit'), creditNote: text(row.creditNote ?? row.credit_note, 'credit note'),
        totalCredit: text(row.totalCredit ?? row.total_credit, 'total credit'), earlyExitFee: text(row.earlyExitFee ?? row.early_exit_fee, 'early exit fee'),
        badge: typeof (row.badge ?? row.flag) === 'string' ? String(row.badge ?? row.flag) : undefined,
      };
    }),
    currentPlan: {
      pricingStyle: typeof (current.pricingStyle ?? current.pricing_style) === 'string' ? String(current.pricingStyle ?? current.pricing_style) : '',
      term: typeof current.term === 'string' ? current.term : '',
    },
    changeRequestsAvailable: root.change_requests_available === true,
    limitation: typeof root.limitation === 'string' ? root.limitation : null,
  };
}

export async function loadPlans(customerId: string, signal?: AbortSignal): Promise<PlansViewData> {
  const useRealData = process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'false';
  if (!useRealData) {
    return normalizePlans(demoPlansData);
  }
  try {
    return normalizePlans(await apiJson<unknown>(apiPath(plansPath, { customer_id: customerId }), { signal }));
  } catch (error) {
    throw error;
  }
}

export async function requestPlanSwitch(customerId: string, pricingStyle: string, term: string): Promise<void> {
  const useRealData = process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'false';
  if (!useRealData) return Promise.reject(new Error('Plan changes are not available in demo mode.'));
  if (!switchPath) return Promise.reject(new Error('Plan changes are not configured by the current Kea backend.'));
  return apiJson<void>(apiPath(switchPath, { customer_id: customerId }), jsonRequest('POST', {
    customer_id: customerId,
    pricing_style: pricingStyle,
    commitment_term: term,
  }));
}
