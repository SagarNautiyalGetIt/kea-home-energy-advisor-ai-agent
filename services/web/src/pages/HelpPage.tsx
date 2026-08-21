import { ChevronDown, CircleHelp, Copy, Mail, Phone, Send } from 'lucide-react'
import { useState } from 'react'

const faqs = [
  ['Why is my usage data delayed?', 'Smart-meter readings can arrive after the day they were recorded. The date shown indicates the latest available reading.'],
  ['How are estimated costs calculated?', 'Estimated costs are calculated from the usage recorded for your account and your applicable energy plan. Your invoice contains the final amount.'],
  ['How do I avoid a high bill?', 'Review peak periods in Usage, compare recent patterns, and ask the AI Assistant for an explanation based on available meter data.'],
]

export default function HelpPage({ onToast }: { onToast:(message:string)=>void }) {
  const [open,setOpen]=useState(0)
  const copy=(value:string,label:string)=>{navigator.clipboard?.writeText(value);onToast(`${label} copied`)}
  return <><div className="page-heading"><h1>Help &amp; Support</h1><p>Find answers or connect with our support team.</p></div><div className="help-grid"><section className="card help-faq"><h2><CircleHelp/>Frequently asked questions</h2>{faqs.map(([question,answer],index)=><article key={question}><button aria-expanded={open===index} onClick={()=>setOpen(open===index?-1:index)}><span>{question}</span><ChevronDown className={open===index?'rotate':''}/></button>{open===index&&<p>{answer}</p>}</article>)}</section><aside className="help-actions"><article className="card"><Phone/><h3>Call Consumer Care</h3><p>Monday to Friday, 9am–5pm</p><div className="contact-actions"><a href="tel:0800000532"><Phone/>Call now</a><button onClick={()=>copy('0800 000 532','Consumer Care number')}><Copy/>Copy</button></div></article><article className="card"><Mail/><h3>Email support</h3><p>Get a response from the support team.</p><div className="contact-actions"><a href="mailto:support@kea-energy.example?subject=Kea%20Energy%20support"><Send/>Write email</a><button onClick={()=>copy('support@kea-energy.example','Support email')}><Copy/>Copy</button></div></article></aside></div></>
}
