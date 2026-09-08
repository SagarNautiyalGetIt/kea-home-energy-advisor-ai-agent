import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceHtml } from './invoice-document.ts';

const invoice = {
  id: 'INV-1001',
  period: '1–31 August 2026',
  due: '14 September 2026',
  amount: 184.5,
  status: 'Due',
  customerName: 'Adela Parkson',
  customerId: '110733ap',
  customerAddress: '6 Mount Street, Auckland',
  paymentMethod: 'Visa ending in 4242',
  planName: 'Time & Use',
  planTerm: 'Variable <term>',
};

test('invoiceHtml uses the selected plan and consistent tariff disclosure', () => {
  const html = invoiceHtml(invoice);

  assert.match(html, /<h1>Time &amp; Use<\/h1>/);
  assert.match(html, /<p>Variable &lt;term&gt;<\/p>/);
  assert.match(html, /Illustrative invoice amounts use 30c\/kWh\./);
  assert.doesNotMatch(html, /<h1>Anytime Rate<\/h1>/);
});
