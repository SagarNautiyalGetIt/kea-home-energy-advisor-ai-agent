import { KeyRound, Mail, MapPin, Phone, TriangleAlert, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import { getCustomerProfile, type CustomerProfile } from '../lib/client'
import { CUSTOMER_PROFILE_PHOTO } from '../lib/profileAssets'
import { loadSession } from '../lib/session'
import { useViewportOffset } from '../lib/viewportOffset'

/**
 * The customer's own details.
 *
 * This page used to render `mockData.profile` — a hardcoded object holding "Adela
 * Parkson", a Wellington address and somebody's phone number — so all sixteen logins
 * saw the same person. It now reads `/api/households/{id}/profile`, which is built from
 * the same `AccountContext` every answer comes from, so the profile screen and the
 * assistant cannot disagree about who you are.
 *
 * **Missing fields say "Not on file".** The seeded `public.*` households carry readings
 * and nothing else — no address, no ICP, no plan — and the honest thing to show is
 * that, not a placeholder. A profile page is exactly where an invented detail is most
 * likely to be believed, because the customer assumes it came from their own record.
 *
 * The name falls back to the session's display name. For a mart account the two are the
 * same string from the same row; for a seeded household the record holds no name at
 * all, and the one you signed in as is the truest thing available.
 */

const NOT_ON_FILE = <span className="profile-missing">Not on file</span>

export default function ProfilePage({ onToast }: { onToast: (message: string, tone?: 'success' | 'info' | 'warning') => void }) {
  const [session] = useState(loadSession)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Sized like the dashboard's energy home: the same offset, the same height on the same window.
  const cardRef = useViewportOffset<HTMLElement>('--profile-card-offset')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', address: '', phone: '', email: '' })

  useEffect(() => {
    if (!session) return
    let live = true
    getCustomerProfile(session.customerId)
      .then((loaded) => live && setProfile(loaded))
      .catch((err: Error) => live && setError(err.message))
    return () => { live = false }
  }, [session])

  const name = profile?.name ?? session?.displayName ?? null

  const openEdit = () => {
    setDraft({
      name: name ?? '',
      address: profile?.address ?? '',
      phone: profile?.phone ?? '',
      email: profile?.email ?? '',
    })
    setEditing(true)
  }

  // No write endpoint yet, and inventing one client-side would show an edit that
  // survives until reload and then silently reverts — worse than not offering it.
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    setEditing(false)
    onToast('Contact changes go to our team to apply — nothing on your account has changed yet', 'info')
  }

  if (error) {
    return <>
      <div className="page-heading"><h1>Profile</h1></div>
      <p className="settings-inline-error" role="alert">
        <TriangleAlert aria-hidden="true"/> Could not load your details: {error}
      </p>
    </>
  }

  return <>
    <div className="page-heading"><h1>Profile</h1><p className="profile-description">Review and manage your customer contact details.</p></div>
    <article className="profile-card card" ref={cardRef}>
      <header>Your Profile</header>
      <div className="profile-mascot"><img src={CUSTOMER_PROFILE_PHOTO} alt={`${name ?? 'Customer'} profile`}/></div>
      {!profile ? <p className="settings-loading">Loading your details…</p> : <dl>
        <dt>Name:</dt><dd>{name ?? NOT_ON_FILE}</dd>
        <dt>Account no.:</dt><dd>{profile.account_number ?? profile.customer_id}</dd>
        <dt>Address:</dt><dd>{profile.address ?? NOT_ON_FILE}</dd>
        <dt>Contact Number:</dt><dd>{profile.phone ?? NOT_ON_FILE}</dd>
        <dt>Email:</dt><dd>{profile.email ?? NOT_ON_FILE}</dd>
        <dt>Plan:</dt><dd>{profile.plan_name ?? NOT_ON_FILE}</dd>
        {profile.icp_number && <><dt>ICP:</dt><dd>{profile.icp_number}</dd></>}
        {profile.network_name && <><dt>Network:</dt><dd>{profile.network_name}</dd></>}
        <dt>Password:</dt><dd>••••••••</dd>
      </dl>}
      <button className="primary-small" onClick={openEdit} disabled={!profile}>Edit profile</button>
    </article>

    {editing && <Modal title="Edit profile" wide onClose={()=>setEditing(false)} footer={<><button className="secondary-action" onClick={()=>setEditing(false)}>Cancel</button><button className="primary-action" form="profile-form" type="submit">Request changes</button></>}>
      <form id="profile-form" className="profile-form" onSubmit={save}>
        <label><span><UserRound/>Full name</span><input required value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label>
        <label><span><MapPin/>Address</span><input value={draft.address} onChange={(event)=>setDraft({...draft,address:event.target.value})}/></label>
        <label><span><Phone/>Contact number</span><input value={draft.phone} onChange={(event)=>setDraft({...draft,phone:event.target.value})}/></label>
        <label><span><Mail/>Email address</span><input type="email" value={draft.email} onChange={(event)=>setDraft({...draft,email:event.target.value})}/></label>
        <div className="profile-password-action">
          <KeyRound/>
          <div><strong>Password</strong><small>Use a secure reset link to change your password.</small></div>
          <button type="button" onClick={()=>onToast('Password reset instructions prepared','info')}>Reset password</button>
        </div>
      </form>
    </Modal>}
  </>
}
