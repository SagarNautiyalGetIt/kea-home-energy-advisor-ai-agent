type InvoiceDocument = {
  id: string;
  period: string | null;
  due: string | null;
  amount: number | null;
  amountDue: number | null;
  issued: string | null;
  days: number | null;
  status: string;
  customerName: string | null;
  customerId: string;
  customerAddress: string | null;
  currentPlan: string | null;
  chargeLines: { label: string; quantity: string | null; rate: string | null; amount: number | null }[];
  gst: number | null;
  previousBalance: number | null;
  paymentsAndCredits: number | null;
  latePaymentFee: number | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character);
}

function printableText(value: string) {
  return escapeHtml(value.replace(/[–—‑]/g, '-'));
}

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function money(value: number | null) {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export function invoiceHtml(invoice: InvoiceDocument) {
  const isPaid = invoice.status === 'Paid';
  const billedAmount = money(invoice.amount);
  const amountDue = isPaid ? '$0.00' : money(invoice.amountDue ?? invoice.amount);
  const rows = [
    ['Invoice', invoice.id],
    ['Invoice date', display(invoice.issued)],
    ['Billing period', display(invoice.period)],
    ['Billing days', display(invoice.days)],
    ['Due date', display(invoice.due)],
    ['Status', invoice.status],
    ['Customer', display(invoice.customerName)],
    ['Customer ID', invoice.customerId],
    ['Current Plan', display(invoice.currentPlan)],
    ['Meter read', '—'],
    ['Supply address', display(invoice.customerAddress)],
  ];
  const charges = invoice.chargeLines.length
    ? invoice.chargeLines.map((line) => [line.label, display(line.quantity), display(line.rate), money(line.amount)])
    : [['Charges unavailable', '—', '—', '—']];

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @page { size: A4; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; color: #172554; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
        .sheet { width: 210mm; height: 297mm; padding: 18mm 14mm 16mm; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
        .sheet:last-child { break-after: auto; page-break-after: auto; }
        .invoice { width: 100%; height: 100%; margin: 0 auto; border: 1.5px solid #cbd5e1; border-radius: 22px; overflow: hidden; }
        header { display: flex; align-items: center; gap: 16px; padding: 24px 28px; background: linear-gradient(120deg, #ebe8ff, #f8f7ff 58%, #ffe8ed); }
        .mark { width: 64px; height: 64px; flex: 0 0 64px; padding: 5px; border: 1.5px solid #c8c1ff; border-radius: 18px; background: #fff; }
        .mark svg { display: block; width: 100%; height: 100%; }
        h1 { margin: 0; color: #172554; font-size: 27px; line-height: 1.1; }
        header p { margin: 6px 0 0; color: #3f4d72; font-size: 14px; font-weight: 600; }
        .status { margin-left: auto; padding: 8px 13px; border-radius: 999px; color: ${invoice.status === 'Paid' ? '#126247' : '#b4233b'}; background: ${invoice.status === 'Paid' ? '#d9f5e9' : '#ffe2e7'}; font-size: 13px; font-weight: 800; }
        main { padding: 20px 28px 24px; }
        .amount { margin-bottom: 18px; text-align: center; } .amount span { display: block; color: #3f4d72; font-size: 13px; font-weight: 600; } .amount strong { display: block; margin: 2px 0; color: #172554; font-size: 36px; }
        .details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px 9px; }
        .detail { min-width: 0; }
        .detail-wide { grid-column: 1 / -1; }
        .detail span { display: block; margin: 0 2px 5px; color: #52617f; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .25px; }
        .detail strong { display: flex; min-height: 44px; align-items: center; padding: 9px 12px; border: 1px solid #d8deea; border-radius: 11px; color: #172554; background: #f8fafc; font-size: 12px; line-height: 1.35; }
        .charges { margin-top: 0; } .charges h2 { margin: 0 0 5px; color: #172554; font-size: 19px; } .charges > p { margin: 0 0 12px; color: #475569; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; }
        th { padding: 10px 9px; color: #334155; background: #f1f5f9; font-size: 11px; text-align: left; } th:last-child, td:last-child { text-align: right; }
        td { padding: 11px 9px; color: #172554; border-top: 1px solid #d8deea; font-size: 12px; font-weight: 650; }
        .summary { width: min(340px, 100%); margin: 13px 0 0 auto; } .summary div { display: flex; justify-content: space-between; gap: 20px; padding: 7px 2px; color: #334155; font-size: 13px; } .summary strong { color: #172554; }
        .summary .total { margin-top: 5px; padding: 12px 14px; border-radius: 10px; color: #fff; background: #4a25ff; font-size: 15px; font-weight: 800; } .summary .total strong { color: #fff; }
        .note { margin: 22px 0 0; padding: 14px 16px; border-left: 4px solid #e85d04; border-radius: 0 12px 12px 0; color: #4b3b4f; background: #fff0df; font-size: 14px; line-height: 1.45; }
        footer { padding: 19px 28px 26px; color: #334155; border-top: 1px solid #d8deea; font-size: 13px; line-height: 1.55; } footer strong { color: #172554; font-size: 14px; }
      </style>
    </head>
    <body>
      <section class="sheet">
        <section class="invoice">
          <header>
            <div class="mark" aria-label="Kea Energy logo"><svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M33 128A95 95 0 0 1 208.6 77.6" fill="none" stroke="#868CFF" stroke-width="15" stroke-linecap="round"/><path d="M226 96L222 68L197 85Z" fill="#868CFF"/><path d="M223 128A95 95 0 0 1 47.4 178.4" fill="none" stroke="#868CFF" stroke-width="15" stroke-linecap="round"/><path d="M30 160L34 188L59 171Z" fill="#868CFF"/><path d="M143 54L137 110L166.5 119.4Q178 123 170.1 131.9L109 201L117 149L89 139.4Q79 136 87 125.8Z" fill="#4A25FF" transform="translate(-12.8 -12.8) scale(1.1)"/></svg></div>
            <div><h1>Kea Energy</h1><p>Electricity invoice</p></div>
            <span class="status">${printableText(invoice.status)}</span>
          </header>
          <main>
            <div class="amount"><span>Total amount due</span><strong>${amountDue}</strong><span>${isPaid ? 'Payment received' : `Pay by ${printableText(display(invoice.due))}`}</span></div>
            <div class="details">${rows.map(([label, value]) => `<div class="detail${label === 'Supply address' ? ' detail-wide' : ''}"><span>${printableText(label ?? '')}</span><strong>${printableText(String(value ?? ''))}</strong></div>`).join('')}</div>
          </main>
        </section>
      </section>
      <section class="sheet">
        <section class="invoice">
          <main>
            <section class="charges">
              <h2>Electricity charges</h2>
              <p>Your electricity use this period was charged using the rates below. Rates and amounts include GST where provided.</p>
              <table><thead><tr><th>Description</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${charges.map((charge) => `<tr>${charge.map((value) => `<td>${printableText(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>
              <div class="summary"><div><span>Current electricity charges</span><strong>${billedAmount}</strong></div><div><span>GST included</span><strong>${money(invoice.gst)}</strong></div><div><span>Previous balance</span><strong>${money(invoice.previousBalance)}</strong></div><div><span>Payments and credits</span><strong>${money(invoice.paymentsAndCredits)}</strong></div><div><span>Late payment fee</span><strong>${money(invoice.latePaymentFee)}</strong></div><div class="total"><span>Total amount due</span><strong>${amountDue}</strong></div></div>
            </section>
            <p class="note"><strong>Payment:</strong> Choose your preferred payment method and pay before the due date.</p>
          </main>
          <footer><strong>Terms &amp; Conditions</strong><br />Please pay by the due date shown on this invoice.<br /><br />Thank you for choosing Kea Energy.</footer>
        </section>
      </section>
    </body>
  </html>`;
}
