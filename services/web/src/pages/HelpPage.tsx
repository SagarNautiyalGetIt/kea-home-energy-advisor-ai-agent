import { ChevronDown, CircleHelp, Mail, MessagesSquare, Phone, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type CategoryId = 'about' | 'bills' | 'accuracy' | 'privacy'

// Order follows the source FAQ document: what Sparky is (Q1-4), how far to trust it
// (Q5-6), the features themselves (Q7-12), then privacy and human support (Q13-15).
const categories: Array<{ id: CategoryId; label: string }> = [
  { id: 'about', label: 'About Sparky' },
  { id: 'accuracy', label: 'Accuracy and limits' },
  { id: 'bills', label: 'Bills, warnings and plans' },
  { id: 'privacy', label: 'Privacy and support' },
]

const faqs: Array<{ category: CategoryId; question: string; answer: string; note?: string }> = [
  {
    category: 'about',
    question: 'What is Sparky AI?',
    answer: 'Sparky is Kea Energy’s digital AI assistant that helps you understand your electricity usage, bills and plan options. It turns complex energy information into clear explanations and provides early warnings about possible high bills. Human support is not connected in this demo.',
  },
  {
    category: 'about',
    question: 'What can Sparky help me with?',
    answer: 'Sparky can explain changes in your electricity bill, warn you when your projected bill is higher than expected, compare Kea plans using your usage pattern and answer general questions about your energy account. For human help, use verified contact details on your electricity bill.',
  },
  {
    category: 'about',
    question: 'How does Sparky work?',
    answer: 'Sparky understands your question and requests information from approved accounts, usage and pricing services. These services perform important calculations, while Sparky explains the results in straightforward language. Sparky is not allowed to create its own bill amounts, projections or savings figures.',
  },
  {
    category: 'about',
    question: 'What information does Sparky use?',
    answer: 'Depending on your question, Sparky may use your electricity usage, billing history, current plan, alert preferences and information you choose to upload. It only uses the information needed to answer your request. The current prototype uses synthetic demonstration data rather than real customer accounts.',
  },
  {
    category: 'bills',
    question: 'How does the Bill Explainer work?',
    answer: 'The Bill Explainer reads the information in your electricity bill and compares it with available usage and pricing data. It identifies the charges, days and time periods that contributed most to the total, then explains them in plain language. It will not claim that a particular appliance caused an increase unless supporting data is available.',
  },
  {
    category: 'bills',
    question: 'What can I upload to the Bill Explainer?',
    answer: 'You can upload an electricity bill as a PDF, JPG or PNG file, including a clear photo or screenshot. Make sure the full bill is readable and avoid uploading unrelated documents or information that is not needed for the explanation.',
  },
  {
    category: 'bills',
    question: 'What is a bill-shock warning?',
    answer: 'A bill-shock warning is an early notification that your projected bill has crossed your selected dollar threshold or is significantly higher than your normal pattern. It gives you an opportunity to review what changed and take action before the billing period ends.',
  },
  {
    category: 'bills',
    question: 'How often will Kea send warnings?',
    answer: 'Kea sends an initial warning when your projected bill crosses the threshold you selected. It will not repeatedly send the same alert, but it may send another warning if the projection increases significantly. You can change your threshold, notification channel or opt out of warnings at any time.',
  },
  {
    category: 'bills',
    question: 'Is my projected bill the same as my final bill?',
    answer: 'No. A projected bill is an estimate based on your usage so far, expected usage for the rest of the billing period and your current pricing information. Your final bill may differ if your usage changes, additional meter information becomes available or adjustments are applied.',
  },
  {
    category: 'bills',
    question: 'How does Kea compare plans?',
    answer: 'Kea applies each available Kea plan to your usage pattern and calculates the estimated cost, including usage rates, daily charges, free-power periods, monthly credits, commitment length and possible exit fees. It may recommend staying on your current plan if changing would not provide a meaningful benefit.',
    note: 'Kea does not compare every electricity provider in New Zealand, only the big four energy providers.',
  },
  {
    category: 'accuracy',
    question: 'Where do Sparky’s numbers come from?',
    answer: 'From your own meter readings and account records. Bill amounts, projections and plan comparisons are worked out by Kea’s own systems using set pricing rules, and Sparky explains the result. Each answer lists what Sparky looked up, so you can see what it read before it replied.',
    note: 'Projections and comparisons are estimates. Your issued bill is the record of what you owe.',
  },
  {
    category: 'accuracy',
    question: 'Can Sparky make mistakes?',
    answer: 'Yes. Like any AI assistant, Sparky can misread a question or give an incomplete answer, so please don’t treat its replies as financial advice or as a final decision on your account. It is built to say when it isn’t sure rather than guess. If an answer looks wrong, use your provider’s verified support details on your bill.',
  },
  {
    category: 'privacy',
    question: 'How does Kea protect my information?',
    answer: 'Kea uses authentication, encryption and access controls to protect customer information. The system is designed to use only the data needed for each request and prevent customers from accessing another person’s account. Sensitive account details are not disclosed until the customer’s identity has been verified.',
  },
  {
    category: 'privacy',
    question: 'Are my conversations with Sparky stored?',
    answer: 'Conversations may be stored securely for a limited period to provide the service, maintain an audit record, investigate problems and improve safety and quality. Access is restricted to authorised systems and staff. Kea does not use your private account conversations to train a publicly available AI model.',
  },
  {
    category: 'privacy',
    question: 'Can I speak to a real person?',
    answer: 'Sparky may suggest speaking with a person when a question needs human support. This demo records a review reason but does not send your conversation to staff. Use the verified support details on your electricity bill to contact your provider directly.',
  },
]

export default function HelpPage() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(faqs[0]?.question ?? '')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryId | 'all'>('all')

  const search = query.trim().toLowerCase()
  const visible = faqs.filter((faq) =>
    (category === 'all' || faq.category === category) &&
    (!search || `${faq.question} ${faq.answer} ${faq.note ?? ''}`.toLowerCase().includes(search)))
  const groups = categories
    .map((group) => ({ ...group, items: visible.filter((faq) => faq.category === group.id) }))
    .filter((group) => group.items.length > 0)

  return <>
    <div className="page-heading"><h1>Help &amp; Support</h1><p className="help-description">Find answers and learn where to get verified human support.</p></div>
    <div className="help-grid">
      <section className="card help-faq">
        <h2><CircleHelp/>Frequently asked questions</h2>
        <div className="faq-tools">
          <label className="faq-search">
            <Search aria-hidden="true"/>
            <input type="search" value={query} placeholder="Search help topics" aria-label="Search frequently asked questions" onChange={(event)=>setQuery(event.target.value)}/>
          </label>
          <div className="faq-chips" role="group" aria-label="Filter by topic">
            <button className={category === 'all' ? 'active' : ''} onClick={()=>setCategory('all')}>All<span>{faqs.length}</span></button>
            {categories.map((group) => (
              <button key={group.id} className={category === group.id ? 'active' : ''} onClick={()=>setCategory(group.id)}>
                {group.label}<span>{faqs.filter((faq)=>faq.category===group.id).length}</span>
              </button>
            ))}
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="faq-empty">
            <p>No help topics match “{query}”.</p>
            <button className="primary-action" onClick={()=>navigate('/assistant')}><MessagesSquare/>Ask Sparky instead</button>
          </div>
        ) : groups.map((group) => (
          <section className="faq-group" key={group.id}>
            <h3>{group.label}</h3>
            {group.items.map((faq) => (
              <article key={faq.question}>
                <button aria-expanded={open === faq.question} onClick={()=>setOpen(open === faq.question ? '' : faq.question)}>
                  <span>{faq.question}</span><ChevronDown className={open === faq.question ? 'rotate' : ''}/>
                </button>
                {open === faq.question && <p>{faq.answer}</p>}
                {open === faq.question && faq.note && <p className="faq-note">{faq.note}</p>}
              </article>
            ))}
          </section>
        ))}
      </section>

      <aside className="help-actions">
        <article className="card">
          <MessagesSquare/>
          <h3>Ask Sparky AI</h3>
          <p>Get an instant answer about your own usage, bill or plan.</p>
          <div className="contact-actions"><button className="contact-primary" onClick={()=>navigate('/assistant')}><MessagesSquare/>Ask Sparky</button></div>
        </article>
        <article className="card">
          <Phone/>
          <h3>Speak with a person</h3>
          <p>Human support is not connected in this demo. No request has been sent. Use the verified support number on your electricity bill.</p>
        </article>
        <article className="card">
          <Mail/>
          <h3>Email support</h3>
          <p>Use the verified support email on your electricity bill. This demo does not send messages to a support team.</p>
        </article>
      </aside>
    </div>
  </>
}
