import { apiFetch } from '@/lib/backend-client';
import { demoBillingData } from '@/data/mock';

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
  cardholder: string;
  expiry: string;
  isDefault: boolean;
};

export type BillingViewData = {
  customer: BillingCustomer;
  invoices: BillingInvoice[];
  savedPaymentMethods?: SavedPaymentMethod[];
};

export type BillingLoadResult =
  | { state: 'ready'; data: BillingViewData }
  | { state: 'unavailable'; message: string; data: BillingViewData };

const billingPath = '/api/households/{customer_id}/billing';
const EMPTY_VALUE = '—';

export function emptyBillingData(customerId: string): BillingViewData {
  return {
    customer: { name: null, id: customerId, address: null, currentPlan: null },
    invoices: [],
    savedPaymentMethods: demoSavedPaymentMethods(customerId, null),
  };
}

const profileCustomerId = demoBillingData.customer.id;

function demoBillingFallback(customerId: string, customerName?: string): BillingViewData {
  const name = customerName?.trim() || 'Kea Energy customer';
  return {
    customer: {
      ...demoBillingData.customer,
      id: customerId,
      name,
    },
    invoices: demoBillingData.invoices.map((invoice) => ({
      ...invoice,
      id: `${customerId}-demo-invoice`,
      chargeLines: invoice.chargeLines.map((line) => ({ ...line })),
    })),
    savedPaymentMethods: demoSavedPaymentMethods(customerId, name),
  };
}

const demoCardByCustomer: Record<string, Omit<SavedPaymentMethod, 'cardholder'>> = {
  'H-JUL': { id: 'pm-july', brand: 'Visa', last4: '4242', expiry: '09/28', isDefault: true },
  'H-COLD': { id: 'pm-cold', brand: 'Mastercard', last4: '5556', expiry: '03/29', isDefault: true },
  'H-SPIKE': { id: 'pm-spike', brand: 'Visa', last4: '1881', expiry: '11/27', isDefault: true },
  'H-DROP': { id: 'pm-drop', brand: 'Visa', last4: '9010', expiry: '06/28', isDefault: true },
  'H-TARIFF': { id: 'pm-tariff', brand: 'Mastercard', last4: '5100', expiry: '02/29', isDefault: true },
  'H-ZARA': { id: 'pm-zara', brand: 'Visa', last4: '2468', expiry: '08/28', isDefault: true },
  'H-AROHA': { id: 'pm-aroha', brand: 'Visa', last4: '1357', expiry: '05/29', isDefault: true },
  '110733ap': { id: 'pm-profile', brand: 'Visa', last4: '4242', expiry: '09/28', isDefault: true },
  'DEMO-ACCT-221001': { id: 'pm-julia', brand: 'Visa', last4: '4242', expiry: '09/28', isDefault: true },
  'DEMO-ACCT-222001': { id: 'pm-ana', brand: 'Mastercard', last4: '5556', expiry: '03/29', isDefault: true },
  'DEMO-ACCT-223001': { id: 'pm-tama', brand: 'Visa', last4: '1881', expiry: '11/27', isDefault: true },
  'DEMO-ACCT-224001': { id: 'pm-mere', brand: 'Visa', last4: '9010', expiry: '06/28', isDefault: true },
};

function demoSavedPaymentMethods(customerId: string, customerName: string | null): SavedPaymentMethod[] {
  const card = demoCardByCustomer[customerId];
  return card ? [{ ...card, cardholder: customerName ?? 'Kea Energy customer' }] : [];
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
    savedPaymentMethods: demoSavedPaymentMethods(customerId, nullableString(customer.name ?? customer.display_name, 'customer name')),
  };
}

async function fetchBilling(customerId: string, signal: AbortSignal): Promise<BillingViewData> {
  const endpoint = billingPath.replace('{customer_id}', encodeURIComponent(customerId));
  if (!endpoint.startsWith('/')) throw new Error('Billing path must be relative to EXPO_PUBLIC_API_URL.');
  const response = await apiFetch(endpoint, { signal });
  if (!response.ok) throw new Error(`Billing data could not be loaded (${response.status}).`);
  return validateBillingResponse(await response.json(), customerId);
}

export async function loadBillingData(customerId: string, signal: AbortSignal, customerName?: string): Promise<BillingLoadResult> {
  const useRealData = process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'false';
  if (!useRealData) {
    return { state: 'ready', data: demoBillingFallback(customerId || profileCustomerId, customerName) };
  }
  if (!customerId) return { state: 'unavailable', data: emptyBillingData(customerId), message: 'A signed-in customer is required to load billing.' };
  try {
    return { state: 'ready', data: await fetchBilling(customerId, signal) };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return {
      state: 'unavailable',
      data: emptyBillingData(customerId),
      message: error instanceof Error ? error.message : 'Billing data is unavailable right now.',
    };
  }
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
