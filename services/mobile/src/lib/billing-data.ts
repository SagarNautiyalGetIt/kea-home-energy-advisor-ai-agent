import { apiFetch } from '@/lib/backend-client';

export type PaymentStatus = 'Due' | 'Paid' | 'Pending' | 'Cancelled' | 'Unknown';

export type BillingChargeLine = {
  label: string;
  quantity: string | null;
  rate: string | null;
  amount: number | null;
};

export type BillingInvoice = {
  id: string;
  issued: string | null;
  period: string | null;
  days: number | null;
  due: string | null;
  amount: number | null;
  amountDue: number | null;
  status: PaymentStatus;
  chargeLines: BillingChargeLine[];
  gst: number | null;
  previousBalance: number | null;
  paymentsAndCredits: number | null;
  latePaymentFee: number | null;
};

export type BillingCustomer = {
  name: string | null;
  id: string;
  address: string | null;
  currentPlan: string | null;
};

export type SavedPaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  cardholder: string | null;
  expiry: string | null;
  isDefault: boolean;
};

export type BillingViewData = {
  customer: BillingCustomer;
  invoices: BillingInvoice[];
  savedPaymentMethods: SavedPaymentMethod[];
};

export type BillingLoadResult =
  | { state: 'ready'; data: BillingViewData }
  | { state: 'unavailable'; message: string; data: BillingViewData };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
const billingPath = process.env.EXPO_PUBLIC_BILLING_PATH?.trim() || '/api/households/{customer_id}/billing';
const EMPTY_VALUE = '—';

export function emptyBillingData(customerId: string): BillingViewData {
  return {
    customer: { name: null, id: customerId, address: null, currentPlan: null },
    invoices: [],
    savedPaymentMethods: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Billing response has an invalid ${field}.`);
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Billing response has an invalid ${field}.`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Billing response is missing ${field}.`);
  return value;
}

function validateChargeLine(value: unknown): BillingChargeLine {
  if (!isRecord(value)) throw new Error('Billing response has an invalid charge line.');
  return {
    label: requiredString(value.label, 'charge line label'),
    quantity: nullableString(value.quantity, 'charge line quantity'),
    rate: nullableString(value.rate, 'charge line rate'),
    amount: nullableNumber(value.amount, 'charge line amount'),
  };
}

function validateInvoice(value: unknown): BillingInvoice {
  if (!isRecord(value)) throw new Error('Billing response has an invalid invoice.');
  const status = value.status;
  const rawChargeLines = value.chargeLines ?? value.charge_lines;
  const electricityCharges = nullableNumber(value.electricityCharges ?? value.electricity_charges, 'electricity charges');
  const chargeLines = Array.isArray(rawChargeLines)
    ? rawChargeLines.map(validateChargeLine)
    : electricityCharges === null
      ? []
      : [{ label: 'Electricity charges', quantity: null, rate: null, amount: electricityCharges }];
  return {
    id: requiredString(value.number ?? value.id ?? value.invoice_number, 'invoice ID'),
    issued: nullableString(value.issued ?? value.issue_date, 'invoice date'),
    period: nullableString(value.period, 'billing period'),
    days: nullableNumber(value.days ?? value.period_days, 'billing days'),
    due: nullableString(value.due ?? value.due_date, 'due date'),
    amount: nullableNumber(value.amount ?? value.total, 'invoice amount'),
    amountDue: nullableNumber(value.amountDue ?? value.amount_due, 'amount due'),
    status: status === 'Due' || status === 'Paid' || status === 'Pending' || status === 'Cancelled' ? status : 'Unknown',
    chargeLines,
    gst: nullableNumber(value.tax ?? value.gst ?? value.gst_included, 'GST'),
    previousBalance: nullableNumber(value.previousBalance ?? value.previous_balance, 'previous balance'),
    paymentsAndCredits: nullableNumber(value.paymentsAndCredits ?? value.payments_and_credits, 'payments and credits'),
    latePaymentFee: nullableNumber(value.latePaymentFee ?? value.late_payment_fee, 'late payment fee'),
  };
}

function validateBillingResponse(value: unknown, customerId: string): BillingViewData {
  if (!isRecord(value) || !isRecord(value.customer) || !Array.isArray(value.invoices)) {
    throw new Error('Billing response is missing required sections.');
  }
  const customer = value.customer;
  const responseCustomerId = customer.id ?? customer.customer_id;
  if (responseCustomerId !== customerId) throw new Error('Billing response belongs to a different customer.');
  const currentPlan = value.currentPlan ?? value.current_plan;
  const rawPaymentMethods = value.savedPaymentMethods ?? value.saved_payment_methods;
  const savedPaymentMethods = Array.isArray(rawPaymentMethods)
    ? rawPaymentMethods.flatMap((method): SavedPaymentMethod[] => {
      if (!isRecord(method)) return [];
      const id = method.id;
      const brand = method.brand;
      const last4 = method.last4 ?? method.last_4;
      if (typeof id !== 'string' || typeof brand !== 'string' || typeof last4 !== 'string') return [];
      return [{
        id,
        brand,
        last4,
        cardholder: nullableString(method.cardholder ?? method.cardholderName, 'cardholder'),
        expiry: nullableString(method.expiry, 'card expiry'),
        isDefault: method.isDefault === true || method.is_default === true,
      }];
    })
    : [];
  return {
    customer: {
      name: nullableString(customer.name ?? customer.display_name, 'customer name'),
      id: customerId,
      address: nullableString(customer.address ?? customer.supply_address, 'supply address'),
      currentPlan: isRecord(currentPlan)
        ? nullableString(currentPlan.name ?? currentPlan.id, 'current plan')
        : nullableString(currentPlan, 'current plan'),
    },
    invoices: value.invoices.map(validateInvoice),
    savedPaymentMethods,
  };
}

async function fetchBilling(customerId: string, signal: AbortSignal): Promise<BillingViewData> {
  if (!apiBaseUrl) throw new Error('Billing service is not connected yet.');
  const endpoint = billingPath.replace('{customer_id}', encodeURIComponent(customerId));
  if (!endpoint.startsWith('/')) throw new Error('Billing path must be relative to EXPO_PUBLIC_API_URL.');
  const response = await apiFetch(endpoint, { signal });
  if (!response.ok) throw new Error(`Billing data could not be loaded (${response.status}).`);
  return validateBillingResponse(await response.json(), customerId);
}

export async function loadBillingData(customerId: string, signal: AbortSignal): Promise<BillingLoadResult> {
  if (!apiBaseUrl) return { state: 'unavailable', message: 'Billing service is not connected yet.', data: emptyBillingData(customerId) };
  if (!customerId) throw new Error('A verified customer ID is required to load billing. Please sign in again.');
  return { state: 'ready', data: await fetchBilling(customerId, signal) };
}

export function billingPlaceholderInvoice(): BillingInvoice {
  return {
    id: EMPTY_VALUE,
    issued: null,
    period: null,
    days: null,
    due: null,
    amount: null,
    amountDue: null,
    status: 'Unknown',
    chargeLines: [],
    gst: null,
    previousBalance: null,
    paymentsAndCredits: null,
    latePaymentFee: null,
  };
}

export const unavailableValue = EMPTY_VALUE;
