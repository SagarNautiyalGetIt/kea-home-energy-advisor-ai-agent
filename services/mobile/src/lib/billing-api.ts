import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

const paymentPath = process.env.EXPO_PUBLIC_PAYMENT_PATH?.trim() || '/api/households/{customer_id}/payments';
const paymentMethodsPath = process.env.EXPO_PUBLIC_PAYMENT_METHODS_PATH?.trim() || '/api/households/{customer_id}/payment-methods';

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
