import { BellRing, ChevronRight, LockKeyhole, Moon, Palette, ShieldCheck, Sun } from 'lucide-react'
import { useState } from 'react'
import Modal from '../components/Modal'

export default function SettingsPage({ onToast }: { onToast:(message:string)=>void }) {
  const [emailAlerts,setEmailAlerts]=useState(true)
  const [billAlerts,setBillAlerts]=useState(true)
  const [theme,setTheme]=useState(localStorage.getItem('kea-theme')??'light')
  const [privacyOpen,setPrivacyOpen]=useState(false)
  const updateTheme=(next:string)=>{setTheme(next);localStorage.setItem('kea-theme',next);document.documentElement.dataset.theme=next;window.dispatchEvent(new Event('kea-theme-change'));onToast(`${next==='dark'?'Dark':'Light'} theme enabled`)}
  return <><div className="page-heading"><h1>Settings</h1><p>Manage your account preferences and privacy.</p></div><div className="settings-list card">
    <section><div className="settings-section-title"><Palette/><div><h2>Appearance</h2><p>Choose how Kea looks on this device.</p></div></div><div className="theme-options"><button className={theme==='light'?'active':''} onClick={()=>updateTheme('light')}><Sun/>Light</button><button className={theme==='dark'?'active':''} onClick={()=>updateTheme('dark')}><Moon/>Dark</button></div></section>
    <section><div className="settings-section-title"><BellRing/><div><h2>Notifications</h2><p>Control the updates you receive.</p></div></div><label className="setting-row"><span><strong>High-usage alerts</strong><small>Receive an early warning when usage rises.</small></span><input type="checkbox" checked={emailAlerts} onChange={(event)=>setEmailAlerts(event.target.checked)}/></label><label className="setting-row"><span><strong>Bill reminders</strong><small>Receive reminders before a bill is due.</small></span><input type="checkbox" checked={billAlerts} onChange={(event)=>setBillAlerts(event.target.checked)}/></label><button className="primary-action" onClick={()=>onToast('Notification preferences saved')}>Save notification settings</button></section>
    <section><button className="settings-link" onClick={()=>setPrivacyOpen(true)}><ShieldCheck/><span><strong>Privacy and data</strong><small>Review how your account information is used.</small></span><ChevronRight/></button><button className="settings-link" onClick={()=>onToast('Password reset instructions sent')}><LockKeyhole/><span><strong>Password and security</strong><small>Reset your password and protect your account.</small></span><ChevronRight/></button></section>
  </div>{privacyOpen&&<Modal title="Privacy information" onClose={()=>setPrivacyOpen(false)}><p>Kea Energy collects account, contact, usage, billing, and support information to provide your energy service.</p><ul className="guidance-list"><li>You can request access to your personal information.</li><li>You can ask for incorrect details to be corrected.</li><li>Your data is protected using appropriate security controls.</li></ul></Modal>}</>
}
