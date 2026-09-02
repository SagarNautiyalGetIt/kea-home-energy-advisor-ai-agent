import { CreditCard, Download, Eye, Printer, WalletCards } from 'lucide-react'
import { useState } from 'react'
import Modal from '../components/Modal'
import { commitmentTerms, currentPlan, pricingStyles } from '../data/mockData'
import { downloadTextPdf } from '../utils/downloadPdf'

const invoices = [
  { number:'367274627', period:'05 Aug 2026 – 19 Aug 2026', due:'01 Sep 2026', amount:'$184.50', status:'Due' },
  { number:'361892440', period:'05 Jul 2026 – 04 Aug 2026', due:'18 Aug 2026', amount:'$148.20', status:'Paid' },
  { number:'355703118', period:'05 Jun 2026 – 04 Jul 2026', due:'18 Jul 2026', amount:'$132.76', status:'Paid' },
]
type Invoice = (typeof invoices)[number]
const currentInvoice = invoices[0] ?? { number:'367274627', period:'05 Aug 2026 – 19 Aug 2026', due:'01 Sep 2026', amount:'$184.50', status:'Due' }
const customer = { name:'Adela Parkson', id:'110733ap', address:'6 Mount Street, Auckland Central, Auckland 1010, NZ', payment:'Visa ending in 4242' }
// The invoice header follows the same source as the Plans page, so the two
// pages cannot drift apart when the plan model changes.
const plan = pricingStyles.find((style) => style.id === currentPlan.pricingStyle) ?? pricingStyles[0]!
const planTerm = commitmentTerms.find((term) => term.id === currentPlan.term) ?? commitmentTerms[0]!

export default function BillingPage({ onToast }: { onToast: (message:string,tone?:'success'|'info'|'warning')=>void }) {
  const [selected,setSelected] = useState<Invoice>(currentInvoice)
  const [previewOpen,setPreviewOpen] = useState(false)
  const [paymentOpen,setPaymentOpen] = useState(false)
  const [methodOpen,setMethodOpen] = useState(false)
  const [paidInvoices,setPaidInvoices] = useState<string[]>([])
  const [cardName,setCardName] = useState(customer.name)
  const statusFor=(invoice:Invoice)=>paidInvoices.includes(invoice.number)?'Paid':invoice.status
  const openPayment=(invoice:Invoice)=>{setSelected(invoice);setPaymentOpen(true)}
  const downloadInvoice = (invoice: Invoice = selected) => {
    downloadTextPdf(`kea-invoice-${invoice.number}.pdf`, 'KEA ENERGY INVOICE', [
      `Invoice: ${invoice.number}`, `Billing period: ${invoice.period}`, `Due date: ${invoice.due}`,
      `Customer: ${customer.name}`, `Customer ID: ${customer.id}`, `Address: ${customer.address}`,
      `Payment method: ${customer.payment}`, `Status: ${statusFor(invoice)}`, `Total: ${invoice.amount}`,
      '', 'Cost basis: illustrative rate of 30c/kWh.', 'Thank you for choosing Kea Energy.',
    ])
    onToast('Invoice PDF downloaded')
  }
  const paySelected=()=>{setPaidInvoices((items)=>[...items,selected.number]);setPaymentOpen(false);onToast(`Invoice ${selected.number} paid successfully`)}
  const currentPaid=statusFor(currentInvoice)==='Paid'
  return <>
    <div className="page-heading billing-heading"><div><h1>Billing</h1><p className="billing-description">Pay invoices, track payment status and manage your saved payment method.</p></div><button className="secondary-action" onClick={()=>window.print()}><Printer/>Print</button></div>
    <section className="billing-summary-grid"><article className="card balance-card"><span>Current balance</span><strong>{currentPaid?'$0.00':'$184.50'}</strong><small>{currentPaid?'Payment received':'Due 1 Sep 2026'}</small><button disabled={currentPaid} onClick={()=>openPayment(currentInvoice)}>{currentPaid?'Paid':'Pay bill'}</button></article><article className="card payment-method"><CreditCard/><div><span>Payment method</span><strong>Visa ending in 4242</strong><small>{cardName}</small></div><button onClick={()=>setMethodOpen(true)}>Manage</button></article></section>
    <article className="invoice card"><header><div className="plan-symbol"><img src="/assets/brand/kea-brand-blue.svg" alt=""/></div><div><h2>{plan.name}</h2><p>{plan.summary}</p><p>{planTerm.name} term · {planTerm.priceTreatment.toLowerCase()}</p></div><span className={`status-badge status-${currentPaid?'paid':'due'}`}>{currentPaid?'Paid':'Due'}</span></header><div className="invoice-columns"><dl><dt>Total Amount Due</dt><dd>{currentPaid?'$0.00':'$184.50'}</dd><dt>Due Date</dt><dd>01/09/2026</dd><dt>Period</dt><dd>05/08/2026 – 19/08/2026</dd><dt>Invoice No</dt><dd>367274627</dd></dl><dl><dt>Customer Name</dt><dd>{customer.name}</dd><dt>Customer ID</dt><dd>{customer.id}</dd><dt>Customer Address</dt><dd>{customer.address}</dd><dt>Payment Method</dt><dd>{customer.payment}</dd></dl></div><p className="invoice-note"><strong>Payment:</strong> Pay securely using your saved card before the due date.</p><div className="invoice-totals"><span>Electricity Charges<strong>$152.14</strong></span><span>GST<strong>$32.36</strong></span><span className="total">Total Charges for this Period<strong>$184.50</strong></span><span>Late Payment Fee if paid after 1 Sep 2026<strong>$37.21</strong></span><span className="total">Total Amount Due if paid after 1 Sep 2026<strong>$227.71</strong></span></div><footer><strong>Terms &amp; Conditions</strong><p>Please pay by the due date shown on this invoice.</p></footer></article>
    <section className="card invoice-history"><header><div><h2>Invoice history</h2><p>Your latest account documents.</p></div></header><div className="invoice-table" role="table"><div className="invoice-table-head" role="row"><span>Invoice</span><span>Period</span><span>Amount</span><span>Status</span><span>Actions</span></div>{invoices.map((invoice)=><div role="row" key={invoice.number}><strong>{invoice.number}</strong><span>{invoice.period}</span><span>{invoice.amount}</span><span><b className={`status-badge status-${statusFor(invoice).toLowerCase()}`}>{statusFor(invoice)}</b></span><span className="invoice-actions"><button aria-label={`View invoice ${invoice.number}`} onClick={()=>{setSelected(invoice);setPreviewOpen(true)}}><Eye/></button><button aria-label={`Download invoice ${invoice.number} as PDF`} onClick={()=>downloadInvoice(invoice)}><Download/></button>{statusFor(invoice)==='Due'&&<button className="pay-action" aria-label={`Pay invoice ${invoice.number}`} onClick={()=>openPayment(invoice)}><WalletCards/></button>}</span></div>)}</div></section>
    {previewOpen&&<Modal title={`Invoice ${selected.number}`} onClose={()=>setPreviewOpen(false)} footer={<><button className="secondary-action" onClick={()=>window.print()}><Printer/>Print</button><button className="primary-action" onClick={()=>downloadInvoice()}><Download/>Download PDF</button></>}><div className="invoice-preview"><img src="/assets/brand/kea-brand-blue.svg" alt=""/><h3>{selected.amount}</h3><p>{selected.period}</p><dl><dt>Due date</dt><dd>{selected.due}</dd><dt>Status</dt><dd>{statusFor(selected)}</dd><dt>Customer ID</dt><dd>{customer.id}</dd><dt>Payment method</dt><dd>{customer.payment}</dd><dt>Address</dt><dd>{customer.address}</dd></dl></div></Modal>}
    {paymentOpen&&<Modal title={`Pay invoice ${selected.number}`} onClose={()=>setPaymentOpen(false)} footer={<><button className="secondary-action" onClick={()=>setPaymentOpen(false)}>Cancel</button><button className="primary-action" onClick={paySelected}>Pay {selected.amount}</button></>}><div className="payment-confirm"><CreditCard/><p>Pay <strong>{selected.amount}</strong> using Visa ending in 4242?</p><small>Your payment will be applied to invoice {selected.number}.</small></div></Modal>}
    {methodOpen&&<Modal title="Manage payment method" onClose={()=>setMethodOpen(false)} footer={<><button className="secondary-action" onClick={()=>setMethodOpen(false)}>Cancel</button><button className="primary-action" onClick={()=>{setMethodOpen(false);onToast('Payment method updated')}}>Save</button></>}><div className="payment-form"><label>Cardholder name<input value={cardName} onChange={(event)=>setCardName(event.target.value)}/></label><label>Saved card<input value="Visa ending in 4242" readOnly/></label></div></Modal>}
  </>
}
