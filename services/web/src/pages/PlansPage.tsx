import { Bot, Check, Star } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import { plans } from '../data/mockData'

type Plan = (typeof plans)[number]

export default function PlansPage({ onToast }: { onToast:(message:string,tone?:'success'|'info'|'warning')=>void }) {
  const navigate=useNavigate()
  const [selected,setSelected]=useState<Plan|null>(null)
  const [chosenPlan,setChosenPlan]=useState<string>('')
  const [termsPlan,setTermsPlan]=useState<Plan|null>(null)
  const askAi=()=>{if(!chosenPlan){onToast('Choose a plan first to ask AI about it','warning');return}localStorage.setItem('kea-ai-plan-question',chosenPlan);navigate('/assistant')}
  return <>
    <div className="page-heading plans-heading"><div><h1>Plans</h1><p>Explore plan benefits and choose the one that matches your routine.</p></div><button className="compare-action" onClick={askAi}><Bot/>Ask AI about the plan</button></div>
    <div className="plans-grid">{plans.map((plan,index)=><article className={`plan-card card ${index===0?'current-plan':''} ${chosenPlan===plan.name?'selected-plan':''}`} key={plan.name}>
      {index===0?<span className="plan-badge current"><Check/>CURRENT PLAN</span>:index===1?<span className="plan-badge"><Star/>RECOMMENDED</span>:<span className="plan-badge">GOOD PLAN</span>}
      <label className="plan-compare"><input type="radio" name="ai-plan" checked={chosenPlan===plan.name} onChange={()=>setChosenPlan(plan.name)}/><span>Select</span></label>
      <h2>{plan.name}</h2><h3>{plan.offer}</h3><small>{plan.cadence}</small><ul>{plan.highlights.map((item)=><li key={item}>{item}</li>)}</ul><h4>Best for</h4><ul>{plan.best.map((item)=><li key={item}>{item}</li>)}</ul><h4>Additional features</h4><ul><li>Track usage across the billing cycle</li><li>Access digital bills and account support</li><li>Receive high-usage notifications</li></ul>
      <p className="plan-links"><button onClick={()=>setTermsPlan(plan)}>Terms &amp; Conditions</button></p><button onClick={()=>setSelected(plan)}>{index===0?'View plan':'View pricing'}</button>
    </article>)}</div>
    {selected&&<Modal title={`${selected.name} pricing`} wide onClose={()=>setSelected(null)} footer={<><button className="secondary-action" onClick={()=>setSelected(null)}>Close</button><button className="primary-action" onClick={()=>{setSelected(null);onToast(`${selected.name} interest saved`)}}>Choose this plan</button></>}><div className="plan-detail"><div className="plan-price"><span>Usage rate</span><strong>30c</strong><small>per kWh</small></div><div><h3>{selected.offer}</h3><p>{selected.cadence}</p><ul>{selected.highlights.map((item)=><li key={item}><Check/>{item}</li>)}</ul></div></div></Modal>}
    {termsPlan&&<Modal title={`${termsPlan.name} Terms & Conditions`} wide onClose={()=>setTermsPlan(null)} footer={<button className="primary-action" onClick={()=>setTermsPlan(null)}>Done</button>}><div className="terms-content"><p>These terms explain eligibility, billing, plan benefits, and how offers apply to your account.</p><h3>Plan benefits</h3><ul>{termsPlan.highlights.map((item)=><li key={item}>{item}</li>)}</ul><h3>Important conditions</h3><ul><li>Your account must remain active and payments must be made by the due date.</li><li>Plan benefits apply only during the advertised times and periods.</li><li>You can request a plan change through Consumer Care.</li></ul></div></Modal>}
  </>
}
