import { BellRing, ChevronRight, LockKeyhole, Moon, Palette, Radar, ShieldHalf, Sun } from 'lucide-react'
import { useState } from 'react'
import BillShockThresholds from '../components/BillShockThresholds'
import Modal from '../components/Modal'
import SmartDeviceScanner from '../components/SmartDeviceScanner'
import { profile } from '../data/mockData'
import { loadSession } from '../lib/session'

export default function SettingsPage({ onToast }: { onToast:(message:string)=>void }) {
  const session = loadSession()
  const [billAlerts,setBillAlerts]=useState(true)
  const [theme,setTheme]=useState(localStorage.getItem('kea-theme')??'light')
  const [privacyOpen,setPrivacyOpen]=useState(false)
  const [passwordOpen,setPasswordOpen]=useState(false)
  const updateTheme=(next:string)=>{setTheme(next);localStorage.setItem('kea-theme',next);document.documentElement.dataset.theme=next;window.dispatchEvent(new Event('kea-theme-change'));onToast(`${next==='dark'?'Dark':'Light'} theme enabled`)}
  return <><div className="page-heading"><h1>Settings</h1><p className="settings-description">Manage your account preferences and privacy.</p></div><div className="settings-list card">
    <section><div className="settings-section-title"><Palette/><div><h2>Appearance</h2><p>Choose how Kea Energy looks on this device.</p></div></div><div className="theme-options"><button className={theme==='light'?'active':''} onClick={()=>updateTheme('light')}><Sun/>Light</button><button className={theme==='dark'?'active':''} onClick={()=>updateTheme('dark')}><Moon/>Dark</button></div></section>
    <section><div className="settings-section-title"><BellRing/><div><h2>Bill-shock alerts</h2><p>You choose how far over your bill has to be tracking before we get in touch, and how.</p></div></div>
      {/* The one control on this screen backed by the server rather than local state.
          A threshold that only lives in the browser is a promise the alerting engine
          never hears — the previous two switches here were exactly that. */}
      {session
        ? <BillShockThresholds customerId={session.customerId} onToast={onToast}/>
        : <p className="settings-loading">Sign in to set your alert levels.</p>}
      <label className="setting-row"><span><strong>Bill reminders</strong><small>Receive reminders before a bill is due.</small></span><input type="checkbox" checked={billAlerts} onChange={(event)=>setBillAlerts(event.target.checked)}/></label></section>
    {/* Under Settings rather than on the dashboard because it is a setup step, and
        because it puts traffic on the customer's network — that belongs behind an
        explicit click on a screen they went looking for, not on a page that loads. */}
    <section><div className="settings-section-title"><Radar/><div><h2>Connected home</h2><p>Find the smart devices on your network, so your bill explanation can name them.</p></div></div>
      <SmartDeviceScanner onToast={onToast}/></section>
    <section><div className="settings-section-title"><ShieldHalf/><div><h2>Account security</h2><p>Review your data and keep your account protected.</p></div></div><button className="settings-link" onClick={()=>setPrivacyOpen(true)}><span><strong>Privacy and data</strong><small>Review how your account information is used.</small></span><ChevronRight/></button><button className="settings-link" onClick={()=>setPasswordOpen(true)}><span><strong>Password and security</strong><small>Reset your password and protect your account.</small></span><ChevronRight/></button></section>
  </div>{privacyOpen&&<Modal title="Privacy information" onClose={()=>setPrivacyOpen(false)} footer={<button className="primary-action" onClick={()=>setPrivacyOpen(false)}>Done</button>}><div className="terms-content"><p>Kea Energy collects account, contact, usage, billing and support information to provide your energy service.</p><h3>Your rights</h3><ul><li>You can request access to your personal information.</li><li>You can ask for incorrect details to be corrected.</li><li>Your data is protected using appropriate security controls.</li></ul></div></Modal>}{passwordOpen&&<Modal title="Reset password" onClose={()=>setPasswordOpen(false)} footer={<><button className="secondary-action" onClick={()=>setPasswordOpen(false)}>Cancel</button><button className="primary-action" onClick={()=>{setPasswordOpen(false);onToast('Password reset instructions sent')}}><LockKeyhole/>Send reset link</button></>}><div className="payment-confirm"><LockKeyhole/><p>Send a secure reset link to <strong>{profile.email}</strong>?</p><small>The link expires 30 minutes after it is sent. Your current password keeps working until you use it.</small></div></Modal>}</>
}
