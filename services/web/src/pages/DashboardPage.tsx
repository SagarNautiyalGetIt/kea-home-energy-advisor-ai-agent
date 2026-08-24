import { CircleAlert, DollarSign, Zap } from 'lucide-react'
import { useState } from 'react'
import AreaChart from '../components/AreaChart'
import Modal from '../components/Modal'
import { dailyUsage, profile } from '../data/mockData'
import type { PageId } from '../types/navigation'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = ['12am', '4am', '8am', '12pm', '4pm', '8pm', '11pm']
const hourlyUsage = [1.1, 0.7, 1.4, 2.6, 3.9, 5.2, 3.7]
const articles = [
  { title: 'Electricity Repair', date: '16th Aug, 2026', style: 'article-sky', author: 'Chole Bennett', body: 'Planned electrical maintenance helps keep local equipment reliable. Check your network provider for confirmed outage and restoration information.' },
  { title: 'Electricity Cut Off', date: '10th Aug, 2026', style: 'article-orange', author: 'Chole Bennett', body: 'If your power is unexpectedly off, check whether neighbours are affected and consult your local network outage page before reporting a fault.' },
  { title: 'Electricity Plan Discounts', date: '8th Aug, 2026', style: 'article-purple', author: 'Chole Bennett', body: 'Time-of-use plans can reward households that shift flexible electricity use away from peak periods. Review eligibility and full plan terms before switching.' },
  { title: 'New Regulation', date: '1st Aug, 2026', style: 'article-violet', author: 'Ethan Parker', body: 'Clear bills and transparent usage information help customers compare plans and understand how their final charges are calculated.' },
]

export default function DashboardPage({ onNavigate, onToast }: { onNavigate: (page: PageId) => void; onToast: (message: string) => void }) {
  const [selectedArticle, setSelectedArticle] = useState<(typeof articles)[number] | null>(null)
  return <>
    <div className="page-heading"><h1>Dashboard</h1><p className="welcome-customer">Welcome, {profile.name}</p></div>
    <div className="metric-row">
      <article><i><DollarSign/></i><span>Today’s Cost<strong>7.80 NZD</strong></span></article><article><i><Zap/></i><span>Monthly Usage<strong>19.6 kWh</strong></span></article><article><i><DollarSign/></i><span>Total Cost<strong>184.50 NZD</strong></span></article><article><i><DollarSign/></i><span>Projected Monthly Bill<strong>326.40 NZD</strong></span></article>
    </div>
    <div className="dashboard-grid">
      <article className="card usage-summary"><header><div><span>Today’s usage by hour</span><h2>18.60 kWh</h2></div><em>+2.45%<small>vs yesterday</small></em></header><div className="bar-chart">{hourlyUsage.map((value,index)=><span key={hours[index]} style={{height:`${value*18}px`}} tabIndex={0} data-value={`${value.toFixed(1)} kWh`}><small>{hours[index]}</small></span>)}</div></article>
      <article className="card weekly-summary"><header><div><span>Weekly usage</span><h2>65.80 kWh</h2></div><em>+4.45%<small>vs last week</small></em></header><AreaChart compact values={dailyUsage} labels={days} max={6}/></article>
      <article className="card shock-card"><h3><CircleAlert/>Power Bill Shock Warning</h3><p>Kea has detected higher usage mid-cycle. Your projected monthly bill is 29% higher than your usual range.</p><p>View Usage or ask AI Assistant to explain the main drivers before the bill lands.</p><div><button onClick={()=>onNavigate('usage')}>View Usage</button><button onClick={()=>onNavigate('assistant')}>Ask AI Assistant</button></div></article>
    </div>
    <div className="article-grid">{articles.map((article)=><article className="article-card" key={article.title}><div className={`article-art ${article.style}`}><span/></div><h3>{article.title}</h3><p>By {article.author}</p><footer><small>Posted: {article.date}</small><button onClick={()=>{setSelectedArticle(article);onToast(`${article.title} opened`)}}>View</button></footer></article>)}</div>
    {selectedArticle&&<Modal title={selectedArticle.title} onClose={()=>setSelectedArticle(null)}><div className={`article-modal-art ${selectedArticle.style}`}/><p className="modal-meta">By {selectedArticle.author} · {selectedArticle.date}</p><p>{selectedArticle.body}</p></Modal>}
  </>
}
