import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

const paymentPath = process.env.EXPO_PUBLIC_PAYMENT_PATH?.trim();
const paymentMethodsPath = process.env.EXPO_PUBLIC_PAYMENT_METHODS_PATH?.trim();

export function payInvoice(customerId: string, invoiceId: string, paymentMethodId: string) {
  if (!paymentPath) return Promise.reject(new Error('Invoice payments are not configured by the current Kea backend.'));
  return apiJson<void>(apiPath(paymentPath, { customer_id: customerId }), jsonRequest('POST', {
    customer_id: customerId,
    invoice_id: invoiceId,
    payment_method_id: paymentMethodId,
  }));
}

export function saveTokenizedPaymentMethod(customerId: string, paymentMethodToken: string, makeDefault: boolean) {
  if (!paymentMethodsPath) return Promise.reject(new Error('Saved payment methods are not configured by the current Kea backend.'));
  return apiJson<void>(apiPath(paymentMethodsPath, { customer_id: customerId }), jsonRequest('POST', {
    customer_id: customerId,
    payment_method_token: paymentMethodToken,
    make_default: makeDefault,
  }));
}

export function deletePaymentMethod(customerId: string, paymentMethodId: string) {
  if (!paymentMethodsPath) return Promise.reject(new Error('Saved payment methods are not configured by the current Kea backend.'));
  const path = `${apiPath(paymentMethodsPath, { customer_id: customerId }).replace(/\/$/, '')}/${encodeURIComponent(paymentMethodId)}`;
  return apiJson<void>(path, { method: 'DELETE' });
}

export async function tokenizePaymentCard(card: { name: string; number: string; expiry: string; cvc: string }) {
  const url = process.env.EXPO_PUBLIC_PAYMENT_TOKENIZATION_URL?.trim();
  const publicKey = process.env.EXPO_PUBLIC_PAYMENT_PUBLIC_KEY?.trim();
  if (!url || !publicKey) throw new Error('Payment-provider tokenization is not configured.');
  const [expiryMonth, expiryYear] = card.expiry.split('/').map((value) => value.trim());
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${publicKey}` },
    body: JSON.stringify({ cardholder: card.name, card_number: card.number.replace(/\s/g, ''), expiry_month: expiryMonth, expiry_year: expiryYear, cvc: card.cvc }),
  });
  if (!response.ok) throw new Error('The payment provider could not securely tokenize this card.');
  const body = await response.json() as Record<string, unknown>;
  const token = body.payment_method_token ?? body.token ?? body.id;
  if (typeof token !== 'string' || !token) throw new Error('The payment provider did not return a token.');
  return token;
}
