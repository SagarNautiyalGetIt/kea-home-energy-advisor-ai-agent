import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

export type PricingStyle = { id: string; name: string; eyebrow: string; rate: string; daily: string; bestFor: string; highlights: readonly string[]; badge?: string };
export type CommitmentTerm = { id: string; name: string; priceTreatment: string; monthlyCredit: string; creditNote: string; totalCredit: string; earlyExitFee: string; badge?: string };
export type PlansViewData = { pricingStyles: PricingStyle[]; commitmentTerms: CommitmentTerm[]; currentPlan: { pricingStyle: string; term: string } };

const plansPath = process.env.EXPO_PUBLIC_PLANS_PATH?.trim() || '/api/households/{customer_id}/plans';
const switchPath = process.env.EXPO_PUBLIC_PLAN_SWITCH_PATH?.trim() || '/api/households/{customer_id}/plan-switch';

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
      return {
        id: text(row.id, 'pricing ID'), name: text(row.name, 'pricing name'), eyebrow: text(row.eyebrow, 'pricing description'),
        rate: text(row.rate, 'pricing rate'), daily: text(row.daily, 'daily charge'), bestFor: text(row.bestFor ?? row.best_for, 'best-for text'),
        highlights: Array.isArray(highlights) ? highlights.map((entry) => text(entry, 'highlight')) : [],
        badge: typeof row.badge === 'string' ? row.badge : undefined,
      };
    }),
    commitmentTerms: terms.map((item) => {
      const row = record(item, 'commitment option');
      return {
        id: text(row.id, 'term ID'), name: text(row.name, 'term name'), priceTreatment: text(row.priceTreatment ?? row.price_treatment, 'price treatment'),
        monthlyCredit: text(row.monthlyCredit ?? row.monthly_credit, 'monthly credit'), creditNote: text(row.creditNote ?? row.credit_note, 'credit note'),
        totalCredit: text(row.totalCredit ?? row.total_credit, 'total credit'), earlyExitFee: text(row.earlyExitFee ?? row.early_exit_fee, 'early exit fee'),
        badge: typeof row.badge === 'string' ? row.badge : undefined,
      };
    }),
    currentPlan: { pricingStyle: text(current.pricingStyle ?? current.pricing_style, 'current pricing style'), term: text(current.term, 'current term') },
  };
}

export async function loadPlans(customerId: string, signal?: AbortSignal) {
  if (!customerId) return Promise.reject(new Error('A signed-in customer is required to load plans.'));
  return normalizePlans(await apiJson<unknown>(apiPath(plansPath, { customer_id: customerId }), { signal }));
}

export function requestPlanSwitch(customerId: string, pricingStyle: string, term: string) {
  return apiJson<void>(apiPath(switchPath, { customer_id: customerId }), jsonRequest('POST', {
    customer_id: customerId,
    pricing_style: pricingStyle,
    commitment_term: term,
  }));
}
