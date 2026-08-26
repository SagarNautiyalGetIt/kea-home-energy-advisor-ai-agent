import { ArrowUp, Camera, FileText, Image, LoaderCircle, MessageSquare, MessageSquarePlus, Mic, Paperclip, Pencil, X } from 'lucide-react'
import { useRef, useState } from 'react'
import Modal from '../components/Modal'

type PromptId = 'high-bill' | 'peak-time' | 'plan'
type Message = { id:number; role:'user'|'assistant'; content:React.ReactNode; editableText?:string }
// Temporarily hide the page description while preserving it for a future restore.
const SHOW_ASSISTANT_DESCRIPTION = false
const prompts: Array<{id:PromptId;label:string}> = [{id:'high-bill',label:'Why is my power bill so high?'},{id:'peak-time',label:'When am I using the most electricity?'},{id:'plan',label:'Could another plan save me money?'}]
const responses: Record<PromptId,React.ReactNode> = {
  'high-bill': <><p>Your projected bill is $326.40, around 29% higher than your usual range. The increase appears to come from three recent patterns.</p><ol><li><strong>Overnight base load:</strong> usage between midnight and 6 AM increased.</li><li><strong>Saturday spike:</strong> usage reached 17.6 kWh.</li><li><strong>Colder evenings:</strong> evening consumption rose during colder weather.</li></ol><p>Half-hourly data cannot reliably identify a specific appliance.</p></>,
  'peak-time': <><p>Your highest recent usage window is <strong>7:00 PM–9:00 PM</strong>. Friday is the highest-usage day in the current weekly view.</p><p>You can review the supporting detail on the Usage page.</p></>,
  plan: <><p>Based on your recent usage, another Kea plan may suit your routine better.</p><p>Open Plans to review the benefits and eligibility, or select a plan and ask me about it.</p></>,
}

export default function AssistantPage({ onEscalate, onToast }: { onEscalate:()=>void; onToast:(message:string,tone?:'success'|'info'|'warning')=>void }) {
  const [planContext]=useState(()=>{const plan=localStorage.getItem('kea-ai-plan-question');localStorage.removeItem('kea-ai-plan-question');return plan})
  const nextId=useRef(planContext?4:2)
  const initial:Message[]=[{id:1,role:'assistant',content:'Hello! I’m Kea. Ask me about your bill, usage, or energy plan.'}]
  const [messages,setMessages]=useState<Message[]>(()=>planContext?[...initial,{id:2,role:'user',content:`Tell me about the ${planContext} plan`,editableText:`Tell me about the ${planContext} plan`},{id:3,role:'assistant',content:<p>I can help you understand the <strong>{planContext}</strong> plan, including its benefits, suitable usage patterns, and important conditions. What would you like to know?</p>}]:initial)
  const [started,setStarted]=useState(Boolean(planContext))
  const [message,setMessage]=useState('')
  const [thinking,setThinking]=useState(false)
  const [listening,setListening]=useState(false)
  const [termsOpen,setTermsOpen]=useState(false)
  const [attachOpen,setAttachOpen]=useState(false)
  const [editingId,setEditingId]=useState<number|null>(null)
  const [editText,setEditText]=useState('')
  const fileInput=useRef<HTMLInputElement>(null)
  const photoInput=useRef<HTMLInputElement>(null)
  const addResponse=(content:React.ReactNode)=>{setThinking(true);window.setTimeout(()=>{setMessages((current)=>[...current,{id:nextId.current++,role:'assistant',content}]);setThinking(false)},650)}
  const sendText=(value:string)=>{setStarted(true);setMessages((current)=>[...current,{id:nextId.current++,role:'user',content:value,editableText:value}]);addResponse(<p>I’ve received your question. I can help explain your account, billing, usage patterns, or plan options.</p>)}
  const submit=()=>{const value=message.trim();if(!value)return;setMessage('');sendText(value)}
  const selectPrompt=(id:PromptId)=>{const prompt=prompts.find((item)=>item.id===id)!;setStarted(true);setMessages((current)=>[...current,{id:nextId.current++,role:'user',content:prompt.label,editableText:prompt.label}]);addResponse(responses[id])}
  const newChat=()=>{setMessages(initial);setStarted(false);setMessage('');setEditingId(null);onToast('New chat started','info')}
  const attach=(file?:File)=>{if(!file)return;setAttachOpen(false);setStarted(true);setMessages((current)=>[...current,{id:nextId.current++,role:'user',content:`Attached: ${file.name}`}]);addResponse(<p>Your attachment is ready. Tell me what you would like to understand from it.</p>);onToast(`${file.name} attached`)}
  const saveEdit=(id:number)=>{const value=editText.trim();if(!value)return;setMessages((items)=>items.map((item)=>item.id===id?{...item,content:value,editableText:value}:item));setEditingId(null);onToast('Message updated','info')}
  return <div className="assistant-page">
    <div className="page-heading assistant-heading"><div><h1>AI Assistant</h1>{SHOW_ASSISTANT_DESCRIPTION&&<p>Your personalised guide to electricity usage, bills and plans.</p>}<button className="new-chat-action" onClick={newChat}><MessageSquarePlus/>New chat</button></div></div>
    <div className="assistant-conversation">
      {started?<div className="chat-thread" aria-live="polite">{messages.map((item)=><div className={`message-row ${item.role}`} key={item.id}><div className={`bubble ${item.role==='assistant'?'assistant-bubble':'user-bubble'} ${typeof item.content==='string'?'':'long'}`}>{editingId===item.id?<div className="edit-message"><textarea value={editText} onChange={(event)=>setEditText(event.target.value)}/><span><button onClick={()=>setEditingId(null)}>Cancel</button><button onClick={()=>saveEdit(item.id)}>Save</button></span></div>:item.content}</div>{item.role==='user'&&item.editableText&&editingId!==item.id&&<button className="edit-chat-button" aria-label="Edit message" onClick={()=>{setEditingId(item.id);setEditText(item.editableText!)}}><Pencil/></button>}</div>)}{thinking&&<div className="bubble assistant-bubble thinking"><LoaderCircle/>Kea is preparing a response…</div>}</div>:<div className="assistant-start"><div className="assistant-orb"><img src="/assets/assistant/ai-logo.svg" alt="" /></div><h2>How can I help you today?</h2>{/* Assistant subtitle retained for future use: "Get clear answers about bills, usage patterns, and plans." */}<div className="prompt-grid">{prompts.map((prompt)=><button key={prompt.id} onClick={()=>selectPrompt(prompt.id)}><MessageSquare/><span>{prompt.label}</span></button>)}</div></div>}
    </div>
    <div className="composer-area"><div className={`chat-composer ${listening?'listening':''}`}>
      <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.doc,.docx,.txt,.csv" onChange={(event)=>attach(event.target.files?.[0])}/><input ref={photoInput} className="sr-only" type="file" accept="image/*" onChange={(event)=>attach(event.target.files?.[0])}/>
      <div className="attachment-control"><button aria-label="Add attachment" aria-expanded={attachOpen} onClick={()=>setAttachOpen((open)=>!open)}>{attachOpen?<X/>:<Paperclip/>}</button>{attachOpen&&<div className="attachment-menu"><button onClick={()=>fileInput.current?.click()}><FileText/><span><strong>Upload document</strong><small>PDF, Word, text, or CSV</small></span></button><button onClick={()=>photoInput.current?.click()}><Image/><span><strong>Upload photo</strong><small>JPG, PNG, or image files</small></span></button><button onClick={()=>{setAttachOpen(false);onToast('Camera access is not available on this device','info')}}><Camera/><span><strong>Take a photo</strong><small>Use your device camera</small></span></button></div>}</div>
      <textarea rows={1} value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit()}}} placeholder={listening?'Listening…':'Message Kea'}/><button aria-label={listening?'Stop voice capture':'Start voice capture'} aria-pressed={listening} onClick={()=>{setListening((value)=>!value);onToast(listening?'Voice capture stopped':'Voice capture started','info')}}><Mic/></button><button className="send-button" aria-label="Send message" disabled={thinking||!message.trim()} onClick={submit}><ArrowUp/></button>
    </div><div className="chat-footer">Kea can make mistakes. <button onClick={()=>setTermsOpen(true)}>Check Terms &amp; Conditions</button> · <button onClick={onEscalate}>Talk to a human</button></div></div>
    {termsOpen&&<Modal title="AI Assistant terms" onClose={()=>setTermsOpen(false)}><p>Kea provides general explanations based on available account information. Review final charges on your invoice and contact Consumer Care when you need personal support.</p><p>Kea does not identify individual appliances from half-hourly meter data.</p></Modal>}
  </div>
}
