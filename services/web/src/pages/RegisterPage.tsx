import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PreviewAccountModal from '../components/PreviewAccountModal'
import SocialSignIn from '../components/SocialSignIn'

export default function RegisterPage({ onToast }: { onToast: (message: string, tone?: 'success' | 'info' | 'warning') => void }) {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPreviewNotice, setShowPreviewNotice] = useState(false)

  return (
    <>
    {showPreviewNotice && <PreviewAccountModal onClose={() => setShowPreviewNotice(false)} />}
    <main className="login-page">
      <section className="login-panel" aria-labelledby="register-title">
        <div className="login-content register-content">
          <header><h1 id="register-title">Sign up</h1></header>
          <form onSubmit={(event) => event.preventDefault()} noValidate>
            <label htmlFor="full-name">Full name<span>*</span></label>
            <input id="full-name" name="name" type="text" placeholder="Adela Parkson" autoComplete="name" value={name} onChange={(event)=>setName(event.target.value)} />

            <label htmlFor="register-email">Email address<span>*</span></label>
            <input id="register-email" name="email" type="email" placeholder="name@example.com" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} />

            <label htmlFor="register-password">Password<span>*</span></label>
            <div className="password-field">
              <input id="register-password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters" autoComplete="new-password" value={password} onChange={(event)=>setPassword(event.target.value)} />
              <button type="button" className="eye-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </div>

            <label htmlFor="confirm-password">Confirm password<span>*</span></label>
            <div className="password-field">
              <input id="confirm-password" name="confirmPassword" type={showConfirm ? 'text' : 'password'} placeholder="Re-enter your password" autoComplete="new-password" value={confirm} onChange={(event)=>setConfirm(event.target.value)} />
              <button type="button" className="eye-button" aria-label={showConfirm ? 'Hide password' : 'Show password'} onClick={() => setShowConfirm((visible) => !visible)}>{showConfirm ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </div>

            <button className="login-button register-button" type="button" onClick={() => setShowPreviewNotice(true)}>Create account</button>
          </form>
          <SocialSignIn onUnavailable={(provider)=>onToast(`${provider} sign-up is not available in this prototype`,'info')} />
          <p className="auth-switch">Already have an account? <button type="button" onClick={()=>navigate('/login')}>Log in</button></p>
        </div>
        <footer>© 2026 Kea Energy. All rights reserved. Made with love by HAKAS.</footer>
      </section>
      <aside className="brand-panel" aria-label="Kea Energy"><img className="energy-mark" src="/assets/brand/kea-brand-white.svg" alt="" /><strong>KEA ENERGY</strong></aside>
    </main>
    </>
  )
}
