import { Eye, EyeOff, Mail, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import { getDemoAccounts, login as apiLogin, type DemoAccountCard } from '../lib/client'
import type { Session } from '../lib/session'

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#ea4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285f4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#fbbc05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.55 10.78l7.98-6.19z"/>
    <path fill="#34a853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
)

const AppleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M16.365 1.43c0 1.14-.42 2.2-1.25 3.03-.98.99-2.05 1.56-3.2 1.47-.05-1.12.44-2.24 1.24-3.04.85-.86 2.16-1.44 3.21-1.46zM20.9 17.13c-.53 1.23-.78 1.78-1.46 2.87-.95 1.52-2.29 3.42-3.95 3.43-1.47.02-1.85-.96-3.85-.95-2 .01-2.42.97-3.89.95-1.66-.02-2.93-1.73-3.88-3.25-2.66-4.25-2.94-9.24-1.3-11.89 1.17-1.88 3.01-2.98 4.74-2.98 1.76 0 2.87.97 4.33.97 1.41 0 2.27-.97 4.31-.97 1.54 0 3.17.84 4.33 2.29-3.81 2.09-3.19 7.53.62 9.53z"/>
  </svg>
)

/**
 * Sign-in against the fourteen demo accounts.
 *
 * This used to validate only the SHAPE of an email and the LENGTH of a password —
 * anything 8 characters long got you in, and every login landed on the same household.
 * It now calls `/api/auth/login`, which decides which customer you are.
 *
 * The credentials panel is deliberate, not debug scaffolding left behind: the whole
 * point of the fourteen accounts is that a tester can pick the scenario they want to
 * exercise, and making them hunt through a Python file for the password defeats it. It
 * hides itself when the server has demo logins switched off.
 */
export default function LoginPage({ onLogin, onToast }: { onLogin: (session: Session) => void; onToast: (message: string, tone?: 'success' | 'info' | 'warning') => void }) {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [resetEmailError, setResetEmailError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<DemoAccountCard[]>([])
  const [showAccounts, setShowAccounts] = useState(false)

  useEffect(() => {
    // 503 means demo logins are off on this deployment; that is a normal state, not an
    // error, so it just leaves the panel hidden.
    getDemoAccounts().then(setAccounts).catch(() => setAccounts([]))
  }, [])

  const signIn = async (withEmail: string, withPassword: string) => {
    setBusy(true)
    setErrors({})
    try {
      const account = await apiLogin(withEmail, withPassword)
      onLogin({
        customerId: account.customer_id,
        displayName: account.display_name,
        scenario: account.scenario,
      })
    } catch (error) {
      // The server's own message, verbatim: "incorrect" and "demo logins are disabled"
      // are different problems with different fixes.
      setErrors({ form: error instanceof Error ? error.message : 'Could not sign in.' })
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    // Format checks stay — they catch a typo before a round trip. What they no longer
    // do is decide whether you are allowed in.
    const nextErrors: typeof errors = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (!password) nextErrors.password = 'Enter your password.'
    setErrors(nextErrors)
    if (!Object.keys(nextErrors).length) void signIn(email, password)
  }

  const sendResetLink = () => {
    const trimmedEmail = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setResetEmailError('Enter a valid email address including @ and a full stop.')
      return
    }
    setEmail(trimmedEmail)
    setResetEmailError('')
    setShowForgot(false)
    onToast('Password reset instructions prepared for your email', 'info')
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <header><h1 id="login-title">Login</h1><p>Enter your email and password to log in!</p></header>
          <form onSubmit={submit} noValidate>
            <label htmlFor="email">Email<span>*</span></label>
            <input id="email" name="email" type="email" placeholder="name@example.com" autoComplete="email" value={email} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email?'email-error':undefined} onChange={(event)=>setEmail(event.target.value)} />
            {errors.email&&<small className="field-error" id="email-error">{errors.email}</small>}
            <label htmlFor="password">Password<span>*</span></label>
            <div className={`password-field ${errors.password?'field-invalid':''}`}><input id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters" autoComplete="current-password" value={password} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password?'password-error':undefined} onChange={(event)=>setPassword(event.target.value)} /><button type="button" className="eye-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></div>
            {errors.password&&<small className="field-error" id="password-error">{errors.password}</small>}
            <button type="button" className="forgot-link" onClick={()=>{setResetEmailError('');setShowForgot(true)}}>Forgot password?</button>
            <label className="remember-row"><input type="checkbox" name="remember" defaultChecked /><span>Keep me logged in</span></label>
            {errors.form&&<small className="field-error" role="alert">{errors.form}</small>}
            <button className="login-button" type="submit" disabled={busy}>{busy?'Signing in…':'Login'}</button>
          </form>
          {accounts.length>0&&(
            <div className="demo-accounts">
              <button type="button" className="demo-accounts-toggle" aria-expanded={showAccounts} onClick={()=>setShowAccounts((open)=>!open)}>
                <Users aria-hidden="true"/>{showAccounts?'Hide demo accounts':`Demo accounts (${accounts.length})`}
              </button>
              {showAccounts&&(
                <ul className="demo-accounts-list">
                  {accounts.map((account)=>(
                    <li key={account.email}>
                      <button type="button" disabled={busy} onClick={()=>{setEmail(account.email);setPassword(account.password);void signIn(account.email,account.password)}}>
                        <strong>{account.display_name}</strong>
                        <small>{account.scenario}</small>
                        <code>{account.email} · {account.password}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="auth-divider"><span>or continue with</span></p>
          <div className="social-row">
            <button type="button" onClick={()=>onToast('Google sign-in is not available in this prototype','info')}><GoogleMark/>Google</button>
            <button type="button" onClick={()=>onToast('Apple sign-in is not available in this prototype','info')}><AppleMark/>Apple</button>
          </div>
          <p className="auth-switch">New to Kea Energy? <button type="button" onClick={()=>navigate('/register')}>Create an account</button></p>
        </div>
        <footer>© 2026 Kea Energy. All rights reserved. Made with love by HAKAS.</footer>
      </section>
      <aside className="brand-panel" aria-label="Kea Energy"><img className="energy-mark" src="/assets/brand/kea-brand-white.svg" alt="" /><strong>KEA ENERGY</strong></aside>
      {showForgot&&<Modal title="Reset your password" onClose={()=>setShowForgot(false)} footer={<button className="primary-action" onClick={sendResetLink}>Send reset link</button>}><div className="forgot-panel"><Mail/><p>Enter your account email and we’ll prepare password reset instructions.</p><label htmlFor="reset-email">Email address</label><input id="reset-email" type="email" value={email} placeholder="name@example.com" className={resetEmailError?'field-invalid':undefined} aria-invalid={Boolean(resetEmailError)} aria-describedby={resetEmailError?'reset-email-error':undefined} onChange={(event)=>{setEmail(event.target.value);setResetEmailError('')}}/>{resetEmailError&&<small className="field-error" id="reset-email-error" role="alert">{resetEmailError}</small>}</div></Modal>}
    </main>
  )
}
