import { Download, Eye, CreditCard } from 'lucide-react'
import { useEffect, useState } from 'react'
import FeedbackState from '../components/FeedbackState'
import Modal from '../components/Modal'
import { accountRequest, type Billing } from '../lib/account-client'
import { downloadInvoicePdf } from '../utils/invoicePdf'

const money = (value: number | null | undefined) => value == null ? 'Not available' : `$${value.toFixed(2)}`
type Invoice = Billing['invoices'][number]

export default function BillingPage({ onToast }: { onToast: (message: string, tone?: 'success'|'info'|'warning') => void }) {
  const [billing, setBilling] = useState<Billing | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setBilling(null)
    void accountRequest<Billing>('billing', controller.signal).then(setBilling).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [reload])
  const download = (invoice: Invoice) => {
    if (!billing) return
    void downloadInvoicePdf({ number: invoice.id, period: invoice.period ?? 'Not available',
      due: invoice.due ?? 'Not on file', amount: money(invoice.amount), status: invoice.status,
      customerName: billing.customer.name ?? 'Kea customer', customerId: billing.customer.id,
      address: billing.customer.address ?? 'Not on file', paymentMethod: 'Not on file',
      planName: billing.current_plan ?? 'Not on file', gst:invoice.gst, chargeLines:invoice.charge_lines,
      estimated:invoice.status === 'Pending' }).then(() => onToast('Account document downloaded'))
  }
  const latest = billing?.invoices[0]
  return <>
    <div className="page-heading billing-heading"><div><h1>Billing</h1><p>Your account balance and available billing records.</p></div></div>
    {error ? <FeedbackState state="error" message={error} onRetry={() => setReload(value => value + 1)}/> : !billing ? <FeedbackState state="loading" title="Loading your bills" message="Reading your account records…"/> : <>
      {latest ? <article className="invoice card"><header><div><h2>{billing.current_plan ?? 'Your electricity account'}</h2><p>{latest.period}</p></div><span className="status-badge">{latest.status === 'Pending' ? 'Estimate / status unavailable' : latest.status}</span></header>
        <div className="invoice-columns"><dl><dt>Amount outstanding</dt><dd>{money(latest.amount_due)}</dd><dt>Due date</dt><dd>{latest.due ?? 'Not on file'}</dd><dt>Record</dt><dd>{latest.id}</dd></dl><dl><dt>Customer</dt><dd>{billing.customer.name ?? billing.customer.id}</dd><dt>Account</dt><dd>{billing.customer.id}</dd><dt>Address</dt><dd>{billing.customer.address ?? 'Not on file'}</dd></dl></div>
        <div className="invoice-totals">{(latest.charge_lines ?? []).map((line, index) => <span key={index}>{line.label}<strong>{money(line.amount)}</strong></span>)}<span className="total">Total<strong>{money(latest.amount)}</strong></span></div>
        <p className="invoice-note">Estimates are separate from issued invoices. Payment status is shown only when account records confirm it.</p>
      </article> : <FeedbackState state="empty" message="No billing records are available."/>}
      <section className="card invoice-history"><header><h2>Billing history</h2></header><div className="invoice-table" role="table"><div className="invoice-table-head" role="row"><span>Record</span><span>Period / due date</span><span>Amount</span><span>Status</span><span>Actions</span></div>
        {billing.invoices.map(invoice => <div role="row" key={invoice.id}><strong>{invoice.id}</strong><span>{invoice.period}<br/>{invoice.due ?? 'Due date not on file'}</span><span>{money(invoice.amount)}</span><span>{invoice.status === 'Pending' ? 'Not confirmed' : invoice.status}</span><span className="invoice-actions"><button aria-label={`View ${invoice.id}`} onClick={() => setSelected(invoice)}><Eye/></button><button aria-label={`Download ${invoice.id}`} onClick={() => download(invoice)}><Download/></button>{invoice.status === 'Due' && <button aria-label={`Pay ${invoice.id}`} onClick={() => onToast('Payments require retailer payment-provider setup. No payment was taken.', 'info')}><CreditCard/></button>}</span></div>)}
      </div></section>
    </>}
    {selected && <Modal title={selected.id} onClose={() => setSelected(null)} footer={<button className="primary-action" onClick={() => download(selected)}>Download account document</button>}><div className="invoice-preview"><h3>{money(selected.amount)}</h3><p>{selected.period}</p><p>Due: {selected.due ?? 'Not on file'}</p><p>Status: {selected.status}</p><p>For bank transfer, use the verified bank details on your retailer’s issued invoice, with {selected.id} as your reference. Contact Customer Care if details are missing.</p></div></Modal>}
  </>
}
