import { Eye, EyeOff, Mail } from 'lucide-react'
import { useState } from 'react'
import Modal from '../components/Modal'

export default function LoginPage({ onLogin, onToast }: { onLogin: () => void; onToast: (message: string, tone?: 'success' | 'info' | 'warning') => void }) {
  const [showPassword, setShowPassword] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors: typeof errors = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (password.length < 8) nextErrors.password = 'Password must contain at least 8 characters.'
    setErrors(nextErrors)
    if (!Object.keys(nextErrors).length) onLogin()
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
            <button type="button" className="forgot-link" onClick={()=>setShowForgot(true)}>Forgot password?</button>
            <label className="remember-row"><input type="checkbox" name="remember" defaultChecked /><span>Keep me logged in</span></label>
            <button className="login-button" type="submit">Login</button>
          </form>
        </div>
        <footer>© 2026 Kea Energy. All rights reserved. Made with love by HAKAS.</footer>
      </section>
      <aside className="brand-panel" aria-label="Kea Energy"><img className="energy-mark" src="/assets/brand/kea-brand.png" alt="" /><strong>KEA ENERGY</strong></aside>
      {showForgot&&<Modal title="Reset your password" onClose={()=>setShowForgot(false)} footer={<button className="primary-action" onClick={()=>{setShowForgot(false);onToast('Password reset instructions prepared for your email','info')}}>Send reset link</button>}><div className="forgot-panel"><Mail/><p>Enter your account email and we’ll prepare password reset instructions.</p><label htmlFor="reset-email">Email address</label><input id="reset-email" type="email" value={email} placeholder="name@example.com" onChange={(event)=>setEmail(event.target.value)}/></div></Modal>}
    </main>
  )
}
