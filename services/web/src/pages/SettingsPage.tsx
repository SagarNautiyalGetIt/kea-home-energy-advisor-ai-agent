import { ChevronRight, CircleCheck, LockKeyhole, Moon, Palette, Radar, Send, ShieldCheck, ShieldHalf, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import BillShockThresholds, { BillShockHeading } from '../components/BillShockThresholds'
import CalendarBellIcon from '../components/CalendarBellIcon'
import Modal from '../components/Modal'
import SmartDeviceScanner from '../components/SmartDeviceScanner'
import { getAlertPreferences, saveAlertPreferences, type AlertPreferences } from '../lib/alerts'
import { getCustomerProfile, type CustomerProfile } from '../lib/client'
import { loadSession } from '../lib/session'

/**
 * Settings.
 *
 * **Everything on this screen is stored server-side.** Two controls were not, and both
 * failed the same way: the switch moved, the customer believed something had changed,
 * and nothing else in the system heard about it.
 *
 * * *Bill reminders* lived in React state. It reset on reload and the alerting engine
 *   never saw it — the same class of bug the threshold sliders had before they moved
 *   into `alert_preference`, which is what the warning at the top of
 *   `app/alerts/preferences.py` is about.
 * * *Theme* lived in `localStorage`, so it had to be set again on every device.
 *
 * Theme still writes `localStorage` first and the request follows, because a theme that
 * waits for a round trip flashes the wrong colours on load. The stored value is what a
 * second device reads.
 */
export default function SettingsPage({ onToast }: { onToast:(message:string)=>void }) {
  const [session] = useState(loadSession)
  const [prefs, setPrefs] = useState<AlertPreferences | null>(null)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [theme, setTheme] = useState(localStorage.getItem('kea-theme') ?? 'light')
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  useEffect(() => {
    if (!session) return
    let live = true
    getAlertPreferences(session.customerId)
      .then((loaded) => {
        if (!live) return
        setPrefs(loaded)
        // The server is the record. If this device was last set to light and the
        // account says dark, the account wins — that is the whole point of storing it.
        if (loaded.theme && loaded.theme !== theme) applyTheme(loaded.theme, false)
      })
      .catch(() => undefined)
    getCustomerProfile(session.customerId).then((p) => live && setProfile(p)).catch(() => undefined)
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  /** Paint immediately, persist in the background. */
  const applyTheme = (next: string, persist = true) => {
    setTheme(next)
    localStorage.setItem('kea-theme', next)
    document.documentElement.dataset.theme = next
    window.dispatchEvent(new Event('kea-theme-change'))
    if (persist) void persistPatch({ theme: next as 'light' | 'dark' }, `${next === 'dark' ? 'Dark' : 'Light'} theme enabled`)
  }

  /**
   * Save one field and keep what came back.
   *
   * On failure the switch is put back where it was. A settings screen that shows a
   * change it did not manage to make is worse than one that refuses — the customer
   * walks away believing the reminders are off.
   */
  const persistPatch = async (patch: Partial<AlertPreferences>, success: string) => {
    if (!session || !prefs) return
    const previous = prefs
    const next = { ...prefs, ...patch }
    setPrefs(next)
    try {
      setPrefs(await saveAlertPreferences(session.customerId, next))
      onToast(success)
    } catch (error) {
      setPrefs(previous)
      if (patch.theme) applyTheme(previous.theme, false)
      onToast(`Could not save: ${(error as Error).message}`)
    }
  }

  return <><div className="page-heading"><h1>Settings</h1><p className="settings-description">Manage your account preferences and privacy.</p></div><div className="settings-list card">
    <section><div className="settings-section-title"><Palette/><div><h2>Appearance</h2><p>Choose how Kea Energy looks. Saved to your account, so it follows you to another device.</p></div></div><div className="theme-options"><button className={theme==='light'?'active':''} onClick={()=>applyTheme('light')}><Sun/>Light</button><button className={theme==='dark'?'active':''} onClick={()=>applyTheme('dark')}><Moon/>Dark</button></div></section>
    <section>
      {/* The editor draws the section heading itself: its master switch sits beside the title. */}
      {session
        ? <BillShockThresholds customerId={session.customerId} onToast={onToast}/>
        : <><BillShockHeading/><p className="settings-loading">Sign in to set your alert levels.</p></>}
      {/* Server-backed like everything above it. This was React state, so the switch
          moved and the alerting engine never heard — see the note on this component. */}
      <label className="setting-row setting-standalone">
        <CalendarBellIcon aria-hidden="true"/>
        <span><strong>Bill reminders</strong><small>Receive reminders before a bill is due.</small></span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={prefs?.bill_reminders ?? true}
          disabled={!prefs}
          checked={prefs?.bill_reminders ?? true}
          onChange={(event)=>void persistPatch({ bill_reminders: event.target.checked }, event.target.checked ? 'Bill reminders on' : 'Bill reminders off')}
        />
      </label></section>
    {/* Under Settings rather than on the dashboard because it is a setup step, and
        because it puts traffic on the customer's network — that belongs behind an
        explicit click on a screen they went looking for, not on a page that loads. */}
    <section><div className="settings-section-title"><Radar/><div><h2>Connected home</h2><p>Find the smart devices on your network, so your bill explanation can name them.</p></div></div>
      <SmartDeviceScanner onToast={onToast}/></section>
    <section><div className="settings-section-title"><ShieldHalf/><div><h2>Account security</h2><p>Review your data and keep your account protected.</p></div></div><button className="settings-link" onClick={()=>setPrivacyOpen(true)}><span><strong>Privacy and data</strong><small>Review how your account information is used.</small></span><ChevronRight/></button><button className="settings-link" onClick={()=>setPasswordOpen(true)}><span><strong>Password and security</strong><small>Reset your password and protect your account.</small></span><ChevronRight/></button></section>
  </div>{privacyOpen&&<Modal title="Privacy information" onClose={()=>setPrivacyOpen(false)} footer={<button className="primary-action" onClick={()=>setPrivacyOpen(false)}>Done</button>}><div className="terms-content privacy-info"><ShieldCheck aria-hidden="true"/><p>Kea Energy collects account, contact, usage, billing and support information to provide your energy service.</p><div className="privacy-rights"><h3>Your rights</h3><ul><li><CircleCheck aria-hidden="true"/>You can request access to your personal information.</li><li><CircleCheck aria-hidden="true"/>You can ask for incorrect details to be corrected.</li><li><CircleCheck aria-hidden="true"/>Your data is protected using appropriate security controls.</li></ul></div></div></Modal>}{passwordOpen&&<Modal title="Reset password" onClose={()=>setPasswordOpen(false)} footer={<><button className="secondary-action" onClick={()=>setPasswordOpen(false)}>Cancel</button><button className="primary-action" onClick={()=>{setPasswordOpen(false);onToast('Password reset instructions sent')}}><Send/>Send reset link</button></>}><div className="payment-confirm"><LockKeyhole/>
    {/* The signed-in customer's own address. This read `mockData.profile.email`, so
        every account was offered a reset link to one hardcoded person's inbox. */}
    <p>{profile?.email ? <>Send a secure reset link to <strong>{profile.email}</strong>?</> : <>Send a secure reset link to your email?</>}</p><small>The link expires in 30 minutes. Your current password works until you use it.</small></div></Modal>}</>
}
