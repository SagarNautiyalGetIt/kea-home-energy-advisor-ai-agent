import { DollarSign, Triangle, Zap } from 'lucide-react'
import { useState } from 'react'
import AreaChart from '../components/AreaChart'
import Modal from '../components/Modal'
import { dailyUsage, profile } from '../data/mockData'
import type { PageId } from '../types/navigation'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekDates = ['17 Aug', '18 Aug', '19 Aug', '20 Aug', '21 Aug', '22 Aug', '23 Aug']
const weekTooltipLabels = ['Monday, 17 August 2026', 'Tuesday, 18 August 2026', 'Wednesday, 19 August 2026', 'Thursday, 20 August 2026', 'Friday, 21 August 2026', 'Saturday, 22 August 2026', 'Sunday, 23 August 2026']
const formatHour = (hour: number, compact = false) => {
  const period = hour < 12 ? 'am' : 'pm'
  const displayHour = hour % 12 || 12
  return `${displayHour}${compact ? period[0] : period}`
}
const hours = Array.from({ length: 24 }, (_, hour) => formatHour(hour))
const hourlyUsage = [0.32, 0.27, 0.21, 0.19, 0.18, 0.21, 0.32, 0.48, 0.58, 0.64, 0.69, 0.74, 0.8, 0.85, 0.9, 0.96, 1.06, 1.17, 1.33, 1.49, 1.59, 1.43, 1.17, 1.02]
const articles = [
  {
    title: 'New Consumer Protection Standards',
    date: '24 Aug 2026',
    image: '/assets/news/consumer-protection-policy.jpg',
    imageAlt: 'Policy document and shield representing new consumer protections',
    body: 'New consumer care standards are being introduced to make electricity information clearer and support easier to access. Kea Energy is updating customer communications and support processes to reflect the new requirements.',
  },
  {
    title: 'Off-Peak Discount Coming Soon',
    date: '21 Aug 2026',
    image: '/assets/news/off-peak-discount.jpg',
    imageAlt: 'Clock and electricity symbols representing an off-peak discount',
    body: 'Kea Energy is preparing a new off-peak discount for eligible customers who can shift flexible electricity use away from busy periods. Full eligibility, timing and plan terms will be shared before launch.',
  },
  {
    title: 'Winter Energy Support Available',
    date: '18 Aug 2026',
    image: '/assets/news/winter-energy-support.jpg',
    imageAlt: 'Warm energy-efficient home representing winter support',
    body: 'Our winter support programme offers practical energy-saving guidance and account assistance to customers who need extra help during colder months. Contact Consumer Care to learn about available support.',
  },
  {
    title: 'Planned Network Maintenance',
    date: '15 Aug 2026',
    image: '/assets/news/network-maintenance.jpg',
    imageAlt: 'Power lines and maintenance equipment representing planned network work',
    body: 'Planned network maintenance will take place in selected areas this weekend. Customers affected by an interruption will receive advance notice with timing and restoration information.',
  },
]

export default function DashboardPage({ onNavigate, onToast }: { onNavigate: (page: PageId) => void; onToast: (message: string) => void }) {
  const [selectedArticle, setSelectedArticle] = useState<(typeof articles)[number] | null>(null)
  return <>
    <div className="page-heading"><h1>Dashboard</h1><p className="welcome-customer">Welcome, {profile.name}</p></div>
    <div className="metric-row">
      <article><i><DollarSign/></i><span>Today’s Cost<strong>7.80 NZD</strong></span></article><article><i><Zap/></i><span>Monthly Usage<strong>19.6 kWh</strong></span></article><article><i><DollarSign/></i><span>Total Cost<strong>184.50 NZD</strong></span></article><article><i><DollarSign/></i><span>Projected Period Bill<strong>326.40 NZD</strong></span></article>
    </div>
    <div className="dashboard-grid">
      <article className="card usage-summary">
        <header>
          <div><span>Today’s usage by hour</span><h2>18.60 kWh</h2></div>
          <em><span className="trend-up"><Triangle aria-hidden="true"/>+2.45%</span><small>vs yesterday</small></em>
        </header>
        <AreaChart compact animate values={hourlyUsage} labels={hours} max={2} xLabelInterval={3} showLegend={false} ariaLabel="Today’s electricity usage in one-hour intervals, measured in kilowatt-hours"/>
      </article>
      <article className="card weekly-summary"><header><div><span>Weekly usage</span><h2>65.80 kWh</h2></div><em><span className="trend-down"><Triangle aria-hidden="true"/>-0.45%</span><small>vs last week</small></em></header><AreaChart compact animate values={dailyUsage} labels={days} secondaryLabels={weekDates} tooltipLabels={weekTooltipLabels} max={6} showLegend={false} ariaLabel="Daily electricity usage for 17 to 23 August 2026, measured in kilowatt-hours"/></article>
      <article className="card shock-card"><h3><span className="bill-status-dot bill-status-dot-alert" aria-hidden="true"/>{/* Future normal state: replace bill-status-dot-alert with bill-status-dot-normal. */}Power Bill Shock Warning</h3><p>Kea has detected higher usage mid-cycle. Your projected monthly bill is 29% higher than your usual range.</p><p>View Usage or ask AI Assistant to explain the main drivers before the bill lands.</p><div><button onClick={()=>onNavigate('usage')}>View Usage</button><button onClick={()=>onNavigate('assistant')}>Ask AI Assistant</button></div></article>
    </div>
    <section className="article-grid" aria-label="Kea Energy news">{articles.map((article)=><article className="article-card" key={article.title}><div className="article-art"><img src={article.image} alt={article.imageAlt} loading="lazy" decoding="async"/></div><h3>{article.title}</h3><footer><small>{article.date}</small><button onClick={()=>{setSelectedArticle(article);onToast(`${article.title} opened`)}}>View</button></footer></article>)}</section>
    {selectedArticle&&<Modal title={selectedArticle.title} onClose={()=>setSelectedArticle(null)}><img className="article-modal-art" src={selectedArticle.image} alt={selectedArticle.imageAlt}/><p className="modal-meta">{selectedArticle.date}</p><p>{selectedArticle.body}</p></Modal>}
  </>
}
